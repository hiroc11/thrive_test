import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let server;
let base;

before(async () => {
  ({ server } = createApp({ dbPath: ':memory:' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

async function req(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const sample = {
  name: 'テストマンション 101',
  property_type: 'マンション',
  transaction_type: '売買',
  status: '募集中',
  price: '35,000,000',
  address: '東京都新宿区西新宿1-1-1',
  nearest_station: '新宿',
  walk_minutes: 6,
  floor_area: '55.5',
  layout: '2LDK',
  built_year: 2010,
};

test('物件のCRUD', async () => {
  const created = await req('POST', '/api/properties', sample);
  assert.equal(created.status, 201);
  assert.equal(created.json.price, 35000000);
  assert.equal(created.json.floor_area, 55.5);
  assert.equal(created.json.land_area, null);
  const id = created.json.id;

  const got = await req('GET', `/api/properties/${id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.name, sample.name);

  const updated = await req('PUT', `/api/properties/${id}`, { ...sample, status: '商談中', price: 34000000 });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.status, '商談中');
  assert.equal(updated.json.price, 34000000);

  const patched = await req('PATCH', `/api/properties/${id}`, { notes: '値下げ交渉中' });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.notes, '値下げ交渉中');
  assert.equal(patched.json.status, '商談中');

  const del = await req('DELETE', `/api/properties/${id}`);
  assert.equal(del.status, 204);
  assert.equal((await req('GET', `/api/properties/${id}`)).status, 404);
  assert.equal((await req('DELETE', `/api/properties/${id}`)).status, 404);
});

test('バリデーションエラー', async () => {
  const res = await req('POST', '/api/properties', { name: '', property_type: '城', transaction_type: '売買', status: '募集中', price: -1, walk_minutes: 'abc' });
  assert.equal(res.status, 400);
  assert.ok(res.json.errors.name);
  assert.ok(res.json.errors.property_type);
  assert.ok(res.json.errors.price);
  assert.ok(res.json.errors.walk_minutes);

  const bad = await fetch(base + '/api/properties', { method: 'POST', body: '{broken' });
  assert.equal(bad.status, 400);
});

test('検索・絞り込み・並び替え・集計', async () => {
  const items = [
    { ...sample, name: '渋谷レジデンス', price: 80000000, nearest_station: '渋谷', walk_minutes: 3 },
    { ...sample, name: '中野アパート', property_type: 'アパート', transaction_type: '賃貸', price: 85000, nearest_station: '中野', walk_minutes: 10 },
    { ...sample, name: '池袋 100%オフィス', property_type: '事務所', transaction_type: '賃貸', status: '成約済', price: 300000, nearest_station: '池袋', walk_minutes: 2 },
  ];
  for (const it of items) assert.equal((await req('POST', '/api/properties', it)).status, 201);

  let r = await req('GET', '/api/properties?q=' + encodeURIComponent('渋谷'));
  assert.deepEqual(r.json.items.map((p) => p.name), ['渋谷レジデンス']);

  // LIKEのワイルドカードはエスケープされる
  r = await req('GET', '/api/properties?q=' + encodeURIComponent('100%'));
  assert.deepEqual(r.json.items.map((p) => p.name), ['池袋 100%オフィス']);
  r = await req('GET', '/api/properties?q=' + encodeURIComponent('%'));
  assert.equal(r.json.total, 1);

  r = await req('GET', '/api/properties?transaction_type=' + encodeURIComponent('賃貸') + '&sort=price_asc');
  assert.deepEqual(r.json.items.map((p) => p.price), [85000, 300000]);

  r = await req('GET', '/api/properties?max_walk=5&sort=walk_asc');
  assert.deepEqual(r.json.items.map((p) => p.walk_minutes), [2, 3]);

  r = await req('GET', '/api/properties?sort=' + encodeURIComponent('price; DROP TABLE properties'));
  assert.equal(r.status, 200);

  const stats = await req('GET', '/api/stats');
  assert.equal(stats.json.total, 3);
  assert.equal(stats.json.byStatus['成約済'], 1);
  assert.equal(stats.json.byTransactionType['賃貸'], 2);
  assert.equal(stats.json.averagePrice['売買'], 80000000);
});

test('CSV出力', async () => {
  await req('POST', '/api/properties', { ...sample, name: '=HYPERLINK("x")', notes: '改行\nあり, カンマ' });
  const res = await fetch(base + '/api/properties/export.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 BOM
  const r = { text: bytes.subarray(3).toString('utf8') };
  assert.ok(r.text.startsWith('ID,物件名'));
  assert.ok(r.text.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(r.text.includes('"改行\nあり, カンマ"'));
});

test('静的ファイルとパストラバーサル対策', async () => {
  const index = await fetch(base + '/');
  assert.equal(index.status, 200);
  assert.match(await index.text(), /不動産情報管理/);
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
  assert.equal((await fetch(base + '/api/unknown')).status, 404);
});
