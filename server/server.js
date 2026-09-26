'use strict';

// ふたりの暮らし 同期サーバー
// - app/ の静的ファイルを配信
// - 共有コード（ルーム）ごとにレコードを保存し、差分を同期
// - SSE で相手の端末に変更を即時通知
// - プッシュ通知（push.js）

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const push = require('./push');
const receipt = require('./receipt');
const ics = require('./ics');
const Logic = require('../app/logic.js');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const STATIC_DIR = path.resolve(__dirname, '..', 'app');

const COLLECTIONS = new Set([
  'settings', 'chores', 'log', 'shopping', 'thanks', 'events', 'requests', 'expenses', 'stock', 'notes',
  'pings', 'moods', 'wishes', 'dinner', 'recurring', 'shopfreq',
]);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;
const MAX_BODY = 1024 * 1024;
const MAX_RECEIPT_BODY = 6 * 1024 * 1024; // レシート画像（base64）
const MAX_RECORD = 4096;
const MAX_RECORDS_PER_ROOM = 50000;
const CREATE_LIMIT_PER_HOUR = 20;
// Fly.io などのプロキシの後ろで動かすときは 1 にして、本当の接続元 IP を使う
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

fs.mkdirSync(DATA_DIR, { recursive: true });
push.init(DATA_DIR);

// ---------- ルームの保存 ----------
const rooms = new Map(); // code -> { rev, count, records: { col: { id: rec } }, subs: { endpoint: sub }, calToken, listeners: Set, saveTimer }
const calIndex = new Map(); // カレンダー用トークン -> code

function roomFile(code) { return path.join(DATA_DIR, `${code}.json`); }

function getRoom(code) {
  if (!CODE_RE.test(code)) return null;
  if (rooms.has(code)) return rooms.get(code);
  let stored;
  try { stored = JSON.parse(fs.readFileSync(roomFile(code), 'utf8')); } catch (e) { return null; }
  const room = { rev: stored.rev || 0, records: stored.records || {}, subs: stored.subs || {}, calToken: stored.calToken || null, listeners: new Set(), saveTimer: null };
  if (room.calToken) calIndex.set(room.calToken, code);
  room.count = Object.values(room.records).reduce((n, col) => n + Object.keys(col).length, 0);
  rooms.set(code, room);
  return room;
}

function createRoom() {
  let code;
  do {
    code = Array.from({ length: 10 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  } while (fs.existsSync(roomFile(code)));
  const room = { rev: 0, count: 0, records: {}, subs: {}, listeners: new Set(), saveTimer: null };
  rooms.set(code, room);
  writeRoom(code, room);
  return code;
}

function writeRoom(code, room) {
  const tmp = roomFile(code) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ rev: room.rev, records: room.records, subs: room.subs, calToken: room.calToken }));
  fs.renameSync(tmp, roomFile(code));
}

function scheduleSave(code, room) {
  if (room.saveTimer) return;
  room.saveTimer = setTimeout(() => {
    room.saveTimer = null;
    try { writeRoom(code, room); } catch (e) { console.error('save failed', code, e); }
  }, 300);
}

// 定時通知のために、保存済みのルームをすべて読み込んでおく
function loadAllRooms() {
  for (const f of fs.readdirSync(DATA_DIR)) {
    const m = /^([A-HJ-NP-Z2-9]{10})\.json$/.exec(f);
    if (m) getRoom(m[1]);
  }
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
// 戻り値: 採用した変更 [{ col, cur（以前の値）, rec }]
function applyChanges(room, changes) {
  const accepted = [];
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
    accepted.push({ col: ch.col, cur, rec: clean });
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

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJson(req, maxBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('too large')); req.destroy(); return; }
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

  if (parts[1] === 'push' && parts[2] === 'key') return send(res, 200, { key: push.getPublicKey() });

  if (parts[1] === 'features') return send(res, 200, { receipt: receipt.configured() });

  // カレンダー購読（読み取り専用のトークンで公開）
  if (parts[1] === 'cal' && req.method === 'GET') {
    const m = /^([A-Za-z0-9_-]{20,64})\.ics$/.exec(parts[2] || '');
    const calRoom = m && calIndex.has(m[1]) ? getRoom(calIndex.get(m[1])) : null;
    if (!calRoom) { res.writeHead(404); res.end('Not found'); return; }
    const list = col => Logic.alive(Object.values(calRoom.records[col] || {}));
    const n = (calRoom.records.settings || {}).names;
    const body = ics.build({
      names: n && !n.deleted ? n : { a: 'わたし', b: '奥さん' },
      events: list('events'), requests: list('requests'), chores: list('chores'),
    }, { chores: url.searchParams.get('chores') === '1' });
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(body);
    return;
  }

  // テスト用（PUSH_DRY_RUN=1 のときだけ）
  if (push.DRY_RUN && parts[1] === 'debug') {
    if (parts[2] === 'pushes') return send(res, 200, push.sentLog);
    if (parts[2] === 'tick' && req.method === 'POST') {
      const body = await readJson(req).catch(() => ({}));
      const sent = await push.tick(rooms, new Date(body.now || Date.now()), scheduleSave);
      return send(res, 200, { sent });
    }
  }

  if (parts[1] !== 'rooms') return send(res, 404, { error: 'not found' });

  if (parts.length === 2 && req.method === 'POST') {
    if (!allowCreate(clientIp(req))) return send(res, 429, { error: 'too many rooms' });
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
    if (accepted.length) {
      scheduleSave(code, room);
      notify(room, body.client);
      push.onChanges(room, accepted);
    }
    return send(res, 200, { rev: room.rev, changes: changesSince(room, since) });
  }

  if (parts[3] === 'calendar' && req.method === 'POST') {
    let body;
    try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'bad request' }); }
    if (!room.calToken || body.reset) {
      if (room.calToken) calIndex.delete(room.calToken);
      room.calToken = crypto.randomBytes(18).toString('base64url');
      calIndex.set(room.calToken, code);
      scheduleSave(code, room);
    }
    return send(res, 200, { token: room.calToken });
  }

  if (parts[3] === 'receipt' && req.method === 'POST') {
    if (!receipt.configured()) return send(res, 503, { error: 'not configured' });
    let body;
    try { body = await readJson(req, MAX_RECEIPT_BODY); } catch (e) { return send(res, 413, { error: 'image too large' }); }
    if (!receipt.validImage(body)) return send(res, 400, { error: 'bad image' });
    const today = Logic.ymd(new Date());
    if (!receipt.allow(code, today)) return send(res, 429, { error: 'daily limit' });
    const r = await receipt.read({ mediaType: body.mediaType, data: body.data }, today);
    return r.ok ? send(res, 200, r.result) : send(res, r.status, { error: r.error });
  }

  if (parts[3] === 'push' && req.method === 'POST') {
    let body;
    try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'bad request' }); }
    const action = parts[4] || 'subscribe';
    if (action === 'subscribe') {
      if (!push.validSubscription(body.subscription)) return send(res, 400, { error: 'bad subscription' });
      if (!push.upsert(room, body.subscription, body.who, body.prefs, Number(body.seenThanks))) return send(res, 429, { error: 'too many devices' });
      scheduleSave(code, room);
      return send(res, 200, { ok: true });
    }
    if (action === 'delete') {
      if (push.removeSub(room, String(body.endpoint || ''))) scheduleSave(code, room);
      return send(res, 200, { ok: true });
    }
    if (action === 'test') {
      const sub = (room.subs || {})[String(body.endpoint || '')];
      if (!sub) return send(res, 404, { error: 'not subscribed' });
      const ok = await push.sendTo(room, sub, { title: 'ふたりの暮らし', body: '通知が届きました 🎉', tab: 'settings', tag: 'test' });
      return send(res, ok ? 200 : 502, { ok });
    }
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

loadAllRooms();
// 定時通知（テスト時は /api/debug/tick で動かす）
if (!push.DRY_RUN) {
  setInterval(() => { push.tick(rooms, new Date(), scheduleSave).catch(e => console.error('tick failed', e)); }, 60000);
}

server.listen(PORT, () => console.log(`ふたりの暮らし: http://localhost:${PORT} (data: ${DATA_DIR})`));
