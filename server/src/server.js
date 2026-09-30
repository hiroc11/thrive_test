// HTTP サーバー：API・リアルタイム通知（SSE）・アプリの静的ファイル
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createService, AppError, STAMPS, REPORT_REASONS, FEEDBACK_CATEGORIES } from './service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 16 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
};

// 1分あたりの回数制限（サーバー1台なのでメモリで数える）
function limiter(perMinute) {
  const hits = new Map();
  setInterval(() => hits.clear(), 60e3).unref();
  return key => {
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    return n <= perMinute;
  };
}

export function createApp({ dbFile = ':memory:', appDir = path.join(here, '../../app'), adminToken = '', trustProxy = false, now } = {}) {
  // ---------- リアルタイム通知（SSE） ----------
  const streams = new Map(); // userId -> Set<res>
  const tickets = new Map(); // ticket -> { userId, exp }
  function publish(userIds, msg) {
    const line = `event: ${msg.type}\ndata: ${JSON.stringify(msg)}\n\n`;
    for (const id of new Set(userIds)) streams.get(id)?.forEach(res => res.write(line));
  }
  const heartbeat = setInterval(() => streams.forEach(set => set.forEach(res => res.write(': ping\n\n'))), 25e3);
  heartbeat.unref();

  const svc = createService({ db: openDb(dbFile), publish, ...(now ? { now } : {}) });
  const general = limiter(240), strict = limiter(20);

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
    res.end(JSON.stringify(body));
  };
  // Fly.io は Fly-Client-IP に本当の接続元を入れる。ほかのロードバランサーは X-Forwarded-For の先頭
  const ipOf = req => (trustProxy && (String(req.headers['fly-client-ip'] || '') ||
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || req.socket.remoteAddress || '';

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => {
        size += c.length;
        if (size > MAX_BODY) { reject(new AppError(413, 'too_large', 'データが大きすぎます')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
        } catch { reject(new AppError(400, 'bad_json', 'データの形がおかしいです')); }
      });
      req.on('error', reject);
    });
  }

  // [メソッド, パス, ログインが必要か, 処理]。:id は URL の一部
  const routes = [
    ['GET', '/api/meta', false, () => ({ stamps: STAMPS, reportReasons: REPORT_REASONS, feedbackCategories: FEEDBACK_CATEGORIES })],
    ['POST', '/api/signup', false, (u, b) => svc.signup(b), 'strict'],
    ['POST', '/api/transfer/claim', false, (u, b) => svc.transferClaim(b.code), 'strict'],
    ['GET', '/api/me', true, u => svc.me(u)],
    ['POST', '/api/me/nickname', true, (u, b) => svc.rename(u, b.nickname)],
    ['POST', '/api/me/delete', true, u => svc.deleteAccount(u), 'strict'],
    ['POST', '/api/feedback', true, (u, b) => svc.feedback(u, b.category, b.text), 'strict'],
    ['POST', '/api/transfer/issue', true, u => svc.transferIssue(u), 'strict'],
    ['GET', '/api/stickers', true, u => svc.listStickers(u)],
    ['POST', '/api/stickers/order', true, (u, b) => svc.reorder(u, b.ids)],
    ['GET', '/api/zukan', true, u => svc.zukan(u)],
    ['POST', '/api/daily/checkin', true, u => svc.checkin(u)],
    ['POST', '/api/packs/free', true, u => svc.freePack(u)],
    ['GET', '/api/friends', true, u => svc.listFriends(u)],
    ['POST', '/api/friends/request', true, (u, b) => svc.requestFriend(u, b.friendCode), 'strict'],
    ['POST', '/api/friends/respond', true, (u, b) => svc.respondFriend(u, String(b.requestId), b.accept === true)],
    ['POST', '/api/friends/remove', true, (u, b) => svc.unfriend(u, String(b.userId))],
    ['GET', '/api/friends/:id/stickers', true, (u, b, p) => svc.friendStickers(u, p.id)],
    ['POST', '/api/block', true, (u, b) => svc.block(u, String(b.userId))],
    ['POST', '/api/report', true, (u, b) => svc.report(u, String(b.userId), b.reason), 'strict'],
    ['POST', '/api/trades', true, (u, b) => svc.openTrade(u, String(b.friendId), b.mode)],
    ['GET', '/api/trades/:id', true, (u, b, p) => svc.tradeView(u, p.id)],
    ['POST', '/api/trades/:id/offer', true, (u, b, p) => svc.setOffer(u, p.id, b.ids)],
    ['POST', '/api/trades/:id/ask', true, (u, b, p) => svc.setAsk(u, p.id, b.ids)],
    ['POST', '/api/trades/:id/mode', true, (u, b, p) => svc.setMode(u, p.id, b.mode)],
    ['POST', '/api/trades/:id/stamp', true, (u, b, p) => svc.stamp(u, p.id, b.text)],
    ['POST', '/api/trades/:id/ready', true, (u, b, p) => svc.ready(u, p.id, Number(b.version))],
    ['POST', '/api/trades/:id/cancel', true, (u, b, p) => svc.cancel(u, p.id)],
    // EventSource はヘッダーを付けられないので、60秒だけ使える使い捨てチケットを先にもらう
    ['POST', '/api/events/ticket', true, u => {
      const ticket = crypto.randomBytes(24).toString('base64url');
      tickets.set(ticket, { userId: u, exp: Date.now() + 60e3 });
      return { ticket };
    }]
  ].map(([method, pattern, needAuth, fn, limit]) => ({
    method, needAuth, fn, limit,
    re: new RegExp('^' + pattern.replace(/:id/g, '(?<id>[A-Za-z0-9-]{1,64})') + '$')
  }));

  async function api(req, res, url) {
    if (url.pathname === '/api/events' && req.method === 'GET') {
      const t = tickets.get(url.searchParams.get('ticket') || '');
      tickets.delete(url.searchParams.get('ticket') || '');
      if (!t || t.exp < Date.now()) return send(res, 401, { error: 'bad_ticket', message: 'もう一度つなぎ直してね' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...SECURITY_HEADERS });
      res.write('retry: 3000\n\n');
      if (!streams.has(t.userId)) streams.set(t.userId, new Set());
      streams.get(t.userId).add(res);
      req.on('close', () => streams.get(t.userId)?.delete(res));
      return;
    }
    // 運営用：合言葉（x-admin-token）が合うときだけ。合わなければ存在しないふりをする
    if (url.pathname.startsWith('/api/admin/') && req.method === 'GET') {
      const given = Buffer.from(String(req.headers['x-admin-token'] || ''));
      const want = Buffer.from(adminToken);
      const ok = adminToken && given.length === want.length && crypto.timingSafeEqual(given, want);
      if (!ok || !strict(ipOf(req) + 'admin')) return send(res, 404, { error: 'not_found' });
      if (url.pathname === '/api/admin/metrics') return send(res, 200, svc.metrics(Math.min(60, Number(url.searchParams.get('days')) || 14)));
      if (url.pathname === '/api/admin/feedback') return send(res, 200, svc.adminFeedback());
      if (url.pathname === '/api/admin/reports') return send(res, 200, svc.adminReports());
      return send(res, 404, { error: 'not_found' });
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const ip = ipOf(req);
      if (!general(ip) || (r.limit === 'strict' && !strict(ip + url.pathname))) {
        return send(res, 429, { error: 'rate_limited', message: 'ちょっと待ってからもう一度ためしてね' }, { 'Retry-After': '30' });
      }
      let userId = null;
      if (r.needAuth) {
        const h = String(req.headers.authorization || '');
        userId = h.startsWith('Bearer ') ? svc.auth(h.slice(7)) : null;
        if (!userId) return send(res, 401, { error: 'unauthorized', message: 'ログインし直してね' });
      }
      const body = req.method === 'POST' ? await readBody(req) : {};
      return send(res, 200, r.fn(userId, body, m.groups || {}));
    }
    send(res, 404, { error: 'not_found', message: '見つかりません' });
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(appDir, rel));
    if (!file.startsWith(path.normalize(appDir + path.sep))) return send(res, 404, { error: 'not_found' });
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { error: 'not_found' });
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': rel === '/index.html' ? 'no-cache' : 'public, max-age=300', ...SECURITY_HEADERS });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (url.pathname === '/healthz') return send(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed' });
      serveStatic(req, res, url);
    } catch (e) {
      if (e instanceof AppError) return send(res, e.status, { error: e.code, message: e.message });
      console.error(e);
      send(res, 500, { error: 'server_error', message: 'サーバーで問題が起きました。少し待ってからためしてね' });
    }
  });
  server.on('close', () => clearInterval(heartbeat));
  return { server, svc };
}

// 直接起動されたときだけ待ち受ける（シンボリックリンク経由の起動でも判定できるよう実体のパスで比べる）
const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) {
  const dbFile = process.env.DB_FILE || path.join(here, '../data/puku.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const { server } = createApp({ dbFile, adminToken: process.env.ADMIN_TOKEN || '', trustProxy: process.env.TRUST_PROXY === '1' });
  const port = Number(process.env.PORT) || 8787;
  server.listen(port, () => console.log(`ぷくホロシール帳: http://localhost:${port}`));
}
