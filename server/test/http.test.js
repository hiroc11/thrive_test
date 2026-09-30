import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

async function start() {
  const { server } = createApp({ adminToken: 'admin-secret-token' });
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, token) => {
    const res = await fetch(base + p, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  return { server, base, call };
}

test('api: signup, auth, errors, static and security headers', async () => {
  const { server, base, call } = await start();
  try {
    assert.equal((await call('GET', '/api/me')).status, 401);
    const bad = await call('POST', '/api/signup', { nickname: 'a', birthYear: 2009 });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'not_agreed');
    const ok = await call('POST', '/api/signup', { nickname: 'あや', birthYear: 2009, agreed: true });
    assert.equal(ok.status, 200);
    const me = await call('GET', '/api/me', null, ok.body.token);
    assert.equal(me.body.nickname, 'あや');
    assert.equal((await call('GET', '/api/stickers', null, ok.body.token)).body.length, 4);
    assert.equal((await call('POST', '/api/packs/free', {}, ok.body.token)).status, 200);
    assert.equal((await call('POST', '/api/packs/free', {}, ok.body.token)).status, 409);
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal((await fetch(base + '/..%2f..%2fserver%2fsrc%2fdb.js')).status, 404);
    assert.equal((await call('GET', '/api/admin/metrics')).status, 404);
    const m = await fetch(base + '/api/admin/metrics', { headers: { 'x-admin-token': 'admin-secret-token' } });
    assert.equal((await m.json()).totals.users, 1);
    assert.equal((await fetch(base + '/api/admin/feedback', { headers: { 'x-admin-token': 'wrong-secret-tokenxx' } })).status, 404);
    assert.equal((await call('POST', '/api/feedback', { category: 'たのしかった', text: 'たのしい' }, ok.body.token)).status, 200);
    const fb = await fetch(base + '/api/admin/feedback', { headers: { 'x-admin-token': 'admin-secret-token' } });
    assert.equal((await fb.json())[0].text, 'たのしい');
    assert.equal((await call('POST', '/api/me/delete', {}, ok.body.token)).status, 200);
    assert.equal((await call('GET', '/api/me', null, ok.body.token)).status, 401);
  } finally { server.close(); }
});

test('api: SSE ticket delivers trade events to the friend', async () => {
  const { server, base, call } = await start();
  try {
    const a = (await call('POST', '/api/signup', { nickname: 'a', birthYear: 2009, agreed: true })).body;
    const b = (await call('POST', '/api/signup', { nickname: 'b', birthYear: 2009, agreed: true })).body;
    const bMe = (await call('GET', '/api/me', null, b.token)).body;
    const aMe = (await call('GET', '/api/me', null, a.token)).body;
    await call('POST', '/api/friends/request', { friendCode: bMe.friendCode }, a.token);
    const fr = await call('POST', '/api/friends/request', { friendCode: aMe.friendCode }, b.token);
    assert.equal(fr.body.status, 'friends');

    const { ticket } = (await call('POST', '/api/events/ticket', {}, b.token)).body;
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events?ticket=${ticket}`, { signal: ctrl.signal });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const got = (async () => {
      let text = '';
      while (!text.includes('event: trade')) text += new TextDecoder().decode((await reader.read()).value);
      return text;
    })();
    await call('POST', '/api/trades', { friendId: bMe.id }, a.token);
    assert.match(await got, /event: trade/);
    ctrl.abort();
    // 使い捨てチケットは2回使えない
    assert.equal((await fetch(`${base}/api/events?ticket=${ticket}`)).status, 401);
  } finally { server.close(); }
});
