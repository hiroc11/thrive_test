'use strict';

// ふたりの暮らし 同期サーバー（依存パッケージなし）
// - app/ の静的ファイルを配信
// - 共有コード（ルーム）ごとにレコードを保存し、差分を同期
// - SSE で相手の端末に変更を即時通知

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const STATIC_DIR = path.resolve(__dirname, '..', 'app');

const COLLECTIONS = new Set(['settings', 'chores', 'log', 'shopping', 'thanks', 'events']);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;
const MAX_BODY = 1024 * 1024;
const MAX_RECORD = 4096;
const MAX_RECORDS_PER_ROOM = 50000;
const CREATE_LIMIT_PER_HOUR = 20;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- ルームの保存 ----------
const rooms = new Map(); // code -> { rev, count, records: { col: { id: rec } }, listeners: Set, saveTimer }

function roomFile(code) { return path.join(DATA_DIR, `${code}.json`); }

function getRoom(code) {
  if (!CODE_RE.test(code)) return null;
  if (rooms.has(code)) return rooms.get(code);
  let stored;
  try { stored = JSON.parse(fs.readFileSync(roomFile(code), 'utf8')); } catch (e) { return null; }
  const room = { rev: stored.rev || 0, records: stored.records || {}, listeners: new Set(), saveTimer: null };
  room.count = Object.values(room.records).reduce((n, col) => n + Object.keys(col).length, 0);
  rooms.set(code, room);
  return room;
}

function createRoom() {
  let code;
  do {
    code = Array.from({ length: 10 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  } while (fs.existsSync(roomFile(code)));
  const room = { rev: 0, count: 0, records: {}, listeners: new Set(), saveTimer: null };
  rooms.set(code, room);
  writeRoom(code, room);
  return code;
}

function writeRoom(code, room) {
  const tmp = roomFile(code) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ rev: room.rev, records: room.records }));
  fs.renameSync(tmp, roomFile(code));
}

function scheduleSave(code, room) {
  if (room.saveTimer) return;
  room.saveTimer = setTimeout(() => {
    room.saveTimer = null;
    try { writeRoom(code, room); } catch (e) { console.error('save failed', code, e); }
  }, 300);
}

function flushAll() {
  for (const [code, room] of rooms) {
    if (room.saveTimer) { clearTimeout(room.saveTimer); room.saveTimer = null; writeRoom(code, room); }
  }
}

// ---------- 同期 ----------
function validRecord(rec) {
  return rec && typeof rec === 'object' && !Array.isArray(rec)
    && typeof rec.id === 'string' && rec.id.length > 0 && rec.id.length <= 64
    && Number.isFinite(rec.updatedAt)
    && JSON.stringify(rec).length <= MAX_RECORD;
}

// changes: [{ col, rec }]。updatedAt が新しいものだけ採用（Last-Write-Wins）
function applyChanges(room, changes) {
  let accepted = 0;
  for (const ch of changes) {
    if (!ch || !COLLECTIONS.has(ch.col) || !validRecord(ch.rec)) continue;
    const col = room.records[ch.col] || (room.records[ch.col] = {});
    const cur = col[ch.rec.id];
    if (cur && cur.updatedAt >= ch.rec.updatedAt) continue;
    if (!cur) {
      if (room.count >= MAX_RECORDS_PER_ROOM) continue;
      room.count++;
    }
    const { _rev, ...clean } = ch.rec;
    col[ch.rec.id] = { ...clean, _rev: ++room.rev };
    accepted++;
  }
  return accepted;
}

function changesSince(room, since) {
  const out = [];
  for (const [col, recs] of Object.entries(room.records)) {
    for (const rec of Object.values(recs)) {
      if (rec._rev > since) {
        const { _rev, ...clean } = rec;
        out.push({ col, rec: clean });
      }
    }
  }
  return out;
}

function notify(room, exceptClient) {
  for (const l of room.listeners) {
    if (l.client !== exceptClient) l.res.write(`data: ${room.rev}\n\n`);
  }
}

// ---------- HTTP ----------
const createLog = new Map(); // ip -> [timestamps]

function allowCreate(ip) {
  const now = Date.now();
  const list = (createLog.get(ip) || []).filter(t => now - t < 3600000);
  if (list.length >= CREATE_LIMIT_PER_HOUR) { createLog.set(ip, list); return false; }
  list.push(now);
  createLog.set(ip, list);
  return true;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(STATIC_DIR, path.normalize(rel));
  if (!file.startsWith(STATIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

async function handleApi(req, res, url) {
  // アプリを別ドメイン（GitHub Pages など）に置いても使えるように CORS を許可。
  // 認証はルームの共有コードのみでクッキーは使わないため * で問題ない。
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', code, action]

  if (parts[1] === 'health') return send(res, 200, { ok: true });

  if (parts[1] !== 'rooms') return send(res, 404, { error: 'not found' });

  if (parts.length === 2 && req.method === 'POST') {
    if (!allowCreate(req.socket.remoteAddress)) return send(res, 429, { error: 'too many rooms' });
    return send(res, 201, { code: createRoom() });
  }

  const code = (parts[2] || '').toUpperCase();
  const room = getRoom(code);
  if (!room) return send(res, 404, { error: 'room not found' });

  if (parts[3] === 'sync' && req.method === 'POST') {
    let body;
    try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'bad request' }); }
    const changes = Array.isArray(body.changes) ? body.changes : [];
    let since = Number(body.since) || 0;
    if (since > room.rev) since = 0; // サーバー側が巻き戻った場合は全件を返す
    const accepted = applyChanges(room, changes);
    if (accepted) { scheduleSave(code, room); notify(room, body.client); }
    return send(res, 200, { rev: room.rev, changes: changesSince(room, since) });
  }

  if (parts[3] === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`retry: 3000\ndata: ${room.rev}\n\n`);
    const listener = { res, client: url.searchParams.get('client') };
    room.listeners.add(listener);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); room.listeners.delete(listener); });
    return;
  }

  send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(e => { console.error(e); send(res, 500, { error: 'server error' }); });
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, url.pathname);
  } else {
    res.writeHead(405); res.end();
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { flushAll(); process.exit(0); });
}

server.listen(PORT, () => console.log(`ふたりの暮らし: http://localhost:${PORT} (data: ${DATA_DIR})`));
