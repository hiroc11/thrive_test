'use strict';

// プッシュ通知: 相手の操作をきっかけにした通知と、毎朝・毎週の定時通知。

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const Logic = require('../app/logic.js');

const DRY_RUN = process.env.PUSH_DRY_RUN === '1'; // テスト用: 実際には送らず記録だけする
const MAX_SUBS_PER_ROOM = 10;
const MORNING_WINDOW_MIN = 180; // 再起動などで遅れても、この分数以内なら朝の通知を送る

const DEFAULT_PREFS = { morning: true, time: '08:00', shopping: true, partner: true, events: true, weekly: true };

let publicKey = null;
const sentLog = []; // DRY_RUN のときに送った通知

function init(dataDir) {
  const file = path.join(dataDir, 'vapid.json');
  let keys;
  try { keys = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  }
  const subject = process.env.VAPID_SUBJECT
    || (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : 'mailto:futari@example.com');
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  publicKey = keys.publicKey;
}

function validSubscription(s) {
  return s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string'
    && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
}

function cleanPrefs(p = {}) {
  const out = { ...DEFAULT_PREFS };
  for (const k of ['morning', 'shopping', 'partner', 'events', 'weekly']) if (typeof p[k] === 'boolean') out[k] = p[k];
  if (typeof p.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.time)) out.time = p.time;
  return out;
}

// 登録・更新。戻り値 false = 上限
function upsert(room, subscription, who, prefs) {
  room.subs = room.subs || {};
  const existing = room.subs[subscription.endpoint];
  if (!existing && Object.keys(room.subs).length >= MAX_SUBS_PER_ROOM) return false;
  room.subs[subscription.endpoint] = {
    subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
    who: who === 'b' ? 'b' : 'a',
    prefs: cleanPrefs(prefs),
    last: existing ? existing.last : {},
  };
  return true;
}

function removeSub(room, endpoint) {
  if (room.subs && room.subs[endpoint]) { delete room.subs[endpoint]; return true; }
  return false;
}

async function sendTo(room, sub, payload) {
  if (DRY_RUN) { sentLog.push({ endpoint: sub.subscription.endpoint, who: sub.who, ...payload }); return true; }
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 12 * 3600 });
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) removeSub(room, sub.subscription.endpoint); // 解除された端末
    else console.error('push failed', e.statusCode || e.message);
    return false;
  }
}

// ---------- データの読み出し ----------
const list = (room, col) => Logic.alive(Object.values((room.records || {})[col] || {}));
function namesOf(room) {
  const n = ((room.records || {}).settings || {}).names;
  return n && !n.deleted ? { a: n.a || 'ひとり目', b: n.b || 'ふたり目' } : { a: 'わたし', b: '奥さん' };
}
const cut = (s, n = 60) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };

// ---------- 相手の操作をきっかけにした通知 ----------
// 同期で受け付けた変更 (cur = 以前の値) から、誰に何を送るか決める
function describeChange(room, col, cur, rec) {
  if (rec.deleted) return null;
  const n = namesOf(room);
  const isNew = !cur || cur.deleted;
  switch (col) {
    case 'shopping':
      if (isNew && (rec.by === 'a' || rec.by === 'b')) {
        return { to: Logic.other(rec.by), pref: 'shopping', title: '🛒 買い物リスト', body: `${n[rec.by]}が「${cut(rec.name, 30)}」を追加しました`, tab: 'shopping', tag: 'shopping' };
      }
      return null;
    case 'thanks':
      if (isNew && (rec.from === 'a' || rec.from === 'b')) {
        return { to: Logic.other(rec.from), pref: 'partner', title: `💌 ${n[rec.from]}からありがとう`, body: cut(rec.text, 100), tab: 'futari' };
      }
      if (!isNew && rec.reaction && rec.reaction !== cur.reaction && (rec.from === 'a' || rec.from === 'b')) {
        return { to: rec.from, pref: 'partner', title: `${rec.reaction} ${n[Logic.other(rec.from)]}からリアクション`, body: cut(rec.text, 60), tab: 'futari' };
      }
      return null;
    case 'requests': {
      if (!(rec.from === 'a' || rec.from === 'b')) return null;
      const to = Logic.other(rec.from);
      if (isNew) return { to, pref: 'partner', title: `🙏 ${n[rec.from]}からお願い`, body: cut(rec.text, 100), tab: 'futari' };
      if (rec.status !== cur.status) {
        const msg = { accepted: '引き受けてくれました', done: 'やってくれました 🎉', declined: '今回はむずかしいそうです' }[rec.status];
        if (msg) return { to: rec.from, pref: 'partner', title: `🙏 ${n[to]}が${msg}`, body: cut(rec.text, 60), tab: 'futari' };
      }
      return null;
    }
    case 'log':
      if (isNew && rec.cover && (rec.for === 'a' || rec.for === 'b') && (rec.by === 'a' || rec.by === 'b')) {
        return { to: rec.for, pref: 'partner', title: '🧹 代わりにやってくれました', body: `${n[rec.by]}が「${cut(rec.title, 30)}」をやってくれました`, tab: 'home' };
      }
      return null;
    default:
      return null;
  }
}

const RECENT_MS = 6 * 3600 * 1000; // 同期参加時にまとめて届く古いデータでは通知しない

function onChanges(room, changed, now = Date.now()) {
  if (!room.subs) return;
  for (const { col, cur, rec } of changed) {
    if (now - rec.updatedAt > RECENT_MS) continue;
    const msg = describeChange(room, col, cur, rec);
    if (!msg) continue;
    for (const sub of Object.values(room.subs)) {
      if (sub.who === msg.to && sub.prefs[msg.pref]) {
        sendTo(room, sub, { title: msg.title, body: msg.body, tab: msg.tab, tag: msg.tag });
      }
    }
  }
}

// ---------- 定時通知 ----------
const minutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

function morningMessage(room, who, prefs, now) {
  const parts = [];
  if (prefs.morning) {
    const due = Logic.dueChoresFor(who, list(room, 'chores'), list(room, 'log'), now);
    if (due.length) parts.push(`今日の家事: ${due.slice(0, 5).map(x => x.c.title).join('、')}${due.length > 5 ? ` ほか${due.length - 5}件` : ''}`);
    const requests = list(room, 'requests').filter(r => r.to === who && (r.status === 'open' || r.status === 'accepted'));
    if (requests.length) parts.push(`お願い ${requests.length}件`);
  }
  if (prefs.events) {
    Logic.upcomingEvents(list(room, 'events'), now).forEach(x => {
      const l = Logic.eventLabel(x, now);
      if (l.days === 0) parts.push(`🎉 今日は${x.ev.title}${l.extra}`);
      else if (l.days === 3 || l.days === 7) parts.push(`📅 ${x.ev.title}まであと${l.days}日`);
    });
  }
  return parts.length ? { title: 'おはようございます ☀️', body: parts.join('\n'), tab: 'home', tag: 'morning' } : null;
}

function weeklyMessage(room, now) {
  const n = namesOf(room);
  const s = Logic.weekSummary({ log: list(room, 'log'), thanks: list(room, 'thanks'), requests: list(room, 'requests') }, now);
  const total = s.chores.a + s.chores.b;
  return {
    title: '📝 今週のふりかえり',
    body: `ふたりで家事${total}回（${n.a} ${s.chores.a}・${n.b} ${s.chores.b}）、ありがとう${s.thanks.a + s.thanks.b}回。おつかれさまでした！`,
    tab: 'futari', tag: 'weekly',
  };
}

// 1分ごとに呼ぶ。送信した件数を返す
async function tick(allRooms, now = new Date(), onDirty = () => {}) {
  let sent = 0;
  const today = Logic.ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const [code, room] of allRooms) {
    if (!room.subs) continue;
    for (const sub of Object.values(room.subs)) {
      sub.last = sub.last || {};
      const start = minutes(sub.prefs.time);
      if (sub.last.morning !== today && nowMin >= start && nowMin < start + MORNING_WINDOW_MIN) {
        sub.last.morning = today;
        onDirty(code, room);
        const msg = morningMessage(room, sub.who, sub.prefs, now);
        if (msg && await sendTo(room, sub, msg)) sent++;
      }
      if (sub.prefs.weekly && now.getDay() === 0 && sub.last.weekly !== today && nowMin >= 20 * 60 && nowMin < 23 * 60) {
        sub.last.weekly = today;
        onDirty(code, room);
        if (await sendTo(room, sub, weeklyMessage(room, now))) sent++;
      }
    }
  }
  return sent;
}

module.exports = {
  init, getPublicKey: () => publicKey, validSubscription, upsert, removeSub, sendTo, onChanges, tick,
  describeChange, morningMessage, sentLog, DRY_RUN,
};
