'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const http = require('node:http');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const MOCK_PORT = PORT + 1000;
// Claude API の代わりに応答する偽サーバー（レシート読み取りのテスト用）
const mockRequests = [];
let mockReply = null;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    mockRequests.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5',
      content: [{ type: 'text', text: JSON.stringify(mockReply) }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
});
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'futari-test-'));
let proc;

function startServer() {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
      env: {
        ...process.env, PORT: String(PORT), DATA_DIR: dataDir, PUSH_DRY_RUN: '1', TZ: 'Asia/Tokyo',
        ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_WORKSPACE_ID: 'wrkspc_test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`, RECEIPT_DAILY_LIMIT: '3',
      },
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

before(async () => { await new Promise(r => mock.listen(MOCK_PORT, r)); await startServer(); });
after(async () => { await stopServer(); mock.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

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

// ---------- カレンダー ----------
test('publishes a calendar feed behind a read-only token', async () => {
  const code = await newRoom();
  await post(`/api/rooms/${code}/sync`, { since: 0, changes: [
    { col: 'settings', rec: { id: 'names', a: 'ひろ', b: 'ゆき', updatedAt: 5 } },
    { col: 'events', rec: { id: 'e1', title: '結婚記念日', date: '2020-10-10', yearly: true, updatedAt: 5 } },
    { col: 'requests', rec: { id: 'r1', from: 'b', to: 'a', text: '電球', due: '2026-10-03', status: 'open', updatedAt: 5 } },
    { col: 'requests', rec: { id: 'r2', from: 'b', to: 'a', text: '済んだ', due: '2026-10-03', status: 'done', updatedAt: 5 } },
    { col: 'chores', rec: { id: 'c1', title: 'ゴミ出し', assignee: 'a', days: [1, 4], every: 0, points: 1, updatedAt: 5 } },
  ] });
  const { token } = await post(`/api/rooms/${code}/calendar`, {}).then(r => r.json());
  assert.match(token, /^[A-Za-z0-9_-]{20,}$/);
  // 2回目は同じトークン
  assert.strictEqual((await post(`/api/rooms/${code}/calendar`, {}).then(r => r.json())).token, token);

  let res = await fetch(`${BASE}/api/cal/${token}.ics`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/calendar/);
  let body = await res.text();
  assert.match(body, /SUMMARY:💞 結婚記念日\r\nRRULE:FREQ=YEARLY/);
  assert.match(body, /DTSTART;VALUE=DATE:20261003/);
  assert.match(body, /ひろへ: 電球/);
  assert.doesNotMatch(body, /済んだ/);
  assert.doesNotMatch(body, /ゴミ出し/);
  body = await (await fetch(`${BASE}/api/cal/${token}.ics?chores=1`)).text();
  assert.match(body, /SUMMARY:🧹 ゴミ出し（ひろ）\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH/);

  // 作り直すと前のURLは使えない
  const { token: token2 } = await post(`/api/rooms/${code}/calendar`, { reset: true }).then(r => r.json());
  assert.notStrictEqual(token2, token);
  assert.strictEqual((await fetch(`${BASE}/api/cal/${token}.ics`)).status, 404);
  assert.strictEqual((await fetch(`${BASE}/api/cal/${token2}.ics`)).status, 200);
});

// ---------- レシート ----------
test('reads a receipt through the Claude API', async () => {
  const features = await fetch(BASE + '/api/features').then(r => r.json());
  assert.deepStrictEqual(features, { receipt: true });

  const code = await newRoom();
  mockReply = { is_receipt: true, store: 'スーパーふたり', date: '2026-09-26', total: 1234.4, items: [{ name: '牛乳', price: 198 }] };
  const res = await post(`/api/rooms/${code}/receipt`, { mediaType: 'image/jpeg', data: Buffer.from('fake-jpeg').toString('base64') });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { is_receipt: true, store: 'スーパーふたり', date: '2026-09-26', total: 1234, items: [{ name: '牛乳', price: 198 }] });

  const sent = mockRequests.at(-1);
  assert.match(sent.url, /^\/v1\/messages/);
  assert.strictEqual(sent.headers['x-api-key'], 'test-key');
  assert.strictEqual(sent.headers['anthropic-workspace-id'], 'wrkspc_test');
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.strictEqual(sent.body.model, 'claude-opus-5');
  assert.strictEqual(sent.body.fallbacks, 'default');
  assert.strictEqual(sent.body.output_config.format.type, 'json_schema');
  const [image, text] = sent.body.messages[0].content;
  assert.deepStrictEqual(image, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('fake-jpeg').toString('base64') } });
  assert.strictEqual(text.type, 'text');
});

test('rejects bad receipt images and enforces the daily limit', async () => {
  const code = await newRoom();
  assert.strictEqual((await post(`/api/rooms/${code}/receipt`, { mediaType: 'text/html', data: 'x' })).status, 400);
  mockReply = { is_receipt: false, store: '', date: '', total: 0, items: [] };
  const img = { mediaType: 'image/png', data: Buffer.from('png').toString('base64') };
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await post(`/api/rooms/${code}/receipt`, img)).status);
  // 形式エラーは回数に数えない（上限 3）
  assert.deepStrictEqual(statuses, [200, 200, 200, 429]);
});
