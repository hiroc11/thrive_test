'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'futari-test-'));
let proc;

function startServer() {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
      env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    });
    proc.stdout.once('data', () => resolve());
    proc.once('error', reject);
  });
}

function stopServer() {
  return new Promise(resolve => { proc.once('exit', resolve); proc.kill('SIGTERM'); });
}

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
});

async function newRoom() {
  const res = await post('/api/rooms');
  assert.strictEqual(res.status, 201);
  return (await res.json()).code;
}

before(startServer);
after(async () => { await stopServer(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('serves the app', async () => {
  const res = await fetch(BASE + '/');
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /ふたりの暮らし/);
});

test('rejects path traversal', async () => {
  const res = await fetch(BASE + '/..%2Fserver%2Fserver.js');
  assert.notStrictEqual(res.status, 200);
});

test('unknown room is 404', async () => {
  const res = await post('/api/rooms/ABCDEFGHJK/sync', { since: 0, changes: [] });
  assert.strictEqual(res.status, 404);
});

test('two clients exchange changes with last-write-wins', async () => {
  const code = await newRoom();
  const sync = body => post(`/api/rooms/${code}/sync`, body).then(r => r.json());

  // A が買い物を追加
  const a1 = await sync({ since: 0, client: 'A', changes: [{ col: 'shopping', rec: { id: 's1', name: '牛乳', done: false, updatedAt: 100 } }] });
  assert.strictEqual(a1.rev, 1);

  // B が取得
  const b1 = await sync({ since: 0, client: 'B', changes: [] });
  assert.deepStrictEqual(b1.changes, [{ col: 'shopping', rec: { id: 's1', name: '牛乳', done: false, updatedAt: 100 } }]);

  // 古い更新は無視される
  await sync({ since: b1.rev, client: 'B', changes: [{ col: 'shopping', rec: { id: 's1', name: '古い', updatedAt: 50 } }] });
  // 新しい更新（削除）は採用される
  await sync({ since: b1.rev, client: 'B', changes: [{ col: 'shopping', rec: { id: 's1', deleted: true, updatedAt: 200 } }] });

  const a2 = await sync({ since: a1.rev, client: 'A', changes: [] });
  assert.strictEqual(a2.changes.length, 1);
  assert.deepStrictEqual(a2.changes[0].rec, { id: 's1', deleted: true, updatedAt: 200 });
});

test('ignores invalid changes', async () => {
  const code = await newRoom();
  const res = await post(`/api/rooms/${code}/sync`, {
    since: 0,
    changes: [
      { col: 'evil', rec: { id: 'x', updatedAt: 1 } },
      { col: 'chores', rec: { id: 'x' } },
      { col: 'chores', rec: { id: 'x', updatedAt: 1, big: 'a'.repeat(5000) } },
      { col: 'chores', rec: { id: 'ok', updatedAt: 1, _rev: 999 } },
    ],
  }).then(r => r.json());
  assert.strictEqual(res.rev, 1);
  assert.deepStrictEqual(res.changes, [{ col: 'chores', rec: { id: 'ok', updatedAt: 1 } }]);
});

test('notifies other clients via SSE', async () => {
  const code = await newRoom();
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/rooms/${code}/events?client=B`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const first = dec.decode((await reader.read()).value);
  assert.match(first, /data: 0/);

  await post(`/api/rooms/${code}/sync`, { since: 0, client: 'A', changes: [{ col: 'thanks', rec: { id: 't1', text: 'ありがとう', updatedAt: 1 } }] });
  const next = dec.decode((await reader.read()).value);
  assert.match(next, /data: 1/);
  ctrl.abort();
});

test('data survives restart', async () => {
  const code = await newRoom();
  await post(`/api/rooms/${code}/sync`, { since: 0, changes: [{ col: 'events', rec: { id: 'e1', title: '結婚記念日', updatedAt: 1 } }] });
  await stopServer();
  await startServer();
  const res = await post(`/api/rooms/${code}/sync`, { since: 0, changes: [] }).then(r => r.json());
  assert.strictEqual(res.changes[0].rec.title, '結婚記念日');
});
