'use strict';

// ---------- データ ----------
// レコードはすべて { id, updatedAt, deleted? } を持ち、同期では updatedAt が新しい方を採用する。
// 削除は deleted: true の「墓標」を残して相手の端末にも伝える。
const STORE_KEY = 'futari-store-v2';     // { rev, records: { col: { id: rec } } }  ふたりで共有するデータ
const PENDING_KEY = 'futari-pending-v2'; // ["col/id", ...]  まだサーバーに送っていない変更
const DEVICE_KEY = 'futari-device-v2';   // { me, clientId, sync: { server, room } | null, push: { endpoint, prefs } | null }  この端末だけの設定
const LEGACY_KEY = 'futari-data-v1';

const COLLECTIONS = ['settings', 'chores', 'log', 'shopping', 'thanks', 'events', 'requests', 'expenses', 'stock', 'notes'];
// 初期データは updatedAt: 1 にしておき、どちらかの端末で編集されればそちらが勝つようにする
const SEED = {
  settings: [{ id: 'names', a: 'わたし', b: '奥さん', updatedAt: 1 }],
  chores: [
    { id: 'c1', title: '食器洗い', assignee: 'a', every: 1, points: 1, updatedAt: 1 },
    { id: 'c2', title: 'ゴミ出し', assignee: 'a', every: 3, points: 1, updatedAt: 1 },
    { id: 'c3', title: '洗濯', assignee: 'b', every: 2, points: 2, updatedAt: 1 },
    { id: 'c4', title: 'お風呂掃除', assignee: 'both', every: 7, points: 2, updatedAt: 1 },
  ],
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

function readJson(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast('保存に失敗しました'); }
}

function emptyStore() {
  const records = {};
  COLLECTIONS.forEach(c => { records[c] = {}; });
  return { rev: 0, records };
}

function seededStore() {
  const s = emptyStore();
  for (const [col, recs] of Object.entries(SEED)) recs.forEach(r => { s.records[col][r.id] = { ...r }; });
  return s;
}

let store = readJson(STORE_KEY, null);
let pending = new Set(readJson(PENDING_KEY, []));
const device = readJson(DEVICE_KEY, null) || { me: 'a', clientId: uid(), sync: null };

if (!store) {
  // 旧バージョンのデータがあればそれを引き継ぎ、なければ初期データで始める
  store = readJson(LEGACY_KEY, null) ? emptyStore() : seededStore();
  migrateLegacy();
}
COLLECTIONS.forEach(c => { store.records[c] = store.records[c] || {}; });

// v1（同期なし版）のデータを引き継ぐ
function migrateLegacy() {
  const old = readJson(LEGACY_KEY, null);
  if (!old) return;
  const now = Date.now();
  const put = (col, rec) => { store.records[col][rec.id] = { ...rec, updatedAt: now }; pending.add(`${col}/${rec.id}`); };
  if (old.settings?.names) put('settings', { id: 'names', ...old.settings.names });
  if (old.settings?.me) device.me = old.settings.me;
  (old.chores || []).forEach(({ lastDone, ...c }) => put('chores', c));
  ['log', 'shopping', 'thanks', 'events'].forEach(col => (old[col] || []).forEach(r => put(col, r)));
  persist();
  try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* 無視 */ }
}

function persist() {
  writeJson(STORE_KEY, store);
  writeJson(PENDING_KEY, [...pending]);
  writeJson(DEVICE_KEY, device);
}

const all = col => Object.values(store.records[col]).filter(r => !r.deleted);
const get = (col, id) => { const r = store.records[col][id]; return r && !r.deleted ? r : null; };

function put(col, rec) {
  const prev = store.records[col][rec.id];
  // 同じ端末での連続編集でも必ず新しくなるようにする
  const updatedAt = Math.max(Date.now(), prev ? prev.updatedAt + 1 : 0);
  store.records[col][rec.id] = { ...rec, updatedAt };
  pending.add(`${col}/${rec.id}`);
  persist();
  sync.soon();
}

function remove(col, id) {
  if (store.records[col][id]) put(col, { id, deleted: true });
}

// 受け取った変更を取り込む。変わったものがあれば true
function mergeRemote(changes) {
  let changed = false;
  for (const { col, rec } of changes) {
    if (!store.records[col] || !rec || typeof rec.id !== 'string') continue;
    const cur = store.records[col][rec.id];
    if (cur && cur.updatedAt >= rec.updatedAt) continue;
    store.records[col][rec.id] = rec;
    pending.delete(`${col}/${rec.id}`);
    changed = true;
  }
  return changed;
}

// ---------- 同期 ----------
const sync = {
  status: 'local', // local | syncing | ok | offline
  busy: false,
  again: false,
  timer: null,
  retryTimer: null,
  retryDelay: 2000,
  source: null,

  get enabled() { return !!device.sync; },
  api(p) { return `${device.sync.server.replace(/\/+$/, '')}/api/rooms/${device.sync.room}${p}`; },

  soon() {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), 300);
  },

  async run() {
    if (!this.enabled) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    clearTimeout(this.retryTimer);
    this.setStatus('syncing');
    const sent = [...pending].map(key => {
      const [col, id] = key.split('/');
      const rec = store.records[col]?.[id];
      return rec ? { col, rec } : null;
    }).filter(Boolean);
    try {
      const res = await fetch(this.api('/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: store.rev, client: device.clientId, changes: sent }),
      });
      if (res.status === 404) throw Object.assign(new Error('room'), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      // 送信中に再編集されていなければ送信済みとする
      sent.forEach(({ col, rec }) => {
        if (store.records[col][rec.id]?.updatedAt === rec.updatedAt) pending.delete(`${col}/${rec.id}`);
      });
      const changed = mergeRemote(body.changes || []);
      store.rev = body.rev;
      persist();
      this.retryDelay = 2000;
      this.setStatus(pending.size ? 'syncing' : 'ok');
      if (changed) renderSoon();
      if (pending.size) this.again = true;
    } catch (e) {
      this.setStatus('offline');
      if (e.fatal) toast('共有コードが見つかりません。設定を確認してください');
      else {
        this.retryTimer = setTimeout(() => this.run(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 60000);
      }
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.run(); }
    }
  },

  connect() {
    this.disconnect();
    if (!this.enabled) { this.setStatus('local'); return; }
    if ('EventSource' in window) {
      this.source = new EventSource(this.api(`/events?client=${encodeURIComponent(device.clientId)}`));
      this.source.onmessage = () => this.run();
    }
    this.run();
  },

  disconnect() {
    if (this.source) { this.source.close(); this.source = null; }
    clearTimeout(this.retryTimer);
  },

  setStatus(s) {
    this.status = s;
    const el = document.getElementById('sync-status');
    if (!el) return;
    const map = {
      local: ['', 'この端末のみ'], syncing: ['syncing', '同期中…'], ok: ['ok', '同期済み'], offline: ['offline', 'オフライン'],
    };
    el.className = `sync-dot ${map[s][0]}`;
    el.title = map[s][1];
    el.setAttribute('aria-label', map[s][1]);
  },
};

window.addEventListener('online', () => sync.run());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.run(); });
setInterval(() => { if (document.visibilityState === 'visible') sync.run(); }, 60000);

async function createRoom(server) {
  const res = await fetch(`${server.replace(/\/+$/, '')}/api/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).code;
}

async function joinRoom(server, room, me) {
  // 存在確認
  const res = await fetch(`${server.replace(/\/+$/, '')}/api/rooms/${room}/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: 0, changes: [] }),
  });
  if (res.status === 404) throw new Error('共有コードが見つかりません');
  if (!res.ok) throw new Error(`サーバーエラー (${res.status})`);
  device.sync = { server, room };
  device.me = me;
  store.rev = 0;
  // この端末の既存データもまとめて送る（ふたりのデータを合体）。
  // 初期データ（updatedAt: 1）も送るが、相手が編集・削除済みならサーバー側でそちらが優先される
  for (const col of COLLECTIONS) {
    for (const rec of Object.values(store.records[col])) pending.add(`${col}/${rec.id}`);
  }
  persist();
  sync.connect();
  pushUpdate();
}

function leaveRoom() {
  sync.disconnect();
  device.sync = null;
  store.rev = 0;
  persist();
  sync.setStatus('local');
}

// ---------- ユーティリティ ----------
const L = window.Logic;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const names = () => get('settings', 'names') || SEED.settings[0];
const name = who => who === 'both' ? 'ふたり' : names()[who];
const other = L.other;
const DAY = L.DAY;
const byNewest = (x, y) => (y.at || 0) - (x.at || 0);
const fmtYen = n => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const today = () => L.ymd(new Date());

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function sendThanks(text) {
  put('thanks', { id: uid(), from: device.me, text, at: Date.now() });
}

// ---------- 家事 ----------
function completeChore(id) {
  const c = get('chores', id);
  if (!c) return;
  const me = device.me;
  const who = L.assigneeOf(c, all('log'));
  const cover = who !== 'both' && who !== me;
  put('log', { id: uid(), choreId: c.id, title: c.title, by: me, at: Date.now(), points: c.points, ...(cover ? { cover: true, for: who } : {}) });
  toast(cover ? `代わりにやったことを${name(who)}に伝えます` : `「${c.title}」おつかれさま！`);
}

function weekPoints() {
  return L.weekSummary({ log: all('log') }).points;
}

// ---------- プッシュ通知 ----------
const DEFAULT_PUSH_PREFS = { morning: true, time: '08:00', shopping: true, partner: true, events: true, weekly: true };
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

async function postPush(action, body) {
  const res = await fetch(sync.api(`/push${action ? '/' + action : ''}`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function enablePush() {
  if (!sync.enabled) { toast('先にふたりの同期をつないでください'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('通知が許可されませんでした。端末の設定で許可してください'); return; }
  const reg = await navigator.serviceWorker.ready;
  const { key } = await (await fetch(`${device.sync.server.replace(/\/+$/, '')}/api/push/key`)).json();
  const opts = { userVisibleOnly: true, applicationServerKey: b64ToBytes(key) };
  let sub;
  try { sub = await reg.pushManager.subscribe(opts); } catch (e) {
    // 別のサーバー鍵で登録済みだった場合は作り直す
    const old = await reg.pushManager.getSubscription();
    if (old) await old.unsubscribe();
    sub = await reg.pushManager.subscribe(opts);
  }
  device.push = { endpoint: sub.endpoint, prefs: device.push?.prefs || { ...DEFAULT_PUSH_PREFS } };
  persist();
  await postPush('', { subscription: sub.toJSON(), who: device.me, prefs: device.push.prefs });
  toast('通知をオンにしました');
}

// 担当者の切り替えや設定変更をサーバーに伝える
async function pushUpdate() {
  if (!device.push || !sync.enabled || !pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) { device.push = null; persist(); return; }
    device.push.endpoint = sub.endpoint;
    persist();
    await postPush('', { subscription: sub.toJSON(), who: device.me, prefs: device.push.prefs });
  } catch (e) { /* オフラインなど。次回起動時に再送 */ }
}

async function disablePush() {
  const endpoint = device.push?.endpoint;
  device.push = null;
  persist();
  try {
    if (endpoint && sync.enabled) await postPush('delete', { endpoint });
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) { /* 無視 */ }
}

// ---------- 画面 ----------
const view = document.getElementById('view');
const TABS = ['home', 'chores', 'shopping', 'futari', 'more'];
const SUBPAGES = ['events', 'budget', 'notes', 'settings'];
const titles = {
  home: 'ホーム', chores: '家事', shopping: '買い物', futari: 'ふたり', more: 'その他',
  events: '記念日', budget: '家計簿', notes: '共有メモ', settings: '設定',
};
let tab = TABS.includes(location.hash.slice(1)) || SUBPAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
let ui = {}; // 画面ごとの一時的な状態（編集中の家事、開いているメモなど）
let renderDeferred = false;

function go(t) {
  if (!titles[t]) return;
  tab = t;
  ui = {};
  try { history.replaceState(null, '', `#${t}`); } catch (e) { /* 無視 */ }
  render();
  window.scrollTo(0, 0);
}

function render() {
  renderDeferred = false;
  const sub = SUBPAGES.includes(tab);
  document.getElementById('page-title').textContent = titles[tab];
  document.getElementById('back').hidden = !sub;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === (sub ? 'more' : tab)));
  document.getElementById('me-toggle').textContent = `👤 ${name(device.me)}`;
  view.innerHTML = screens[tab]();
}

// 相手の変更で再描画するとき、入力中の文字が消えないようにする
function renderSoon() {
  const a = document.activeElement;
  if (a && view.contains(a) && a.matches('input, textarea, select')) renderDeferred = true;
  else render();
}
view.addEventListener('focusout', () => setTimeout(() => {
  if (renderDeferred && !view.contains(document.activeElement)) render();
}, 0));

// ---------- 画面の部品 ----------
function balanceCard() {
  const p = weekPoints();
  const total = p.a + p.b;
  const pa = total ? Math.round((p.a / total) * 100) : 50;
  return `
    <div class="card">
      <h2>この7日間の家事バランス</h2>
      <div class="balance">
        <div style="width:${pa}%;background:var(--a)"></div>
        <div style="width:${100 - pa}%;background:var(--b)"></div>
      </div>
      <div class="legend">
        <span>${esc(name('a'))} ${p.a}pt</span>
        <span>${esc(name('b'))} ${p.b}pt</span>
      </div>
      ${total === 0 ? '<p class="muted">家事を完了するとポイントが記録されます</p>' : ''}
    </div>`;
}

const ROTATE_LABEL = { each: '🔁 毎回交代', weekly: '🔁 毎週交代' };

function choreItem({ c, st, who }, withMenu) {
  return `
    <li>
      <button class="check" data-act="done-chore" data-id="${esc(c.id)}" aria-label="完了にする"></button>
      <div class="grow">
        <div class="title">${esc(c.title)}</div>
        <div class="muted">${esc(L.scheduleLabel(c))} · ${c.points}pt · ${esc(st.label)}${c.rotate && c.assignee !== 'both' ? ` · ${ROTATE_LABEL[c.rotate]}` : ''}</div>
      </div>
      <span class="tag ${esc(who)}">${esc(name(who))}</span>
      ${withMenu ? `<button class="icon-btn" data-act="edit-chore" data-id="${esc(c.id)}" aria-label="編集">✏️</button>` : ''}
    </li>`;
}

function choreForm(c) {
  const schedule = c ? (Array.isArray(c.days) && c.days.length ? 'days' : String(c.every ?? 1)) : '1';
  const days = c?.days || [];
  const opt = (v, label, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
  return `
    <form class="add" data-form="chore" data-id="${esc(c?.id || '')}">
      <input name="title" placeholder="例: 掃除機がけ" required maxlength="40" value="${esc(c?.title || '')}">
      <div class="row">
        <label class="field">担当
          <select name="assignee">
            ${opt('a', esc(name('a')), c?.assignee || device.me)}${opt('b', esc(name('b')), c?.assignee || device.me)}${opt('both', 'ふたり', c?.assignee)}
          </select>
        </label>
        <label class="field">大変さ
          <select name="points">${opt(1, '軽い 1pt', c?.points ?? 1)}${opt(2, '普通 2pt', c?.points)}${opt(3, '重い 3pt', c?.points)}</select>
        </label>
      </div>
      <div class="row">
        <label class="field">予定
          <select name="schedule">
            ${opt(1, '毎日', schedule)}${opt(2, '2日ごと', schedule)}${opt(3, '3日ごと', schedule)}${opt(7, '毎週', schedule)}
            ${opt(14, '2週ごと', schedule)}${opt(30, '毎月', schedule)}${opt(0, '1回だけ', schedule)}${opt('days', '曜日で決める', schedule)}
          </select>
        </label>
        <label class="field">交代
          <select name="rotate">${opt('', '固定', c?.rotate || '')}${opt('each', '毎回交代', c?.rotate)}${opt('weekly', '毎週交代', c?.rotate)}</select>
        </label>
      </div>
      <div class="days-row" ${schedule === 'days' ? '' : 'hidden'}>
        ${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="day"><input type="checkbox" name="days" value="${d}" ${days.includes(d) ? 'checked' : ''}><span>${L.WEEKDAYS[d]}</span></label>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn">${c ? '保存' : '追加'}</button>
        ${c ? `<button type="button" class="btn ghost" data-act="cancel-edit">キャンセル</button>
               <button type="button" class="btn ghost danger" data-act="del-chore" data-id="${esc(c.id)}">削除</button>` : ''}
      </div>
    </form>`;
}

const REACTIONS = ['❤️', '😊', '🙏', '😂'];

function thanksItem(t) {
  const me = device.me;
  const mine = t.from === me;
  return `
    <li>
      <span class="tag ${esc(t.from)}">${esc(name(t.from))}</span>
      <div class="grow">
        <div class="note">${esc(t.text)}</div>
        <div class="muted">${fmtDate(t.at)}${mine && t.reaction ? ` · ${esc(name(other(t.from)))}から ${esc(t.reaction)}` : ''}</div>
        ${mine ? '' : `<div class="reactions">${REACTIONS.map(r => `<button class="react ${t.reaction === r ? 'on' : ''}" data-act="react" data-id="${esc(t.id)}" data-r="${r}" aria-label="${r}">${r}</button>`).join('')}</div>`}
      </div>
      ${mine ? `<button class="icon-btn" data-act="del-thanks" data-id="${esc(t.id)}" aria-label="削除">🗑</button>` : ''}
    </li>`;
}

const REQUEST_STATUS = { open: 'お返事待ち', accepted: '引き受け済み', done: '完了', declined: 'むずかしい' };

// ---------- 各画面 ----------
const screens = {
  home() {
    const me = device.me;
    const due = L.choresWithStatus(all('chores'), all('log')).filter(x => x.st.due);
    const mine = due.filter(x => x.who === me || x.who === 'both');
    const up = L.upcomingEvents(all('events'))[0];
    const lastThanks = all('thanks').sort(byNewest)[0];
    const shopLeft = all('shopping').filter(s => !s.done).length;
    const covered = all('log').filter(l => l.cover && l.for === me && !l.thanked && Date.now() - l.at < 3 * DAY).sort(byNewest);
    const requests = all('requests').filter(r => r.to === me && (r.status === 'open' || r.status === 'accepted'));
    const lowStock = all('stock').filter(s => s.low).length;
    const showPushHint = sync.enabled && pushSupported() && (!isIos || isStandalone()) && !device.push && !device.pushHintOff;
    return `
      ${!sync.enabled ? `<div class="card hint">
        <h2>ふたりの端末をつなげましょう</h2>
        <p class="muted">共有コードでつなぐと、家事や買い物リストがふたりのスマホで自動的に同期されます。</p>
        <button class="btn small" data-goto="settings">つなぐ</button>
      </div>` : ''}
      ${showPushHint ? `<div class="card hint">
        <h2>🔔 通知をオンにしませんか？</h2>
        <p class="muted">朝の家事リマインド、買い物リストの追加、ありがとうやお願いが届いたときにお知らせします。</p>
        <div class="btn-row"><button class="btn small" data-act="enable-push">オンにする</button><button class="btn small ghost" data-act="push-hint-off">あとで</button></div>
      </div>` : ''}
      ${covered.map(l => `<div class="card hint">
        <h2>🧹 ${esc(name(l.by))}が代わりにやってくれました</h2>
        <p>「${esc(l.title)}」 <span class="muted">${fmtDate(l.at)}</span></p>
        <button class="btn small" data-act="thank-cover" data-id="${esc(l.id)}">ありがとうを送る</button>
      </div>`).join('')}
      ${requests.length ? `<div class="card">
        <h2>🙏 ${esc(name(other(me)))}からのお願い ${requests.length}件</h2>
        <ul class="list">${requests.slice(0, 3).map(r => `<li><div class="grow">${esc(r.text)}</div><span class="muted">${REQUEST_STATUS[r.status]}</span></li>`).join('')}</ul>
        <button class="btn small ghost" data-goto="futari">見る</button>
      </div>` : ''}
      <div class="card">
        <h2>今日やること（${esc(name(me))}）</h2>
        ${mine.length ? `<ul class="list">${mine.map(x => choreItem(x, false)).join('')}</ul>` : '<p class="empty">今日の担当家事はありません 🎉</p>'}
        ${due.length > mine.length ? `<p class="muted">${esc(name(other(me)))}の担当で残っている家事: ${due.length - mine.length}件（代わりにやると伝わります）</p>` : ''}
      </div>
      ${balanceCard()}
      <div class="card">
        <h2>次の記念日</h2>
        ${up ? (() => { const l = L.eventLabel(up); return `<div class="big">${esc(l.when)}</div><div>${esc(up.ev.title)}${esc(l.extra)} · ${l.dateText}</div>`; })()
             : '<p class="empty">その他 → 記念日 から登録できます</p>'}
      </div>
      <div class="card">
        <h2>最近のありがとう</h2>
        ${lastThanks ? `<ul class="list">${thanksItem(lastThanks)}</ul>` : '<p class="empty">小さなことでも「ありがとう」を残してみましょう</p>'}
        <p><button class="btn small" data-goto="futari">ありがとうを書く</button></p>
      </div>
      <div class="card">
        <h2>買い物リスト</h2>
        <p>${shopLeft ? `未購入 ${shopLeft}件` : '買うものはありません'}${lowStock ? ` · 残りわずか ${lowStock}件` : ''}</p>
        <button class="btn small ghost" data-goto="shopping">開く</button>
      </div>`;
  },

  chores() {
    const list = L.choresWithStatus(all('chores'), all('log'))
      .sort((x, y) => (y.st.due - x.st.due) || x.c.title.localeCompare(y.c.title, 'ja'));
    const log = all('log').sort(byNewest).slice(0, 20);
    const editing = ui.editChore && get('chores', ui.editChore);
    const existing = new Set(all('chores').map(c => c.title));
    const cat = ui.presetCat ?? 0;
    return `
      ${editing ? `<div class="card hint"><h2>家事を編集</h2>${choreForm(editing)}</div>` : ''}
      <div class="card">
        <h2>家事リスト</h2>
        ${list.length ? `<ul class="list">${list.map(x => choreItem(x, true)).join('')}</ul>` : '<p class="empty">家事を追加しましょう</p>'}
      </div>
      <div class="card">
        <h2>よくある家事から選ぶ</h2>
        <div class="chips">${L.PRESETS.map((p, i) => `<button class="chip ${i === cat ? 'on' : ''}" data-act="preset-cat" data-id="${i}">${esc(p.cat)}</button>`).join('')}</div>
        <ul class="list">${L.PRESETS[cat].items.map((p, i) => `
          <li>
            <div class="grow"><div class="title">${esc(p.title)}</div><div class="muted">${esc(L.scheduleLabel(p))} · ${p.points}pt</div></div>
            ${existing.has(p.title) ? '<span class="muted">✓ 追加済み</span>' : `<button class="btn small" data-act="add-preset" data-id="${i}">＋ 追加</button>`}
          </li>`).join('')}</ul>
        <p class="muted">追加した家事は、あとから ✏️ で担当や曜日を変えられます。</p>
      </div>
      <div class="card">
        <h2>自分で追加</h2>
        ${choreForm(null)}
      </div>
      ${balanceCard()}
      <div class="card">
        <h2>最近の記録</h2>
        ${log.length ? `<ul class="list">${log.map(l => `
          <li>
            <span class="tag ${esc(l.by)}">${esc(name(l.by))}</span>
            <div class="grow"><div class="title">${esc(l.title)}${l.cover ? ' <span class="badge">代わりに</span>' : ''}</div><div class="muted">${fmtDate(l.at)} · ${l.points}pt</div></div>
            <button class="icon-btn" data-act="undo-log" data-id="${esc(l.id)}" aria-label="取り消し">↩︎</button>
          </li>`).join('')}</ul>` : '<p class="empty">まだ記録がありません</p>'}
      </div>`;
  },

  shopping() {
    const items = all('shopping').sort((x, y) => (x.done - y.done) || (x.at || 0) - (y.at || 0));
    const stock = all('stock').sort((x, y) => (y.low - x.low) || x.name.localeCompare(y.name, 'ja'));
    return `
      <div class="card">
        <form class="add" data-form="shop">
          <div class="row"><input name="name" placeholder="例: 牛乳" required maxlength="40"><button class="btn" style="flex:0 0 auto">追加</button></div>
        </form>
      </div>
      <div class="card">
        ${items.length ? `<ul class="list">${items.map(s => `
          <li class="${s.done ? 'done' : ''}">
            <button class="check ${s.done ? 'on' : ''}" data-act="toggle-shop" data-id="${esc(s.id)}" aria-label="購入済みにする">${s.done ? '✓' : ''}</button>
            <div class="grow"><div class="title">${esc(s.name)}</div><div class="muted">${esc(name(s.by))}が追加${s.stockId ? ' · 在庫から' : ''}</div></div>
            <button class="icon-btn" data-act="del-shop" data-id="${esc(s.id)}" aria-label="削除">🗑</button>
          </li>`).join('')}</ul>` : '<p class="empty">買うものはありません</p>'}
        ${items.some(s => s.done) ? '<p><button class="btn small ghost" data-act="clear-shop">購入済みを消す</button></p>' : ''}
      </div>
      <div class="card">
        <h2>在庫チェック</h2>
        <p class="muted">「少ない」にすると買い物リストに自動で入ります。買ったら「ある」に戻ります。</p>
        ${stock.length ? `<ul class="list">${stock.map(s => `
          <li>
            <div class="grow"><div class="title">${esc(s.name)}</div></div>
            <button class="stock-btn ${s.low ? 'low' : ''}" data-act="toggle-stock" data-id="${esc(s.id)}">${s.low ? '少ない' : 'ある'}</button>
            <button class="icon-btn" data-act="del-stock" data-id="${esc(s.id)}" aria-label="削除">🗑</button>
          </li>`).join('')}</ul>` : `<p><button class="btn small ghost" data-act="stock-presets">よくある日用品を追加</button></p>`}
        <form class="add" data-form="stock" style="margin-top:10px">
          <div class="row"><input name="name" placeholder="例: 洗濯洗剤" required maxlength="40"><button class="btn ghost" style="flex:0 0 auto">追加</button></div>
        </form>
      </div>`;
  },

  futari() {
    const me = device.me;
    const s = L.weekSummary({ log: all('log'), thanks: all('thanks'), requests: all('requests') });
    const reqs = all('requests').sort(byNewest);
    const forMe = reqs.filter(r => r.to === me && (r.status === 'open' || r.status === 'accepted'));
    const fromMe = reqs.filter(r => r.from === me && r.status !== 'done');
    const done = reqs.filter(r => r.status === 'done' && Date.now() - (r.doneAt || 0) < 14 * DAY);
    const thanks = all('thanks').sort(byNewest);
    const row = (label, key, unit) => `<tr><th>${label}</th><td>${s[key].a}${unit}</td><td>${s[key].b}${unit}</td></tr>`;
    const covers = s.cover.a + s.cover.b;
    return `
      <div class="card">
        <h2>📝 この7日間のふりかえり</h2>
        <table class="summary">
          <tr><th></th><td><span class="tag a">${esc(name('a'))}</span></td><td><span class="tag b">${esc(name('b'))}</span></td></tr>
          ${row('家事', 'chores', '回')}${row('ポイント', 'points', 'pt')}${row('ありがとう', 'thanks', '回')}${row('お願いに応えた', 'requestsDone', '回')}
        </table>
        <p class="muted">${covers ? `代わりにやった家事が${covers}回ありました。` : ''}${s.thanks.a + s.thanks.b ? 'ありがとうを伝え合えていますね。' : '今週はまだありがとうがありません。ひとこと送ってみませんか？'}</p>
      </div>
      <div class="card">
        <h2>🙏 ${esc(name(other(me)))}へのお願い</h2>
        <form class="add" data-form="request">
          <input name="text" placeholder="例: 今度の休みに電球を替えてほしい" required maxlength="100">
          <div class="row"><label class="field">いつまでに（任意）<input type="date" name="due"></label></div>
          <button class="btn">お願いする</button>
        </form>
      </div>
      ${forMe.length ? `<div class="card hint">
        <h2>${esc(name(other(me)))}からのお願い</h2>
        <ul class="list">${forMe.map(r => `
          <li>
            <div class="grow"><div class="title">${esc(r.text)}</div><div class="muted">${r.due ? `${esc(r.due)}まで · ` : ''}${REQUEST_STATUS[r.status]}</div></div>
            <div class="btn-col">${r.status === 'open'
              ? `<button class="btn small" data-act="req-accept" data-id="${esc(r.id)}">引き受ける</button><button class="btn small ghost" data-act="req-decline" data-id="${esc(r.id)}">むずかしい</button>`
              : `<button class="btn small" data-act="req-done" data-id="${esc(r.id)}">やった！</button>`}</div>
          </li>`).join('')}</ul>
      </div>` : ''}
      ${fromMe.length ? `<div class="card">
        <h2>お願いしたこと</h2>
        <ul class="list">${fromMe.map(r => `
          <li>
            <div class="grow"><div class="title">${esc(r.text)}</div><div class="muted">${r.due ? `${esc(r.due)}まで · ` : ''}${REQUEST_STATUS[r.status]}</div></div>
            <button class="icon-btn" data-act="req-cancel" data-id="${esc(r.id)}" aria-label="取り消し">🗑</button>
          </li>`).join('')}</ul>
      </div>` : ''}
      ${done.length ? `<div class="card">
        <h2>かなったお願い</h2>
        <ul class="list">${done.map(r => `
          <li class="done">
            <span class="tag ${esc(r.to)}">${esc(name(r.to))}</span>
            <div class="grow"><div class="title">${esc(r.text)}</div></div>
            ${r.from === me && !r.thanked ? `<button class="btn small" data-act="req-thanks" data-id="${esc(r.id)}">ありがとう</button>` : ''}
          </li>`).join('')}</ul>
      </div>` : ''}
      <div class="card">
        <h2>💌 ${esc(name(other(me)))}へのありがとう</h2>
        <form class="add" data-form="thanks">
          <textarea name="text" placeholder="例: 今日ご飯を作ってくれてありがとう。すごくおいしかった！" required maxlength="300"></textarea>
          <button class="btn">送る</button>
        </form>
      </div>
      <div class="card">
        <h2>これまでのありがとう</h2>
        ${thanks.length ? `<ul class="list">${thanks.slice(0, ui.thanksAll ? undefined : 20).map(thanksItem).join('')}</ul>` : '<p class="empty">まだありません</p>'}
        ${thanks.length > 20 && !ui.thanksAll ? '<button class="btn small ghost" data-act="thanks-all">もっと見る</button>' : ''}
      </div>`;
  },

  more() {
    const up = L.upcomingEvents(all('events'))[0];
    const net = L.balance(all('expenses'));
    const item = (t, icon, sub) => `
      <li><button class="menu-item" data-goto="${t}"><span class="menu-icon">${icon}</span>
        <span class="grow"><span class="title">${titles[t]}</span><span class="muted">${sub}</span></span><span class="muted">›</span></button></li>`;
    return `
      <div class="card"><ul class="list menu">
        ${item('events', '📅', up ? esc(`${up.ev.title} ${L.eventLabel(up).when}`) : '結婚記念日や誕生日のカウントダウン')}
        ${item('budget', '💰', net ? esc(`${name(net > 0 ? 'b' : 'a')} → ${name(net > 0 ? 'a' : 'b')} ${fmtYen(Math.abs(net))}`) : 'ふたりの支出と立て替えの精算')}
        ${item('notes', '📝', `${all('notes').length}件 · Wi-Fi、ゴミの分別ルールなど`)}
        ${item('settings', '⚙️', '同期・通知・名前・バックアップ')}
      </ul></div>`;
  },

  events() {
    const up = L.upcomingEvents(all('events'));
    const past = all('events').filter(ev => !up.some(u => u.ev.id === ev.id));
    return `
      <div class="card">
        <h2>記念日・予定を追加</h2>
        <form class="add" data-form="event">
          <input name="title" placeholder="例: 結婚記念日 / 誕生日 / 旅行" required maxlength="40">
          <div class="row">
            <input name="date" type="date" required>
            <label class="field inline"><input type="checkbox" name="yearly" checked> 毎年</label>
          </div>
          <button class="btn">追加</button>
        </form>
        <p class="muted">通知をオンにすると、7日前・3日前・当日の朝にお知らせします。</p>
      </div>
      <div class="card">
        <h2>これから</h2>
        ${up.length ? `<ul class="list">${up.map(x => { const l = L.eventLabel(x); return `
          <li>
            <div class="grow"><div class="title">${esc(x.ev.title)}${esc(l.extra)}</div><div class="muted">${l.dateText}${x.ev.yearly ? ' · 毎年' : ''}</div></div>
            <strong>${esc(l.when)}</strong>
            <button class="icon-btn" data-act="del-event" data-id="${esc(x.ev.id)}" aria-label="削除">🗑</button>
          </li>`; }).join('')}</ul>` : '<p class="empty">登録された記念日はありません</p>'}
      </div>
      ${past.length ? `<div class="card"><h2>過ぎた予定</h2><ul class="list">${past.map(ev => `
          <li class="done"><div class="grow"><div class="title">${esc(ev.title)}</div><div class="muted">${esc(ev.date)}</div></div>
          <button class="icon-btn" data-act="del-event" data-id="${esc(ev.id)}" aria-label="削除">🗑</button></li>`).join('')}</ul></div>` : ''}`;
  },

  budget() {
    const me = device.me;
    const base = new Date();
    const month = new Date(base.getFullYear(), base.getMonth() + (ui.month || 0), 1);
    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    const expenses = all('expenses');
    const inMonth = expenses.filter(e => String(e.date || '').startsWith(prefix)).sort((x, y) => (y.date || '').localeCompare(x.date || '') || byNewest(x, y));
    const spend = inMonth.filter(e => e.kind !== 'settle');
    const total = spend.reduce((n, e) => n + (Number(e.amount) || 0), 0);
    const paid = w => spend.filter(e => e.paidBy === w).reduce((n, e) => n + (Number(e.amount) || 0), 0);
    const net = L.balance(expenses);
    const debtor = net > 0 ? 'b' : 'a';
    const SPLIT = { half: 'ふたりの分', other: '立て替え', self: '自分の分' };
    return `
      <div class="card">
        <h2>精算</h2>
        ${net ? `<div class="big">${esc(name(debtor))} → ${esc(name(other(debtor)))} ${fmtYen(Math.abs(net))}</div>
          <p class="muted">これまでの立て替えをまとめた金額です。</p>
          <button class="btn small" data-act="settle">精算した</button>` : '<p>貸し借りはありません 👍</p>'}
      </div>
      <div class="card">
        <h2>支出を記録</h2>
        <form class="add" data-form="expense">
          <input name="title" placeholder="例: スーパー / 電気代" required maxlength="40">
          <div class="row">
            <input name="amount" type="number" inputmode="numeric" min="1" max="10000000" placeholder="金額（円）" required>
            <input name="date" type="date" value="${today()}" required>
          </div>
          <div class="row">
            <label class="field">払った人
              <select name="paidBy"><option value="a" ${me === 'a' ? 'selected' : ''}>${esc(name('a'))}</option><option value="b" ${me === 'b' ? 'selected' : ''}>${esc(name('b'))}</option></select>
            </label>
            <label class="field">だれの分
              <select name="split"><option value="half">ふたりの分（半分ずつ）</option><option value="other">相手の分（立て替え）</option><option value="self">自分の分（精算しない）</option></select>
            </label>
          </div>
          <button class="btn">記録</button>
        </form>
      </div>
      <div class="card">
        <div class="month-nav">
          <button class="icon-btn" data-act="month" data-id="-1" aria-label="前の月">‹</button>
          <h2>${month.getFullYear()}年${month.getMonth() + 1}月</h2>
          <button class="icon-btn" data-act="month" data-id="1" aria-label="次の月" ${ui.month >= 0 || !ui.month ? 'disabled' : ''}>›</button>
        </div>
        <div class="big">${fmtYen(total)}</div>
        <p class="muted">${esc(name('a'))} ${fmtYen(paid('a'))} / ${esc(name('b'))} ${fmtYen(paid('b'))}</p>
        ${inMonth.length ? `<ul class="list">${inMonth.map(e => e.kind === 'settle' ? `
          <li class="done"><div class="grow"><div class="title">精算 ${esc(name(e.from))} → ${esc(name(e.to))}</div><div class="muted">${esc(e.date)}</div></div>
            <strong>${fmtYen(e.amount)}</strong><button class="icon-btn" data-act="del-expense" data-id="${esc(e.id)}" aria-label="削除">🗑</button></li>` : `
          <li>
            <span class="tag ${esc(e.paidBy)}">${esc(name(e.paidBy))}</span>
            <div class="grow"><div class="title">${esc(e.title)}</div><div class="muted">${esc(e.date)} · ${SPLIT[e.split] || ''}</div></div>
            <strong>${fmtYen(e.amount)}</strong>
            <button class="icon-btn" data-act="del-expense" data-id="${esc(e.id)}" aria-label="削除">🗑</button>
          </li>`).join('')}</ul>` : '<p class="empty">この月の記録はありません</p>'}
      </div>`;
  },

  notes() {
    const notes = all('notes').sort((x, y) => (!!y.pinned - !!x.pinned) || (y.updatedAt - x.updatedAt));
    return `
      <div class="card">
        <h2>メモを追加</h2>
        <form class="add" data-form="note">
          <input name="title" placeholder="例: Wi-Fi のパスワード / ゴミの分別" required maxlength="40">
          <textarea name="body" placeholder="内容" maxlength="2000"></textarea>
          <button class="btn">追加</button>
        </form>
      </div>
      <div class="card">
        ${notes.length ? notes.map(n => `
          <details class="note-item" data-id="${esc(n.id)}" ${ui.openNote === n.id ? 'open' : ''}>
            <summary>${n.pinned ? '📌 ' : ''}${esc(n.title)}</summary>
            <form class="add" data-form="note" data-id="${esc(n.id)}">
              <input name="title" value="${esc(n.title)}" required maxlength="40">
              <textarea name="body" maxlength="2000">${esc(n.body)}</textarea>
              <div class="btn-row">
                <button class="btn small">保存</button>
                <button type="button" class="btn small ghost" data-act="pin-note" data-id="${esc(n.id)}">${n.pinned ? 'ピンを外す' : '📌 ピン留め'}</button>
                <button type="button" class="btn small ghost danger" data-act="del-note" data-id="${esc(n.id)}">削除</button>
              </div>
            </form>
          </details>`).join('') : '<p class="empty">ふたりで覚えておきたいことを書いておけます</p>'}
      </div>`;
  },

  settings() {
    const n = names();
    const defaultServer = /^https?:$/.test(location.protocol) ? location.origin : '';
    const syncCard = sync.enabled ? `
      <div class="card">
        <h2>ふたりの同期 <span class="sync-label">${esc({ ok: '同期済み', syncing: '同期中…', offline: 'オフライン', local: '' }[sync.status])}</span></h2>
        <p class="muted">相手のスマホでこのアプリを開き、「その他 → 設定 → コードで参加」にこのコードを入力してください。</p>
        <div class="code">${esc(device.sync.room.replace(/(.{5})/, '$1-'))}</div>
        <div class="btn-row">
          <button class="btn small" data-act="copy-code">コードをコピー</button>
          <button class="btn small ghost" data-act="leave">同期を解除</button>
        </div>
        <p class="muted">サーバー: ${esc(device.sync.server)}</p>
      </div>` : `
      <div class="card">
        <h2>ふたりの同期</h2>
        <p class="muted">どちらか一人が「はじめる」で共有コードを作り、もう一人が「コードで参加」に入力します。</p>
        <div class="btn-row"><button class="btn" data-act="create-room">はじめる（コードを作る）</button></div>
        <form class="add" data-form="join" style="margin-top:14px">
          <label class="field">コードで参加
            <input name="room" placeholder="例: ABCDE-FGH23" required autocomplete="off" autocapitalize="characters">
          </label>
          <button class="btn ghost">参加する</button>
        </form>
        <details style="margin-top:12px">
          <summary class="muted">同期サーバーのURL</summary>
          <input id="server-url" value="${esc(device.lastServer || defaultServer)}" placeholder="https://example.com" style="margin-top:8px">
        </details>
      </div>`;

    let pushBody;
    const p = device.push?.prefs || DEFAULT_PUSH_PREFS;
    const tog = (k, label) => `<label class="toggle"><input type="checkbox" name="${k}" ${p[k] ? 'checked' : ''}> ${label}</label>`;
    if (isIos && !isStandalone()) {
      pushBody = '<p class="muted">iPhone では、ホーム画面に追加したアプリから開くと通知をオンにできます（iOS 16.4 以降）。Safari の共有ボタン →「ホーム画面に追加」で追加してください。</p>';
    } else if (!pushSupported()) {
      pushBody = '<p class="muted">この端末・ブラウザは通知に対応していません。</p>';
    } else if (!sync.enabled) {
      pushBody = '<p class="muted">通知を使うには、先に上の「ふたりの同期」をつないでください。</p>';
    } else if (!device.push) {
      pushBody = `<p class="muted">朝の家事リマインド、記念日、買い物リストの追加、ありがとう・お願いが届いたときにお知らせします。</p>
        <button class="btn" data-act="enable-push">通知をオンにする</button>`;
    } else {
      pushBody = `
        <form class="add" data-form="push-prefs">
          <div class="toggle-row">${tog('morning', '朝の家事リマインド')}<input type="time" name="time" value="${esc(p.time)}" class="time"></div>
          ${tog('events', '記念日（7日前・3日前・当日）')}
          ${tog('shopping', '買い物リストに追加されたとき')}
          ${tog('partner', 'ありがとう・お願い・代わりにやったとき')}
          ${tog('weekly', '日曜夜のふりかえり')}
        </form>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn small" data-act="test-push">テスト通知</button>
          <button class="btn small ghost" data-act="disable-push">通知をオフ</button>
        </div>`;
    }

    return `
      ${syncCard}
      <div class="card"><h2>🔔 通知</h2>${pushBody}</div>
      <div class="card">
        <h2>ふたりの名前</h2>
        <form class="add" data-form="names">
          <label class="field">1人目<input name="a" value="${esc(n.a)}" maxlength="12" required></label>
          <label class="field">2人目<input name="b" value="${esc(n.b)}" maxlength="12" required></label>
          <button class="btn">保存</button>
        </form>
      </div>
      <div class="card">
        <h2>この端末を使う人</h2>
        <div class="btn-row">
          ${['a', 'b'].map(w => `<button class="chip ${device.me === w ? 'on' : ''}" data-act="set-me" data-id="${w}">${esc(name(w))}</button>`).join('')}
        </div>
      </div>
      <div class="card">
        <h2>データのバックアップ</h2>
        <div class="btn-row">
          <button class="btn small" data-act="export">書き出す</button>
          <label class="btn small ghost">読み込む<input type="file" accept="application/json" data-act="import" hidden></label>
          ${sync.enabled ? '' : '<button class="btn small ghost" data-act="reset">初期化</button>'}
        </div>
      </div>`;
  },
};

// ---------- 操作 ----------
document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) go(b.dataset.tab);
});
document.getElementById('back').addEventListener('click', () => go('more'));

document.getElementById('me-toggle').addEventListener('click', () => {
  device.me = other(device.me);
  persist();
  pushUpdate();
  toast(`${name(device.me)}として操作中`);
  render();
});

window.addEventListener('hashchange', () => {
  const t = location.hash.slice(1);
  if (t !== tab && titles[t]) go(t);
});

// 通知をタップしたとき（サービスワーカーから）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.tab) go(e.data.tab); });
}

function serverUrl() {
  const v = (document.getElementById('server-url')?.value || '').trim();
  if (!/^https?:\/\/[^\s]+$/.test(v)) { toast('同期サーバーのURLを入力してください'); return null; }
  device.lastServer = v;
  return v;
}

const normalizeCode = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

function setStock(s, low) {
  put('stock', { ...s, low });
  const open = all('shopping').filter(x => x.stockId === s.id && !x.done);
  if (low && !open.length) {
    put('shopping', { id: uid(), name: s.name, done: false, by: device.me, at: Date.now(), stockId: s.id });
    toast(`「${s.name}」を買い物リストに入れました`);
  }
  if (!low) open.forEach(x => remove('shopping', x.id));
}

view.addEventListener('click', async e => {
  const goEl = e.target.closest('[data-goto]');
  if (goEl) { go(goEl.dataset.goto); return; }
  const el = e.target.closest('button[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  const me = device.me;
  switch (el.dataset.act) {
    // 家事
    case 'done-chore': completeChore(id); break;
    case 'edit-chore': ui.editChore = id; render(); window.scrollTo(0, 0); return;
    case 'cancel-edit': ui.editChore = null; break;
    case 'del-chore':
      if (!confirm('この家事を削除しますか？')) return;
      remove('chores', id); ui.editChore = null; break;
    case 'undo-log': remove('log', id); break;
    case 'preset-cat': ui.presetCat = Number(id); break;
    case 'add-preset': {
      const p = L.PRESETS[ui.presetCat ?? 0].items[Number(id)];
      put('chores', { id: uid(), title: p.title, assignee: 'both', every: p.every || 0, ...(p.days ? { days: p.days } : {}), points: p.points });
      toast(`「${p.title}」を追加しました`);
      break;
    }
    case 'thank-cover': {
      const l = get('log', id);
      if (!l) return;
      sendThanks(`代わりに「${l.title}」をやってくれてありがとう！`);
      put('log', { ...l, thanked: true });
      toast('ありがとうを送りました 💌');
      break;
    }
    // 買い物・在庫
    case 'toggle-shop': {
      const s = get('shopping', id);
      if (!s) return;
      put('shopping', { ...s, done: !s.done });
      const st = s.stockId && get('stock', s.stockId);
      if (!s.done && st && st.low) put('stock', { ...st, low: false });
      break;
    }
    case 'del-shop': remove('shopping', id); break;
    case 'clear-shop': all('shopping').filter(s => s.done).forEach(s => remove('shopping', s.id)); break;
    case 'toggle-stock': { const s = get('stock', id); if (s) setStock(s, !s.low); break; }
    case 'del-stock': remove('stock', id); break;
    case 'stock-presets': L.STOCK_PRESETS.forEach(n => put('stock', { id: uid(), name: n, low: false })); break;
    // ふたり
    case 'react': {
      const t = get('thanks', id);
      if (!t) return;
      put('thanks', { ...t, reaction: t.reaction === el.dataset.r ? null : el.dataset.r });
      break;
    }
    case 'del-thanks':
      if (!confirm('削除しますか？')) return;
      remove('thanks', id); break;
    case 'thanks-all': ui.thanksAll = true; break;
    case 'req-accept': case 'req-decline': case 'req-done': {
      const r = get('requests', id);
      if (!r) return;
      const status = { 'req-accept': 'accepted', 'req-decline': 'declined', 'req-done': 'done' }[el.dataset.act];
      put('requests', { ...r, status, ...(status === 'done' ? { doneAt: Date.now() } : {}) });
      if (status === 'done') toast('おつかれさま！伝えておきます');
      break;
    }
    case 'req-cancel': remove('requests', id); break;
    case 'req-thanks': {
      const r = get('requests', id);
      if (!r) return;
      sendThanks(`「${r.text}」をやってくれてありがとう！`);
      put('requests', { ...r, thanked: true });
      toast('ありがとうを送りました 💌');
      break;
    }
    // 記念日・家計簿・メモ
    case 'del-event': remove('events', id); break;
    case 'month': ui.month = Math.min(0, (ui.month || 0) + Number(id)); break;
    case 'del-expense':
      if (!confirm('この記録を削除しますか？')) return;
      remove('expenses', id); break;
    case 'settle': {
      const net = L.balance(all('expenses'));
      if (!net) return;
      const from = net > 0 ? 'b' : 'a';
      if (!confirm(`${name(from)} → ${name(other(from))} ${fmtYen(Math.abs(net))} を精算済みにしますか？`)) return;
      put('expenses', { id: uid(), kind: 'settle', from, to: other(from), amount: Math.abs(net), date: today(), at: Date.now() });
      break;
    }
    case 'pin-note': { const n = get('notes', id); if (n) put('notes', { ...n, pinned: !n.pinned }); ui.openNote = id; break; }
    case 'del-note':
      if (!confirm('このメモを削除しますか？')) return;
      remove('notes', id); break;
    // 設定
    case 'set-me': device.me = id; persist(); pushUpdate(); break;
    case 'export': exportData(); return;
    case 'reset':
      if (!confirm('この端末のデータをすべて消して初期状態に戻しますか？')) return;
      store = seededStore(); pending = new Set(); persist(); break;
    case 'create-room': {
      const server = serverUrl();
      if (!server) return;
      el.disabled = true;
      try {
        const code = await createRoom(server);
        await joinRoom(server, code, 'a');
        toast('共有コードを作りました');
      } catch (err) {
        toast('サーバーにつながりません');
      }
      break;
    }
    case 'copy-code':
      try { await navigator.clipboard.writeText(device.sync.room); toast('コピーしました'); }
      catch (err) { toast('コピーできませんでした'); }
      return;
    case 'leave':
      if (!confirm('同期を解除しますか？（この端末のデータは残ります）')) return;
      await disablePush();
      leaveRoom(); break;
    case 'enable-push':
      el.disabled = true;
      try { await enablePush(); } catch (err) { toast('通知をオンにできませんでした'); }
      break;
    case 'push-hint-off': device.pushHintOff = true; persist(); break;
    case 'disable-push': await disablePush(); toast('通知をオフにしました'); break;
    case 'test-push':
      try { await postPush('test', { endpoint: device.push.endpoint }); toast('テスト通知を送りました'); }
      catch (err) { toast('送れませんでした。通知をオフ→オンにしてみてください'); }
      return;
    default: return;
  }
  render();
});

// メモの開閉を覚えておく（toggle はバブリングしないのでキャプチャで拾う）
view.addEventListener('toggle', e => {
  if (e.target.matches('details.note-item')) {
    if (e.target.open) ui.openNote = e.target.dataset.id;
    else if (ui.openNote === e.target.dataset.id) ui.openNote = null;
  }
}, true);

view.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'schedule') {
    t.closest('form').querySelector('.days-row').hidden = t.value !== 'days';
    return;
  }
  if (t.closest('form[data-form=push-prefs]')) {
    const f = new FormData(t.closest('form'));
    device.push.prefs = {
      morning: f.has('morning'), events: f.has('events'), shopping: f.has('shopping'),
      partner: f.has('partner'), weekly: f.has('weekly'), time: f.get('time') || '08:00',
    };
    persist();
    pushUpdate();
    toast('通知の設定を保存しました');
    return;
  }
  if (t.dataset.act !== 'import') return;
  const file = t.files[0];
  if (!file) return;
  file.text().then(txt => {
    const parsed = JSON.parse(txt);
    if (!parsed || parsed.version !== 2 || !parsed.records) throw new Error('bad');
    const changes = [];
    for (const col of COLLECTIONS) {
      Object.values(parsed.records[col] || {}).forEach(rec => changes.push({ col, rec }));
    }
    mergeRemote(changes);
    // 取り込んだものは相手にも送る
    changes.forEach(({ col, rec }) => {
      if (store.records[col][rec.id] === rec) pending.add(`${col}/${rec.id}`);
    });
    persist();
    sync.soon();
    toast('読み込みました');
    render();
  }).catch(() => toast('読み込めないファイルです'));
});

view.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const me = device.me;
  const text = k => String(f.get(k) || '').trim();
  switch (form.dataset.form) {
    case 'chore': {
      const schedule = f.get('schedule');
      const days = f.getAll('days').map(Number);
      if (schedule === 'days' && !days.length) { toast('曜日を選んでください'); return; }
      const prev = form.dataset.id ? get('chores', form.dataset.id) : null;
      const rec = {
        id: prev ? prev.id : uid(), title: text('title'), assignee: f.get('assignee'), points: Number(f.get('points')),
        every: schedule === 'days' ? 0 : Number(schedule),
      };
      if (schedule === 'days') rec.days = days.sort();
      if (f.get('rotate')) rec.rotate = f.get('rotate');
      put('chores', rec);
      if (prev) { ui.editChore = null; toast('保存しました'); }
      break;
    }
    case 'shop':
      put('shopping', { id: uid(), name: text('name'), done: false, by: me, at: Date.now() });
      break;
    case 'stock':
      put('stock', { id: uid(), name: text('name'), low: false });
      break;
    case 'thanks':
      sendThanks(text('text'));
      toast('ありがとうを送りました 💌');
      break;
    case 'request':
      put('requests', { id: uid(), from: me, to: other(me), text: text('text'), due: f.get('due') || '', status: 'open', at: Date.now() });
      toast(`${name(other(me))}にお願いしました`);
      break;
    case 'event':
      put('events', { id: uid(), title: text('title'), date: f.get('date'), yearly: f.get('yearly') === 'on' });
      break;
    case 'expense': {
      const amount = Math.round(Number(f.get('amount')));
      if (!(amount > 0)) { toast('金額を入力してください'); return; }
      put('expenses', { id: uid(), title: text('title'), amount, date: f.get('date') || today(), paidBy: f.get('paidBy'), split: f.get('split'), at: Date.now() });
      toast('記録しました');
      break;
    }
    case 'note': {
      const prev = form.dataset.id ? get('notes', form.dataset.id) : null;
      put('notes', { ...(prev || { id: uid() }), title: text('title'), body: String(f.get('body') || '') });
      if (prev) { ui.openNote = prev.id; toast('保存しました'); }
      break;
    }
    case 'names':
      put('settings', { id: 'names', a: text('a'), b: text('b') });
      toast('保存しました');
      break;
    case 'join': {
      const code = normalizeCode(f.get('room'));
      if (code.length !== 10) { toast('コードは10文字です'); return; }
      const server = serverUrl();
      if (!server) return;
      try {
        await joinRoom(server, code, 'b');
        toast('つながりました！');
      } catch (err) {
        toast(err.message.startsWith('共有') ? err.message : 'サーバーにつながりません');
        return;
      }
      break;
    }
    default: return;
  }
  render();
});

function exportData() {
  const blob = new Blob([JSON.stringify({ version: 2, records: store.records }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `futari-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
sync.connect();
pushUpdate();
