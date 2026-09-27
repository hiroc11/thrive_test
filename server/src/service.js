// ゲームのルールはすべてサーバー側で決める（抽選・通し番号・毎日の特典・交換）。
// 端末から来るのは「何をしたいか」だけで、結果はここで確定させる。
import crypto from 'node:crypto';
import { tx } from './db.js';
import { DESIGNS, DESIGN_OF, PACK_DESIGNS, ODDS } from '../../app/js/catalog.js';

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (code, message) => new AppError(400, code, message);
const notFound = (message = '見つかりません') => new AppError(404, 'not_found', message);
const forbidden = (message = 'できません') => new AppError(403, 'forbidden', message);

export const STAMPS = ['おねがい', 'ほしい！', 'むり〜', 'かわいい', 'いいよ！', 'ありがとう'];
export const REPORT_REASONS = ['いやなことをされた', 'なりすまし', 'ふさわしくない名前', 'そのほか'];
const MAX_OFFER = 6;
const STARTER = { normal: 3, rare: 1 };
const FRIEND_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DAY = 864e5;

// 日付は日本時間で切り替える（毎日の無料パック・スタンプ）
export const jstDay = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const randomCode = (n, alphabet = FRIEND_ALPHABET) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');

export function cleanNickname(raw) {
  const name = String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
    .trim();
  if (!name || [...name].length > 10) throw bad('bad_nickname', 'ニックネームは1〜10文字で入れてね');
  return name;
}

export function createService({ db, now = () => Date.now(), random = Math.random, publish = () => {} }) {
  const q = sql => db.prepare(sql);
  const parse = s => JSON.parse(s || '[]');

  // ---------- 分析 ----------
  function event(userId, type) {
    q('INSERT INTO events (user_id, day, type, at) VALUES (?, ?, ?, ?)').run(userId, jstDay(now()), type, now());
  }
  function markActive(userId) {
    const day = jstDay(now());
    const hit = q("SELECT 1 FROM events WHERE user_id = ? AND day = ? AND type = 'active'").get(userId, day);
    if (!hit) event(userId, 'active');
  }

  // ---------- シールの発行 ----------
  function issue(userId, code, via) {
    const d = DESIGN_OF[code];
    if (!d) throw bad('bad_code', 'そのシールはありません');
    const row = q('SELECT issued FROM serials WHERE code = ?').get(code);
    const next = (row ? row.issued : 0) + 1;
    if (next > d.of) throw new AppError(409, 'sold_out', 'このシールは全部発行済みです');
    q('INSERT INTO serials (code, issued) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET issued = excluded.issued').run(code, next);
    const top = q('SELECT MIN(pos) AS p FROM stickers WHERE user_id = ?').get(userId);
    const sticker = { id: crypto.randomUUID(), code, no: next, pos: (top.p ?? 1) - 1 };
    q('INSERT INTO stickers (id, user_id, code, no, pos, acquired_at, via) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sticker.id, userId, code, next, sticker.pos, now(), via);
    q('INSERT OR IGNORE INTO seen (user_id, code) VALUES (?, ?)').run(userId, code);
    return sticker;
  }
  const soldOut = code => {
    const row = q('SELECT issued FROM serials WHERE code = ?').get(code);
    return (row ? row.issued : 0) >= DESIGN_OF[code].of;
  };
  function weighted(list) {
    let roll = random() * list.reduce((t, [, w]) => t + w, 0);
    for (const [r, w] of list) { if ((roll -= w) < 0) return r; }
    return list[list.length - 1][0];
  }
  // 天井：10パックごとにレア以上、50パックでSレア以上が確定
  function drawCode(user, usePity) {
    let rarity, pity = false;
    if (usePity && user.since_sr >= 49) { rarity = weighted([['srare', 10], ['secret', 2]]); pity = true; }
    else if (usePity && user.since_rare >= 9) { rarity = weighted([['rare', 28], ['srare', 10], ['secret', 2]]); pity = true; }
    else rarity = weighted(ODDS);
    let choices = PACK_DESIGNS.filter(d => d.rarity === rarity && !soldOut(d.code));
    if (!choices.length) choices = PACK_DESIGNS.filter(d => !soldOut(d.code));
    if (!choices.length) throw new AppError(409, 'sold_out', 'シールが全部発行済みです');
    const d = choices[Math.floor(random() * choices.length)];
    if (usePity) {
      let { since_rare: r, since_sr: s } = user;
      if (d.rarity === 'srare' || d.rarity === 'secret') { r = 0; s = 0; }
      else if (d.rarity === 'rare') { r = 0; s += 1; }
      else { r += 1; s += 1; }
      q('UPDATE users SET since_rare = ?, since_sr = ? WHERE id = ?').run(r, s, user.id);
    }
    return { code: d.code, pity };
  }
  const stickerOut = row => ({ id: row.id, code: row.code, no: row.no });

  // ---------- アカウント ----------
  function newToken(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    q('INSERT INTO tokens (hash, user_id, created_at) VALUES (?, ?, ?)').run(sha(token), userId, now());
    return token;
  }

  function signup({ nickname, birthYear, agreed }) {
    if (agreed !== true) throw bad('not_agreed', '利用規約とプライバシーポリシーへの同意が必要です');
    const name = cleanNickname(nickname);
    const year = Number(birthYear);
    const thisYear = new Date(now()).getFullYear();
    if (!Number.isInteger(year) || year < thisYear - 110 || year > thisYear - 6) throw bad('bad_birth_year', '生まれた年を正しく入れてね');
    return tx(db, () => {
      const id = crypto.randomUUID();
      let code;
      do { code = randomCode(8); } while (q('SELECT 1 FROM users WHERE friend_code = ?').get(code));
      q('INSERT INTO users (id, nickname, birth_year, friend_code, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, year, code, now());
      // はじめのシール：ノーマル3枚とレア1枚
      for (const [rarity, n] of Object.entries(STARTER)) {
        const pool = PACK_DESIGNS.filter(d => d.rarity === rarity);
        for (let i = 0; i < n; i++) issue(id, pool[Math.floor(random() * pool.length)].code, 'starter');
      }
      event(id, 'signup');
      event(id, 'active');
      return { token: newToken(id), userId: id };
    });
  }

  function auth(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const row = q('SELECT user_id FROM tokens WHERE hash = ?').get(sha(token));
    return row ? row.user_id : null;
  }

  const getUser = id => {
    const u = q('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw notFound('アカウントがありません');
    return u;
  };

  function me(userId) {
    markActive(userId);
    const u = getUser(userId);
    const day = jstDay(now());
    return {
      id: u.id, nickname: u.nickname, friendCode: u.friend_code,
      daily: { freePackAvailable: u.free_day !== day, stamps: u.stamps, stampedToday: u.stamp_day === day },
      pity: { rare: 10 - u.since_rare, srare: 50 - u.since_sr }
    };
  }

  function rename(userId, nickname) {
    q('UPDATE users SET nickname = ? WHERE id = ?').run(cleanNickname(nickname), userId);
    notifyFriends(userId, { type: 'friends' });
    return me(userId);
  }

  // 引き継ぎコード：12文字、7日間有効、1回だけ使える
  function transferIssue(userId) {
    const code = randomCode(12);
    q('UPDATE transfer_codes SET used = 1 WHERE user_id = ? AND used = 0').run(userId);
    q('INSERT INTO transfer_codes (hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(code), userId, now() + 7 * DAY);
    return { code: `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`, expiresAt: now() + 7 * DAY };
  }
  function transferClaim(raw) {
    const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return tx(db, () => {
      const row = q('SELECT * FROM transfer_codes WHERE hash = ?').get(sha(code));
      if (!row || row.used || row.expires_at < now()) throw bad('bad_transfer_code', '引き継ぎコードがちがうか、期限切れです');
      q('UPDATE transfer_codes SET used = 1 WHERE hash = ?').run(row.hash);
      // 前の端末からはログアウトさせる（なりすまし防止）
      q('DELETE FROM tokens WHERE user_id = ?').run(row.user_id);
      return { token: newToken(row.user_id) };
    });
  }

  // ---------- シール帳 ----------
  function listStickers(userId) {
    return q('SELECT id, code, no FROM stickers WHERE user_id = ? ORDER BY pos, acquired_at DESC').all(userId).map(stickerOut);
  }

  function reorder(userId, ids) {
    if (!Array.isArray(ids)) throw bad('bad_ids', '並び順がおかしいです');
    return tx(db, () => {
      const mine = new Set(q('SELECT id FROM stickers WHERE user_id = ?').all(userId).map(r => r.id));
      if (ids.length !== mine.size || new Set(ids).size !== ids.length || !ids.every(id => mine.has(id))) {
        throw new AppError(409, 'stale', 'シール帳が変わったので、もう一度読み込んでね');
      }
      const upd = q('UPDATE stickers SET pos = ? WHERE id = ?');
      ids.forEach((id, i) => upd.run(i, id));
      return listStickers(userId);
    });
  }

  function zukan(userId) {
    const seenCodes = q('SELECT code FROM seen WHERE user_id = ?').all(userId).map(r => r.code);
    const counts = {};
    q('SELECT code, COUNT(*) AS n FROM stickers WHERE user_id = ? GROUP BY code').all(userId).forEach(r => { counts[r.code] = r.n; });
    return { seen: seenCodes, counts, total: DESIGNS.length };
  }

  // ---------- 毎日 ----------
  function checkin(userId) {
    return tx(db, () => {
      const u = getUser(userId);
      const day = jstDay(now());
      if (u.stamp_day === day) return { stamps: u.stamps, stamped: false, reward: null };
      let stamps = u.stamps + 1, reward = null;
      if (stamps >= 7) {
        reward = stickerOut(issue(userId, 'ganbari', 'stamp'));
        stamps = 0;
      }
      q('UPDATE users SET stamps = ?, stamp_day = ? WHERE id = ?').run(stamps, day, userId);
      return { stamps, stamped: true, reward };
    });
  }

  function freePack(userId) {
    return tx(db, () => {
      const u = getUser(userId);
      const day = jstDay(now());
      if (u.free_day === day) throw new AppError(409, 'already_opened', '今日の無料パックはもう開けたよ。また明日！');
      q('UPDATE users SET free_day = ? WHERE id = ?').run(day, userId);
      const { code, pity } = drawCode(u, true);
      const sticker = stickerOut(issue(userId, code, 'free_pack'));
      event(userId, 'pack');
      return { sticker, pity, left: DESIGN_OF[code].of - q('SELECT issued FROM serials WHERE code = ?').get(code).issued };
    });
  }

  // ---------- 友達 ----------
  const areFriends = (a, b) => !!q('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(a, b);
  const blockedEither = (a, b) => !!q('SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)').get(a, b, b, a);
  const friendIds = userId => q('SELECT friend_id FROM friends WHERE user_id = ?').all(userId).map(r => r.friend_id);
  function notifyFriends(userId, msg) { publish(friendIds(userId), msg); }
  function makeFriends(a, b) {
    const ins = q('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)');
    ins.run(a, b, now());
    ins.run(b, a, now());
  }

  function requestFriend(userId, rawCode) {
    const code = String(rawCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return tx(db, () => {
      const target = q('SELECT id FROM users WHERE friend_code = ?').get(code);
      // ブロックされている相手にも「見つからない」と同じ返事をして、ブロックに気づかせない
      if (!target || target.id === userId || blockedEither(userId, target.id)) throw notFound('そのフレンドコードの人は見つかりません');
      if (areFriends(userId, target.id)) return { status: 'already' };
      // 相手からも申請が来ていたら、その場で友達になる
      const reverse = q("SELECT id FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'").get(target.id, userId);
      if (reverse) {
        q("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(reverse.id);
        makeFriends(userId, target.id);
        publish([userId, target.id], { type: 'friends' });
        return { status: 'friends' };
      }
      const dup = q("SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'").get(userId, target.id);
      if (!dup) q("INSERT INTO friend_requests (id, from_id, to_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)").run(crypto.randomUUID(), userId, target.id, now());
      publish([target.id], { type: 'friends' });
      return { status: 'requested' };
    });
  }

  function respondFriend(userId, requestId, accept) {
    return tx(db, () => {
      const r = q("SELECT * FROM friend_requests WHERE id = ? AND to_id = ? AND status = 'pending'").get(requestId, userId);
      if (!r) throw notFound('その申請はありません');
      q('UPDATE friend_requests SET status = ? WHERE id = ?').run(accept ? 'accepted' : 'declined', r.id);
      if (accept) makeFriends(userId, r.from_id);
      publish([userId, r.from_id], { type: 'friends' });
      return listFriends(userId);
    });
  }

  function listFriends(userId) {
    const friends = q(`SELECT u.id, u.nickname, u.friend_code FROM friends f JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ? ORDER BY f.created_at`).all(userId).map(u => ({ id: u.id, nickname: u.nickname, friendCode: u.friend_code }));
    const incoming = q(`SELECT r.id, u.nickname FROM friend_requests r JOIN users u ON u.id = r.from_id
      WHERE r.to_id = ? AND r.status = 'pending' ORDER BY r.created_at`).all(userId).map(r => ({ id: r.id, nickname: r.nickname }));
    const outgoing = q(`SELECT u.nickname FROM friend_requests r JOIN users u ON u.id = r.to_id
      WHERE r.from_id = ? AND r.status = 'pending' ORDER BY r.created_at`).all(userId).map(r => ({ nickname: r.nickname }));
    const trades = q(`SELECT id, a, b, mode, version FROM trades WHERE status = 'open' AND (a = ? OR b = ?)`).all(userId, userId)
      .map(t => ({ id: t.id, friendId: t.a === userId ? t.b : t.a, mode: t.mode }));
    return { friends, incoming, outgoing, trades };
  }

  function unfriend(userId, friendId) {
    tx(db, () => {
      q('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(userId, friendId, friendId, userId);
      cancelPairTrades(userId, friendId);
    });
    publish([userId, friendId], { type: 'friends' });
    return listFriends(userId);
  }

  function block(userId, targetId) {
    if (targetId === userId) throw bad('bad_target', '自分はブロックできません');
    tx(db, () => {
      q('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').run(userId, targetId, now());
      q('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(userId, targetId, targetId, userId);
      q("UPDATE friend_requests SET status = 'declined' WHERE status = 'pending' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))").run(userId, targetId, targetId, userId);
      cancelPairTrades(userId, targetId);
    });
    publish([userId, targetId], { type: 'friends' });
    return listFriends(userId);
  }

  function report(userId, targetId, reason) {
    if (!REPORT_REASONS.includes(reason)) throw bad('bad_reason', '理由を選んでね');
    if (!q('SELECT 1 FROM users WHERE id = ?').get(targetId)) throw notFound();
    q('INSERT INTO reports (id, reporter_id, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), userId, targetId, reason, now());
    return { ok: true };
  }

  function friendStickers(userId, friendId) {
    if (!areFriends(userId, friendId)) throw forbidden('友達のシール帳だけ見られます');
    return listStickers(friendId);
  }

  // ---------- 交換 ----------
  function cancelPairTrades(a, b) {
    const open = q("SELECT id FROM trades WHERE status = 'open' AND ((a = ? AND b = ?) OR (a = ? AND b = ?))").all(a, b, b, a);
    open.forEach(t => q("UPDATE trades SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now(), t.id));
  }

  const side = (t, userId) => {
    if (t.a === userId) return ['a', 'b'];
    if (t.b === userId) return ['b', 'a'];
    throw notFound('その交換はありません');
  };
  const getTrade = id => {
    const t = q('SELECT * FROM trades WHERE id = ?').get(id);
    if (!t) throw notFound('その交換はありません');
    return t;
  };
  const ownedBy = (ids, userId) => ids.every(id => q('SELECT 1 FROM stickers WHERE id = ? AND user_id = ?').get(id, userId));
  const stickersByIds = ids => ids.map(id => q('SELECT id, code, no FROM stickers WHERE id = ?').get(id)).filter(Boolean).map(stickerOut);

  function tradeView(userId, id) {
    const t = getTrade(id);
    const [me, them] = side(t, userId);
    const other = getUser(t[them]);
    const myOffer = parse(t[me + '_offer']);
    const theirOffer = parse(t[them + '_offer']);
    const hidden = t.mode === 'blind' && t.status === 'open';
    return {
      id: t.id, mode: t.mode, status: t.status, version: t.version,
      friend: { id: other.id, nickname: other.nickname },
      me: { offer: stickersByIds(myOffer), ask: parse(t[me + '_ask']), ready: t[me + '_ready'] === t.version, stamp: t[me + '_stamp'] ? JSON.parse(t[me + '_stamp']) : null },
      them: {
        offer: hidden ? [] : stickersByIds(theirOffer),
        placed: theirOffer.length,
        ask: parse(t[them + '_ask']),
        ready: t[them + '_ready'] === t.version,
        stamp: t[them + '_stamp'] ? JSON.parse(t[them + '_stamp']) : null
      },
      result: t.result ? (() => { const r = JSON.parse(t.result); return { got: stickersByIds(r[me + 'Got']), gave: stickersByIds(r[them + 'Got']) }; })() : null
    };
  }

  function openTrade(userId, friendId, mode = 'normal') {
    if (!['normal', 'blind'].includes(mode)) throw bad('bad_mode', '交換のしかたがおかしいです');
    if (!areFriends(userId, friendId)) throw forbidden('交換は友達とだけできます');
    const id = tx(db, () => {
      const t = q("SELECT id FROM trades WHERE status = 'open' AND ((a = ? AND b = ?) OR (a = ? AND b = ?))").get(userId, friendId, friendId, userId);
      if (t) return t.id;
      const nid = crypto.randomUUID();
      q("INSERT INTO trades (id, a, b, mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?)").run(nid, userId, friendId, mode, now(), now());
      return nid;
    });
    publish([friendId], { type: 'trade', id });
    publish([friendId], { type: 'friends' });
    return tradeView(userId, id);
  }

  // 中身が変わったら version を上げて、両方の「せーの」を取り消す
  function mutate(userId, id, fn) {
    const view = tx(db, () => {
      const t = getTrade(id);
      const [me, them] = side(t, userId);
      if (t.status !== 'open') throw new AppError(409, 'closed', 'この交換はもう終わっています');
      if (!areFriends(userId, t[them])) throw forbidden('交換は友達とだけできます');
      const changes = fn(t, me, them);
      if (changes) {
        const sets = Object.keys(changes).map(k => `${k} = ?`);
        q(`UPDATE trades SET ${sets.join(', ')}, version = version + 1, a_ready = -1, b_ready = -1, updated_at = ? WHERE id = ?`)
          .run(...Object.values(changes), now(), id);
      }
      return t;
    });
    publish([view.a, view.b], { type: 'trade', id });
    return tradeView(userId, id);
  }

  const idList = v => {
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw bad('bad_ids', 'シールの指定がおかしいです');
    return [...new Set(v)];
  };

  function setOffer(userId, id, raw) {
    const ids = idList(raw);
    return mutate(userId, id, (t, me) => {
      const max = t.mode === 'blind' ? 1 : MAX_OFFER;
      if (ids.length > max) throw bad('too_many', t.mode === 'blind' ? 'ふせて交換は1枚だけだよ' : `出せるのは${MAX_OFFER}枚までだよ`);
      if (!ownedBy(ids, userId)) throw new AppError(409, 'not_owned', '持っていないシールは出せません');
      return { [me + '_offer']: JSON.stringify(ids) };
    });
  }

  function setAsk(userId, id, raw) {
    const ids = idList(raw).slice(0, 10);
    return mutate(userId, id, (t, me, them) => {
      if (t.mode === 'blind') throw bad('blind', 'ふせて交換ではおねだりできません');
      if (!ownedBy(ids, t[them])) throw new AppError(409, 'not_owned', '相手が持っていないシールです');
      return { [me + '_ask']: JSON.stringify(ids) };
    });
  }

  function setMode(userId, id, mode) {
    if (!['normal', 'blind'].includes(mode)) throw bad('bad_mode', '交換のしかたがおかしいです');
    return mutate(userId, id, t => (t.mode === mode ? null : { mode, a_offer: '[]', b_offer: '[]', a_ask: '[]', b_ask: '[]' }));
  }

  // スタンプは中身を変えないので「せーの」は取り消さない
  function stamp(userId, id, text) {
    if (!STAMPS.includes(text)) throw bad('bad_stamp', 'そのスタンプはありません');
    const t = getTrade(id);
    const [me] = side(t, userId);
    if (t.status !== 'open') throw new AppError(409, 'closed', 'この交換はもう終わっています');
    q(`UPDATE trades SET ${me}_stamp = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify({ text, at: now() }), now(), id);
    publish([t.a, t.b], { type: 'trade', id });
    return tradeView(userId, id);
  }

  function cancel(userId, id) {
    const t = getTrade(id);
    side(t, userId);
    if (t.status === 'open') q("UPDATE trades SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now(), id);
    publish([t.a, t.b], { type: 'trade', id });
    publish([t.a, t.b], { type: 'friends' });
    return tradeView(userId, id);
  }

  // 「せーの」：2人とも同じ version でせーのしたら、その場で入れ替える
  function ready(userId, id, version) {
    const done = tx(db, () => {
      const t = getTrade(id);
      const [me, them] = side(t, userId);
      if (t.status !== 'open') throw new AppError(409, 'closed', 'この交換はもう終わっています');
      if (version !== t.version) throw new AppError(409, 'stale', '相手が中身を変えたので、もう一度確かめてね');
      if (!areFriends(userId, t[them])) throw forbidden('交換は友達とだけできます');
      q(`UPDATE trades SET ${me}_ready = ?, updated_at = ? WHERE id = ?`).run(t.version, now(), id);
      if (t[them + '_ready'] !== t.version) return false;

      const aOffer = parse(t.a_offer), bOffer = parse(t.b_offer);
      if (t.mode === 'blind' && (aOffer.length !== 1 || bOffer.length !== 1)) throw bad('blind_need_one', 'ふせて交換は1枚ずつ出してね');
      if (!aOffer.length && !bOffer.length) throw bad('empty', 'まだどちらもシールを出していません');
      if (!ownedBy(aOffer, t.a) || !ownedBy(bOffer, t.b)) {
        q('UPDATE trades SET a_ready = -1, b_ready = -1 WHERE id = ?').run(id);
        throw new AppError(409, 'not_owned', '出したシールがもう手元にありません');
      }
      const move = (ids, to) => ids.forEach(sid => {
        const top = q('SELECT MIN(pos) AS p FROM stickers WHERE user_id = ?').get(to);
        q("UPDATE stickers SET user_id = ?, pos = ?, acquired_at = ?, via = 'trade' WHERE id = ?").run(to, (top.p ?? 1) - 1, now(), sid);
        const { code } = q('SELECT code FROM stickers WHERE id = ?').get(sid);
        q('INSERT OR IGNORE INTO seen (user_id, code) VALUES (?, ?)').run(to, code);
      });
      move(aOffer, t.b);
      move(bOffer, t.a);
      q("UPDATE trades SET status = 'done', result = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ aGot: bOffer, bGot: aOffer }), now(), id);
      event(t.a, 'trade');
      event(t.b, 'trade');
      return true;
    });
    const t = getTrade(id);
    publish([t.a, t.b], { type: 'trade', id });
    if (done) publish([t.a, t.b], { type: 'stickers' });
    return tradeView(userId, id);
  }

  // ---------- 運営用の数字 ----------
  function metrics(days = 14) {
    const today = jstDay(now());
    const dayList = Array.from({ length: days }, (_, i) => jstDay(now() - (days - 1 - i) * DAY));
    const dau = dayList.map(d => ({ day: d, active: q("SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE day = ? AND type = 'active'").get(d).n }));
    const retention = [1, 7, 30].map(n => {
      const cohort = q("SELECT user_id, day FROM events WHERE type = 'signup'").all()
        .filter(r => jstDay(Date.parse(r.day + 'T00:00:00+09:00') + n * DAY) <= today);
      const back = cohort.filter(r => q("SELECT 1 FROM events WHERE user_id = ? AND type = 'active' AND day = ?")
        .get(r.user_id, jstDay(Date.parse(r.day + 'T00:00:00+09:00') + n * DAY))).length;
      return { day: n, cohort: cohort.length, returned: back, rate: cohort.length ? back / cohort.length : null };
    });
    const totals = {
      users: q('SELECT COUNT(*) AS n FROM users').get().n,
      stickers: q('SELECT COUNT(*) AS n FROM stickers').get().n,
      trades: q("SELECT COUNT(*) AS n FROM trades WHERE status = 'done'").get().n,
      reports: q('SELECT COUNT(*) AS n FROM reports').get().n
    };
    return { dau, retention, totals };
  }

  return {
    signup, auth, me, rename, transferIssue, transferClaim,
    listStickers, reorder, zukan, checkin, freePack,
    requestFriend, respondFriend, listFriends, unfriend, block, report, friendStickers,
    openTrade, tradeView, setOffer, setAsk, setMode, stamp, cancel, ready,
    metrics
  };
}
