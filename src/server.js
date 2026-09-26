import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, SORT_KEYS } from './db.js';
import { FIELDS, PROPERTY_TYPES, STATUSES, TRANSACTION_TYPES, ValidationError, validateProperty } from './schema.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');
const MAX_BODY = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'リクエストが大きすぎます');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSONの形式が不正です');
  }
}

function parseId(str) {
  const id = Number(str);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, '物件が見つかりません');
  return id;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // 表計算ソフトでの数式実行（CSVインジェクション）を防ぐ
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(items) {
  const cols = ['id', ...Object.keys(FIELDS), 'created_at', 'updated_at'];
  const header = ['ID', ...Object.values(FIELDS).map((f) => f.label), '登録日時', '更新日時'];
  const lines = [header.map(csvCell).join(',')];
  for (const item of items) lines.push(cols.map((c) => csvCell(item[c])).join(','));
  // Excelで文字化けしないようBOM付きUTF-8で出力
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    throw new HttpError(400, 'Bad Request');
  }
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + sep)) throw new HttpError(404, 'Not Found');
  let data;
  try {
    data = await readFile(filePath);
  } catch {
    throw new HttpError(404, 'Not Found');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : data);
}

export function createApp({ dbPath = ':memory:' } = {}) {
  const repo = openDatabase(dbPath);

  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    const query = Object.fromEntries(url.searchParams);
    const method = req.method;

    if (parts[1] === 'meta' && parts.length === 2 && method === 'GET') {
      const fields = Object.fromEntries(
        Object.entries(FIELDS).map(([k, f]) => [k, { label: f.label, kind: f.kind, required: !!f.required, values: f.values }]),
      );
      return sendJson(res, 200, {
        fields,
        propertyTypes: PROPERTY_TYPES,
        transactionTypes: TRANSACTION_TYPES,
        statuses: STATUSES,
        sorts: SORT_KEYS,
      });
    }

    if (parts[1] === 'stats' && parts.length === 2 && method === 'GET') {
      return sendJson(res, 200, repo.stats());
    }

    if (parts[1] === 'properties') {
      if (parts.length === 2) {
        if (method === 'GET') return sendJson(res, 200, repo.list(query));
        if (method === 'POST') {
          const data = validateProperty(await readJson(req));
          return sendJson(res, 201, repo.create(data));
        }
        throw new HttpError(405, 'Method Not Allowed');
      }

      if (parts.length === 3 && parts[2] === 'export.csv' && method === 'GET') {
        const { items } = repo.list({ ...query, limit: 1000, offset: 0 });
        const body = toCsv(items);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="properties.csv"`,
        });
        return res.end(body);
      }

      if (parts.length === 3) {
        const id = parseId(parts[2]);
        if (method === 'GET') {
          const item = repo.get(id);
          if (!item) throw new HttpError(404, '物件が見つかりません');
          return sendJson(res, 200, item);
        }
        if (method === 'PUT' || method === 'PATCH') {
          const data = validateProperty(await readJson(req), { partial: method === 'PATCH' });
          const item = repo.update(id, data);
          if (!item) throw new HttpError(404, '物件が見つかりません');
          return sendJson(res, 200, item);
        }
        if (method === 'DELETE') {
          if (!repo.remove(id)) throw new HttpError(404, '物件が見つかりません');
          res.writeHead(204);
          return res.end();
        }
        throw new HttpError(405, 'Method Not Allowed');
      }
    }

    throw new HttpError(404, 'Not Found');
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(req, res, url.pathname);
      } else {
        throw new HttpError(405, 'Method Not Allowed');
      }
    } catch (err) {
      if (err instanceof ValidationError) return sendJson(res, 400, { error: err.message, errors: err.errors });
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      sendJson(res, 500, { error: 'サーバーエラーが発生しました' });
    }
  });

  server.on('close', () => repo.close());
  return { server, repo };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const dbPath = process.env.DB_PATH || join(ROOT, 'data', 'real-estate.db');
  const { server } = createApp({ dbPath });
  server.listen(port, () => {
    console.log(`不動産情報管理アプリ: http://localhost:${port}`);
    console.log(`データベース: ${dbPath}`);
  });
}
