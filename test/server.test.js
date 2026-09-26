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
      env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, PUSH_DRY_RUN: '1', TZ: 'Asia/Tokyo' },
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

// ---------- 通知 ----------
const SUB = n => ({ endpoint: `https://push.example.com/${n}`, keys: { p256dh: 'BPk' + n, auth: 'au' + n } });
const pushes = () => fetch(BASE + '/api/debug/pushes').then(r => r.json());
const tick = now => post('/api/debug/tick', { now }).then(r => r.json());

test('push key is served', async () => {
  const { key } = await fetch(BASE + '/api/push/key').then(r => r.json());
  assert.match(key, /^[A-Za-z0-9_-]{80,}$/);
});

test('rejects invalid subscriptions', async () => {
  const code = await newRoom();
  const res = await post(`/api/rooms/${code}/push`, { subscription: { endpoint: 'http://insecure', keys: {} }, who: 'a' });
  assert.strictEqual(res.status, 400);
});

test('notifies the partner about their actions', async () => {
  const code = await newRoom();
  const sync = changes => post(`/api/rooms/${code}/sync`, { since: 0, changes }).then(r => r.json());
  await post(`/api/rooms/${code}/push`, { subscription: SUB('ev-a'), who: 'a' });
  await post(`/api/rooms/${code}/push`, { subscription: SUB('ev-b'), who: 'b', prefs: { shopping: false } });
  const now = Date.now();
  const before = (await pushes()).length;
  await sync([
    { col: 'settings', rec: { id: 'names', a: 'ひろ', b: 'ゆき', updatedAt: now } },
    { col: 'shopping', rec: { id: 's1', name: '牛乳', by: 'b', updatedAt: now } },          // → a
    { col: 'shopping', rec: { id: 's2', name: 'パン', by: 'a', updatedAt: now } },          // → b（オフなので送らない）
    { col: 'shopping', rec: { id: 's3', name: '古い', by: 'b', updatedAt: 1 } },            // 古いので送らない
    { col: 'thanks', rec: { id: 't1', from: 'a', text: 'いつもありがとう', updatedAt: now } }, // → b
    { col: 'requests', rec: { id: 'r1', from: 'b', to: 'a', text: '電球', status: 'open', updatedAt: now } }, // → a
    { col: 'log', rec: { id: 'l1', choreId: 'c1', title: '洗濯', by: 'a', cover: true, for: 'b', at: now, updatedAt: now } }, // → b
  ]);
  await sync([
    { col: 'thanks', rec: { id: 't1', from: 'a', text: 'いつもありがとう', reaction: '❤️', updatedAt: now + 1 } }, // → a
    { col: 'requests', rec: { id: 'r1', from: 'b', to: 'a', text: '電球', status: 'done', updatedAt: now + 1 } }, // → b
  ]);
  const got = (await pushes()).slice(before).map(p => `${p.who}:${p.title}:${p.body}`);
  assert.deepStrictEqual(got, [
    'a:🛒 買い物リスト:ゆきが「牛乳」を追加しました',
    'b:💌 ひろからありがとう:いつもありがとう',
    'a:🙏 ゆきからお願い:電球',
    'b:🧹 代わりにやってくれました:ひろが「洗濯」をやってくれました',
    'a:❤️ ゆきからリアクション:いつもありがとう',
    'b:🙏 ひろがやってくれました 🎉:電球',
  ]);
});

test('sends the morning digest once a day and the weekly review on Sunday', async () => {
  const code = await newRoom();
  const day = (d, h, m) => new Date(`2026-09-${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`).toISOString();
  await post(`/api/rooms/${code}/sync`, { since: 0, changes: [
    { col: 'chores', rec: { id: 'g', title: '燃えるゴミ出し', assignee: 'a', days: [1, 4], every: 0, points: 1, updatedAt: 1 } }, // 月・木
    { col: 'chores', rec: { id: 'w', title: '洗濯', assignee: 'b', every: 1, points: 2, updatedAt: 1 } },
    { col: 'chores', rec: { id: 'f', title: 'お風呂掃除', assignee: 'both', every: 1, points: 2, updatedAt: 1 } },
    { col: 'events', rec: { id: 'e', title: '結婚記念日', date: '2020-10-01', yearly: true, updatedAt: 1 } },
  ] });
  await post(`/api/rooms/${code}/push`, { subscription: SUB('mo-a'), who: 'a', prefs: { time: '07:30' } });
  const mine = async () => (await pushes()).filter(p => p.endpoint === SUB('mo-a').endpoint);

  await tick(day(28, 7, 0)); // 月曜 7:00 → まだ
  assert.strictEqual((await mine()).length, 0);
  await tick(day(28, 7, 31)); // 月曜 7:31 → 送る
  let got = await mine();
  assert.strictEqual(got.length, 1);
  assert.match(got[0].body, /燃えるゴミ出し/);
  assert.match(got[0].body, /お風呂掃除/);
  assert.doesNotMatch(got[0].body, /洗濯/);          // 相手の担当
  assert.match(got[0].body, /結婚記念日まであと3日/);
  await tick(day(28, 8, 0)); // 同じ日にもう一度は送らない
  assert.strictEqual((await mine()).length, 1);

  await tick(day(27, 20, 5)); // 日曜 20:05 → ふりかえり（+ その日の朝の分）
  got = await mine();
  assert.ok(got.some(p => p.tag === 'weekly'), JSON.stringify(got));
});

test('test push and unsubscribe', async () => {
  const code = await newRoom();
  await post(`/api/rooms/${code}/push`, { subscription: SUB('t'), who: 'b' });
  assert.strictEqual((await post(`/api/rooms/${code}/push/test`, { endpoint: SUB('t').endpoint })).status, 200);
  await post(`/api/rooms/${code}/push/delete`, { endpoint: SUB('t').endpoint });
  assert.strictEqual((await post(`/api/rooms/${code}/push/test`, { endpoint: SUB('t').endpoint })).status, 404);
});
