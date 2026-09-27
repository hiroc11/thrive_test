import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createService, AppError, jstDay } from '../src/service.js';

function setup(start = Date.parse('2026-10-01T03:00:00Z')) {
  const clock = { t: start };
  const sent = [];
  const svc = createService({ db: openDb(), now: () => clock.t, publish: (ids, msg) => sent.push({ ids, msg }) });
  const user = name => {
    const { token, userId } = svc.signup({ nickname: name, birthYear: 2009, agreed: true });
    return { token, id: userId, code: svc.me(userId).friendCode };
  };
  const nextDay = () => { clock.t += 864e5; };
  return { svc, clock, sent, user, nextDay };
}
const befriend = (svc, a, b) => { svc.requestFriend(a.id, b.code); svc.requestFriend(b.id, a.code); };
const rejects = (fn, code) => assert.throws(fn, e => e instanceof AppError && e.code === code);

test('signup validates input and gives starter stickers', () => {
  const { svc } = setup();
  rejects(() => svc.signup({ nickname: 'あや', birthYear: 2009, agreed: false }), 'not_agreed');
  rejects(() => svc.signup({ nickname: '', birthYear: 2009, agreed: true }), 'bad_nickname');
  rejects(() => svc.signup({ nickname: 'あいうえおかきくけこさ', birthYear: 2009, agreed: true }), 'bad_nickname');
  rejects(() => svc.signup({ nickname: 'あや', birthYear: 1800, agreed: true }), 'bad_birth_year');
  const { token, userId } = svc.signup({ nickname: ' あや​ ', birthYear: 2009, agreed: true });
  assert.equal(svc.auth(token), userId);
  assert.equal(svc.auth('x'.repeat(40)), null);
  assert.equal(svc.me(userId).nickname, 'あや');
  assert.equal(svc.listStickers(userId).length, 4);
});

test('serial numbers are unique and increase per design', () => {
  const { svc, user } = setup();
  const all = [];
  for (let i = 0; i < 30; i++) all.push(...svc.listStickers(user('u' + i).id));
  const keys = all.map(s => `${s.code}-${s.no}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('free pack once per JST day, resets at JST midnight', () => {
  const { svc, clock, user } = setup(Date.parse('2026-10-01T14:30:00Z')); // 23:30 JST
  const a = user('a');
  assert.equal(svc.freePack(a.id).sticker.code.length > 0, true);
  rejects(() => svc.freePack(a.id), 'already_opened');
  clock.t += 45 * 60e3; // 00:15 JST 翌日
  assert.equal(jstDay(clock.t), '2026-10-02');
  assert.ok(svc.freePack(a.id).sticker);
  assert.equal(svc.me(a.id).daily.freePackAvailable, false);
});

test('pity guarantees rare or better on the 10th pack', () => {
  const clock = { t: Date.parse('2026-10-01T03:00:00Z') };
  const svc = createService({ db: openDb(), now: () => clock.t, random: () => 0 }); // 常にノーマルを引く乱数
  const { userId } = svc.signup({ nickname: 'p', birthYear: 2008, agreed: true });
  const results = [];
  for (let i = 0; i < 10; i++) { results.push(svc.freePack(userId)); clock.t += 864e5; }
  assert.ok(results.slice(0, 9).every(r => !r.pity));
  assert.equal(results[9].pity, true);
  assert.equal(svc.me(userId).pity.rare, 10);
});

test('login stamps: once per day, reward on the 7th, never lost for skipping', () => {
  const { svc, user, nextDay } = setup();
  const a = user('a');
  assert.equal(svc.checkin(a.id).stamps, 1);
  assert.equal(svc.checkin(a.id).stamped, false);
  for (let i = 0; i < 4; i++) { nextDay(); svc.checkin(a.id); }
  nextDay(); nextDay(); nextDay(); // 3日休む
  assert.equal(svc.checkin(a.id).stamps, 6);
  nextDay();
  const r = svc.checkin(a.id);
  assert.equal(r.stamps, 0);
  assert.equal(r.reward.code, 'ganbari');
  assert.ok(svc.zukan(a.id).seen.includes('ganbari'));
});

test('friends: request, mutual auto-accept, block hides and cancels', () => {
  const { svc, user } = setup();
  const a = user('a'), b = user('b'), c = user('c');
  assert.equal(svc.requestFriend(a.id, b.code).status, 'requested');
  const req = svc.listFriends(b.id).incoming[0];
  svc.respondFriend(b.id, req.id, true);
  assert.equal(svc.listFriends(a.id).friends[0].id, b.id);
  assert.equal(svc.requestFriend(a.id, c.code).status, 'requested');
  assert.equal(svc.requestFriend(c.id, a.code).status, 'friends');
  rejects(() => svc.requestFriend(a.id, a.code), 'not_found');
  svc.openTrade(a.id, b.id);
  svc.block(b.id, a.id);
  assert.equal(svc.listFriends(a.id).friends.some(f => f.id === b.id), false);
  assert.equal(svc.listFriends(a.id).trades.length, 0);
  rejects(() => svc.requestFriend(a.id, b.code), 'not_found');
  rejects(() => svc.openTrade(a.id, b.id), 'forbidden');
  rejects(() => svc.friendStickers(c.id, b.id), 'forbidden');
});

test('normal trade swaps atomically after both ready on same version', () => {
  const { svc, user } = setup();
  const a = user('a'), b = user('b');
  befriend(svc, a, b);
  const [a1] = svc.listStickers(a.id), [b1, b2] = svc.listStickers(b.id);
  let t = svc.openTrade(a.id, b.id);
  assert.equal(svc.openTrade(b.id, a.id).id, t.id); // 同じ2人の交換は1つだけ
  rejects(() => svc.setOffer(a.id, t.id, [b1.id]), 'not_owned');
  svc.setOffer(a.id, t.id, [a1.id]);
  t = svc.setOffer(b.id, t.id, [b1.id, b2.id]);
  svc.ready(a.id, t.id, t.version);
  // 相手が中身を変えたら、せーのはやり直し
  t = svc.setOffer(b.id, t.id, [b1.id]);
  assert.equal(t.them.ready, false);
  rejects(() => svc.ready(a.id, t.id, t.version - 1), 'stale');
  svc.ready(a.id, t.id, t.version);
  const done = svc.ready(b.id, t.id, t.version);
  assert.equal(done.status, 'done');
  assert.deepEqual(done.result.got.map(s => s.id), [a1.id]);
  assert.ok(svc.listStickers(a.id).some(s => s.id === b1.id));
  assert.ok(!svc.listStickers(a.id).some(s => s.id === a1.id));
  rejects(() => svc.setOffer(a.id, t.id, []), 'closed');
});

test('blind trade hides the other card until done and needs one each', () => {
  const { svc, user } = setup();
  const a = user('a'), b = user('b');
  befriend(svc, a, b);
  const [a1, a2] = svc.listStickers(a.id), [b1] = svc.listStickers(b.id);
  let t = svc.openTrade(a.id, b.id, 'blind');
  rejects(() => svc.setOffer(a.id, t.id, [a1.id, a2.id]), 'too_many');
  svc.setOffer(a.id, t.id, [a1.id]);
  t = svc.setOffer(b.id, t.id, [b1.id]);
  const seenByA = svc.tradeView(a.id, t.id);
  assert.equal(seenByA.them.offer.length, 0);
  assert.equal(seenByA.them.placed, 1);
  svc.ready(a.id, t.id, t.version);
  const done = svc.ready(b.id, t.id, t.version);
  assert.equal(done.result.got[0].id, a1.id);
});

test('a sticker given away elsewhere cannot be traded', () => {
  const { svc, user } = setup();
  const a = user('a'), b = user('b'), c = user('c');
  befriend(svc, a, b); befriend(svc, a, c);
  const [a1] = svc.listStickers(a.id), [b1] = svc.listStickers(b.id), [c1] = svc.listStickers(c.id);
  const t1 = svc.openTrade(a.id, b.id), t2 = svc.openTrade(a.id, c.id);
  svc.setOffer(a.id, t1.id, [a1.id]); const v1 = svc.setOffer(b.id, t1.id, [b1.id]).version;
  svc.setOffer(a.id, t2.id, [a1.id]); const v2 = svc.setOffer(c.id, t2.id, [c1.id]).version;
  svc.ready(a.id, t1.id, v1); svc.ready(b.id, t1.id, v1);
  svc.ready(a.id, t2.id, v2);
  rejects(() => svc.ready(c.id, t2.id, v2), 'not_owned');
  assert.ok(svc.listStickers(c.id).some(s => s.id === c1.id));
});

test('reorder requires the full current set', () => {
  const { svc, user } = setup();
  const a = user('a');
  const ids = svc.listStickers(a.id).map(s => s.id);
  const rev = [...ids].reverse();
  assert.deepEqual(svc.reorder(a.id, rev).map(s => s.id), rev);
  rejects(() => svc.reorder(a.id, rev.slice(1)), 'stale');
});

test('transfer code moves the account and logs out the old device', () => {
  const { svc, user } = setup();
  const a = user('a');
  const { code } = svc.transferIssue(a.id);
  const { token } = svc.transferClaim(code.toLowerCase());
  assert.equal(svc.auth(token), a.id);
  assert.equal(svc.auth(a.token), null);
  rejects(() => svc.transferClaim(code), 'bad_transfer_code');
});

test('metrics count retention', () => {
  const { svc, user, nextDay } = setup();
  const a = user('a'); user('b');
  nextDay();
  svc.me(a.id);
  const m = svc.metrics();
  const d1 = m.retention.find(r => r.day === 1);
  assert.equal(d1.cohort, 2);
  assert.equal(d1.returned, 1);
  assert.equal(m.totals.users, 2);
});
