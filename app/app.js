'use strict';

// ---------- データ ----------
// レコードはすべて { id, updatedAt, deleted? } を持ち、同期では updatedAt が新しい方を採用する。
// 削除は deleted: true の「墓標」を残して相手の端末にも伝える。
const STORE_KEY = 'futari-store-v2';     // { rev, records: { col: { id: rec } } }  ふたりで共有するデータ
const PENDING_KEY = 'futari-pending-v2'; // ["col/id", ...]  まだサーバーに送っていない変更
const DEVICE_KEY = 'futari-device-v2';   // { me, clientId, sync: { server, room } | null, push: { endpoint, prefs } | null }  この端末だけの設定
const LEGACY_KEY = 'futari-data-v1';

const COLLECTIONS = [
  'settings', 'chores', 'log', 'shopping', 'thanks', 'events', 'requests', 'expenses', 'stock', 'notes',
  'pings', 'moods', 'wishes', 'dinner', 'recurring', 'shopfreq',
];
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
      let changed = mergeRemote(body.changes || []);
      store.rev = body.rev;
      persist();
      this.synced = true;
      if (applyRecurring()) changed = true;
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
  checkFeatures();
}

function leaveRoom() {
  sync.disconnect();
  device.sync = null;
  device.calToken = null;
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

// action: { label, fn } を渡すと「元に戻す」などのボタンが付く
function toast(msg, action) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-btn';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.remove(); action.fn(); });
    el.appendChild(b);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), action ? 5000 : 2200);
}

// ---------- LINE ----------
// アプリは記録と段取り、会話は LINE。LINE の共有画面を、文面を入れた状態で開く
const lineUrl = text => `https://line.me/R/share?text=${encodeURIComponent(text)}`;
const lineButton = (text, label = 'LINEで送る', cls = '') =>
  `<a class="btn line-btn ${cls}" href="${esc(lineUrl(text))}" target="_blank" rel="noopener">${window.icon('chat')} ${esc(label)}</a>`;
const lineToastAction = text => ({ label: 'LINEでも送る', fn: () => window.open(lineUrl(text), '_blank', 'noopener') });

// 削除は確認ダイアログを出さずに消して、「元に戻す」で戻せるようにする
function removeWithUndo(col, id, label) {
  const prev = store.records[col][id];
  if (!prev || prev.deleted) return;
  const { updatedAt, ...rest } = prev;
  remove(col, id);
  toast(`${label}を削除しました`, { label: '元に戻す', fn: () => { put(col, rest); render(); } });
}

// 買い物リストに追加（「いつもの」の回数も数える）
function addShopping(nm, extra = {}) {
  const n = String(nm || '').trim();
  if (!n) return;
  put('shopping', { id: uid(), name: n, done: false, by: device.me, at: Date.now(), ...extra });
  const fid = `f-${L.hashId(n)}`;
  const f = get('shopfreq', fid);
  put('shopfreq', { id: fid, name: n, count: (f?.count || 0) + 1, lastAt: Date.now() });
}

// 毎月の固定費を家計簿に記録する（同期がまだのときは、相手が消した記録を復活させないよう待つ）
function applyRecurring() {
  if (sync.enabled && !sync.synced) return 0;
  const due = L.recurringDue(all('recurring'), new Set(Object.keys(store.records.expenses)));
  due.forEach(r => put('expenses', r));
  return due.length;
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
// chat: LINE とかぶる通知（今から帰る・ありがとう・晩ごはん）。LINE で伝える前提なので初期設定はオフ
const DEFAULT_PUSH_PREFS = { morning: true, time: '08:00', shopping: true, partner: true, chat: false, events: true, weekly: true };
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
  await postPush('', { subscription: sub.toJSON(), who: device.me, prefs: device.push.prefs, seenThanks: device.seenThanks || 0 });
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
    await postPush('', { subscription: sub.toJSON(), who: device.me, prefs: device.push.prefs, seenThanks: device.seenThanks || 0 });
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

// ---------- カレンダー・レシート ----------
const serverBase = () => device.sync.server.replace(/\/+$/, '');
const features = { receipt: null }; // サーバーでレシート読み取りが使えるか（null = 未確認）

async function checkFeatures() {
  if (!sync.enabled) return;
  try { Object.assign(features, await (await fetch(`${serverBase()}/api/features`)).json()); } catch (e) { /* オフライン */ }
}

async function calendarUrl(reset = false) {
  const res = await fetch(sync.api('/calendar'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { token } = await res.json();
  device.calToken = token;
  persist();
  return token;
}

function calendarLinks(token, chores) {
  const https = `${serverBase()}/api/cal/${token}.ics${chores ? '?chores=1' : ''}`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  return { https, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

// 写真を長辺 1600px の JPEG に縮めて送る（通信量と読み取り時間を減らす）
async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readReceipt(file) {
  const data = await shrinkImage(file);
  const res = await fetch(sync.api('/receipt'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaType: 'image/jpeg', data }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))).error;
    throw new Error({
      'not configured': 'レシート読み取りの設定（API キー）に問題があります。管理者に確認してください',
      'bad image': 'この画像は読み込めませんでした。別の写真でお試しください',
      'daily limit': '今日の読み取り回数の上限に達しました',
      busy: '混み合っています。少し待ってからもう一度お試しください',
      refused: 'この画像は読み取れませんでした',
      'image too large': '画像が大きすぎます',
    }[err] || '読み取れませんでした。もう一度お試しください');
  }
  return res.json();
}

// ---------- 招待リンク ----------
const inviteUrl = () => `${serverBase()}/#join=${device.sync.room}`;
const defaultServer = () => (/^https?:$/.test(location.protocol) ? location.origin : device.lastServer || '');

// まだつないでいなければ共有コードを作ってから、招待リンクを LINE などで送る
async function shareInvite() {
  if (!sync.enabled) {
    const server = defaultServer();
    if (!server) { toast('同期サーバーのURLを設定してください'); return; }
    const code = await createRoom(server);
    await joinRoom(server, code, device.me);
  }
  const url = inviteUrl();
  const text = `${name(device.me)}から「ふたりの暮らし」への招待です。リンクを開くと、ふたりの家事や買い物リストがつながります。`;
  if (navigator.share) {
    try { await navigator.share({ title: 'ふたりの暮らし', text, url }); return; } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('招待リンクをコピーしました。LINE などに貼り付けて送ってください'); }
  catch (e) { toast('リンクをコピーできませんでした。表示されているリンクを長押しでコピーしてください'); }
}

// 招待リンク（#join=コード）で開かれたとき
async function joinFromLink(code) {
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* 無視 */ }
  if (device.sync?.room === code) return;
  if (device.sync && !confirm('別のふたりの共有に参加しますか？今の同期は解除されます（この端末のデータは残ります）')) return;
  if (device.sync) { await disablePush(); leaveRoom(); }
  try {
    await joinRoom(defaultServer(), code, 'b');
    toast('つながりました！');
    onboard.open('who');
  } catch (e) {
    toast(e.message.startsWith('共有') ? '招待リンクが無効です。もう一度送ってもらってください' : 'サーバーにつながりません');
  }
}

// ---------- 画面 ----------
const view = document.getElementById('view');
const sheetEl = document.getElementById('sheet');
const onboardEl = document.getElementById('onboard');
const TABS = ['home', 'chores', 'shopping', 'budget', 'futari'];
const TAB_ICONS = { home: 'home', chores: 'chores', shopping: 'shopping', budget: 'budget', futari: 'futari' };
const titles = { home: '今日', chores: '家事', shopping: '買い物', budget: '家計簿', futari: 'ふたり', settings: '設定' };
const FUTARI_SEGS = { thanks: 'ありがとう', requests: 'お願い', events: '記念日', wishes: '行きたい', notes: 'メモ' };
const MOODS = [['great', '元気', 'mood-great'], ['ok', 'ふつう', 'mood-ok'], ['tired', '疲れた', 'mood-tired'], ['bad', 'しんどい', 'mood-bad']];
const WISH_KINDS = [['food', 'お店', 'dinner'], ['trip', 'おでかけ・旅行', 'trip'], ['movie', '映画・本', 'movie'], ['other', 'やりたいこと', 'star']];
const catLabel = k => (L.EXPENSE_CATS.find(([c]) => c === k) || L.EXPENSE_CATS.at(-1))[1];
let tab = 'home';
let futariSeg = 'thanks';
let prevTab = 'home';
let ui = {}; // 画面ごとの一時的な状態（編集中の家事、開いているメモなど）
let renderDeferred = false;

// #chores や #futari/events などの URL から画面を決める（昔の #events・#notes・#more にも対応）
function route(hash) {
  const [t, seg] = hash.replace(/^#/, '').split('/');
  if (t === 'events' || t === 'notes') return { tab: 'futari', seg: t };
  if (t === 'futari') return { tab: 'futari', seg: FUTARI_SEGS[seg] ? seg : null };
  if (titles[t]) return { tab: t };
  return { tab: 'home' };
}
{
  const r = route(location.hash);
  tab = r.tab;
  if (r.seg) futariSeg = r.seg;
}

function go(t, seg) {
  const r = route(seg ? `${t}/${seg}` : t);
  if (r.tab === 'settings' && tab !== 'settings') prevTab = tab; // 設定から戻る先
  tab = r.tab;
  if (r.seg) futariSeg = r.seg;
  ui = {};
  try { history.replaceState(null, '', `#${tab}${tab === 'futari' ? '/' + futariSeg : ''}`); } catch (e) { /* 無視 */ }
  render();
  window.scrollTo(0, 0);
}

function render() {
  renderDeferred = false;
  document.getElementById('page-title').textContent = titles[tab];
  document.getElementById('back').hidden = tab !== 'settings';
  document.getElementById('settings-btn').hidden = tab === 'settings';
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('fab').hidden = tab === 'settings';
  view.innerHTML = screens[tab]();
  markThanksSeen();
  updateBadge();
  if (sheet.name) sheet.render();
  if (onboard.step) onboard.render();
}

// アプリのアイコンと「今日」タブに、対応することの数を出す
function badgeData() {
  return { chores: all('chores'), log: all('log'), requests: all('requests'), thanks: all('thanks') };
}
function updateBadge() {
  const n = L.badgeCount(device.me, badgeData(), new Date(), device.seenThanks || 0);
  const tabBtn = document.querySelector('.tabs button[data-tab=home]');
  let dot = tabBtn.querySelector('.tab-badge');
  if (n > 0) {
    if (!dot) { dot = document.createElement('span'); dot.className = 'tab-badge'; tabBtn.appendChild(dot); }
    dot.textContent = n > 99 ? '99+' : String(n);
  } else if (dot) dot.remove();
  if ('setAppBadge' in navigator) (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

// 「ありがとう」の画面を開いたら、届いたありがとうを見たことにする（ほかの端末の通知のバッジにも反映）
function markThanksSeen() {
  if (tab !== 'futari' || futariSeg !== 'thanks' || document.visibilityState !== 'visible') return;
  const latest = Math.max(0, ...all('thanks').filter(t => t.from === other(device.me)).map(t => t.at || 0));
  if (latest > (device.seenThanks || 0)) {
    device.seenThanks = latest;
    persist();
    pushUpdate();
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { markThanksSeen(); updateBadge(); } });

// 相手の変更で再描画するとき、入力中の文字が消えないようにする
function renderSoon() {
  const a = document.activeElement;
  if (a && a.matches('input, textarea, select') && (view.contains(a) || sheetEl.contains(a) || onboardEl.contains(a))) renderDeferred = true;
  else render();
}
document.addEventListener('focusout', () => setTimeout(() => {
  const a = document.activeElement;
  if (renderDeferred && !(a && a.matches('input, textarea, select'))) render();
}, 0));

// ---------- 画面の部品 ----------
const ic = (name, cls) => window.icon(name, cls);

function balanceCard() {
  const p = weekPoints();
  const total = p.a + p.b;
  const pa = total ? Math.round((p.a / total) * 100) : 50;
  return `
    <div class="card">
      <h2>${ic('scale')} この7日間の家事バランス</h2>
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

const ROTATE_LABEL = { each: '毎回交代', weekly: '毎週交代' };

function choreItem({ c, st, who }, withMenu) {
  return `
    <li ${withMenu ? 'data-swipe="right:done-chore"' : ''}>
      <button class="check" data-act="done-chore" data-id="${esc(c.id)}" aria-label="完了にする">${ic('check')}</button>
      <div class="grow">
        <div class="title">${esc(c.title)}</div>
        <div class="muted">${esc(L.scheduleLabel(c))} · ${c.points}pt · ${esc(st.label)}${c.rotate && c.assignee !== 'both' ? ` · ${ic('repeat', 'sm')}${ROTATE_LABEL[c.rotate]}` : ''}</div>
      </div>
      <span class="tag ${esc(who)}">${esc(name(who))}</span>
      ${withMenu ? `<button class="icon-btn" data-act="edit-chore" data-id="${esc(c.id)}" aria-label="編集">${ic('edit')}</button>` : ''}
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

// リアクションは保存・通知では絵文字のまま扱い、画面ではイラストのアイコンで表示する
const REACTIONS = [['❤️', 'heart', 'すき'], ['😊', 'smile', 'うれしい'], ['🙏', 'hand-heart', 'たすかる'], ['😂', 'laugh', 'わらった']];
const reactionIcon = r => { const x = REACTIONS.find(([e]) => e === r); return x ? ic(x[1], 'react-ic') : esc(r); };

function thanksItem(t) {
  const me = device.me;
  const mine = t.from === me;
  return `
    <li>
      <span class="tag ${esc(t.from)}">${esc(name(t.from))}</span>
      <div class="grow">
        <div class="note">${esc(t.text)}</div>
        <div class="muted">${fmtDate(t.at)}${mine && t.reaction ? ` · ${esc(name(other(t.from)))}から ${reactionIcon(t.reaction)}` : ''}</div>
        ${mine ? '' : `<div class="reactions">${REACTIONS.map(([r, icn, label]) => `<button class="react ${t.reaction === r ? 'on' : ''}" data-act="react" data-id="${esc(t.id)}" data-r="${r}" aria-label="${label}">${ic(icn, 'react-ic')}</button>`).join('')}</div>`}
      </div>
      ${mine ? `<button class="icon-btn" data-act="del-thanks" data-id="${esc(t.id)}" aria-label="削除">${ic('trash')}</button>` : ''}
    </li>`;
}

function calendarCard() {
  const head = `<h2>${ic('days')} カレンダーに表示</h2>`;
  if (!sync.enabled) {
    return `<div class="card">${head}
      <p class="muted">パートナーとつなぐと、記念日やお願いの期日を Google カレンダー・iPhone のカレンダーに表示できます。</p></div>`;
  }
  if (!device.calToken) {
    return `<div class="card">${head}
      <p class="muted">記念日・お願いの期日（・曜日で決めた家事）を、Google カレンダーや iPhone のカレンダーに表示できます。</p>
      <button class="btn" data-act="cal-create">カレンダー用のURLを作る</button></div>`;
  }
  const l = calendarLinks(device.calToken, device.calChores);
  return `<div class="card">${head}
    <label class="toggle"><input type="checkbox" data-act="cal-chores" ${device.calChores ? 'checked' : ''}> 曜日で決めた家事も入れる</label>
    <div class="btn-col" style="margin-top:10px">
      <a class="btn" href="${esc(l.webcal)}">iPhone・Mac のカレンダーに追加</a>
      <a class="btn ghost" href="${esc(l.google)}" target="_blank" rel="noopener">Google カレンダーに追加</a>
      <button class="btn small ghost" data-act="cal-copy">${ic('copy')} URLをコピー</button>
    </div>
    <p class="muted">カレンダー側で定期的に読み込まれます（Google は反映まで数時間かかることがあります）。カレンダーからアプリへの書き込みはできません。</p>
    <p class="muted">Google カレンダーは、パソコンのブラウザで開いて「追加」を押すと確実です。</p>
    <button class="btn small ghost danger" data-act="cal-reset">URLを作り直す（前のURLは使えなくなります）</button>
  </div>`;
}

const receiptAvailable = () => sync.enabled && features.receipt !== false;

function receiptButton() {
  if (!receiptAvailable()) return '';
  return `<label class="btn ghost receipt-btn ${ui.reading ? 'disabled' : ''}">${ui.reading ? '読み取り中…' : `${ic('camera')} レシート・スクショから読み取る`}
    <input type="file" accept="image/*" data-act="receipt" hidden ${ui.reading ? 'disabled' : ''}>
  </label>`;
}

function expenseForm(r) {
  const me = device.me;
  return `
    <form class="add" data-form="expense">
      <input name="title" placeholder="例: スーパー / 電気代" required maxlength="40" value="${esc(r?.store || '')}">
      <div class="row">
        <input name="amount" type="number" inputmode="numeric" min="1" max="10000000" placeholder="金額（円）" required value="${r?.total || ''}">
        <input name="date" type="date" value="${esc(r?.date || today())}" required>
      </div>
      <div class="row">
        <label class="field">払った人
          <select name="paidBy"><option value="a" ${me === 'a' ? 'selected' : ''}>${esc(name('a'))}</option><option value="b" ${me === 'b' ? 'selected' : ''}>${esc(name('b'))}</option></select>
        </label>
        <label class="field">だれの分
          <select name="split"><option value="half">ふたりの分（半分ずつ）</option><option value="other">相手の分（立て替え）</option><option value="self">自分の分（精算しない）</option></select>
        </label>
      </div>
      <label class="field">カテゴリ
        <select name="category"><option value="">自動で分ける</option>${L.EXPENSE_CATS.map(([k, l]) => `<option value="${k}" ${r?.category === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <button class="btn">記録</button>
    </form>`;
}

function moodCard() {
  const me = device.me, p = other(me), t = today();
  const mine = get('moods', `m-${me}-${t}`);
  const theirs = get('moods', `m-${p}-${t}`);
  const pm = theirs && MOODS.find(([k]) => k === theirs.mood);
  return `<div class="card mood-card">
    <div class="mood-head">${ic('sun')} 今日の気分</div>
    <div class="moods">${MOODS.map(([k, label, icn]) => `<button class="mood ${mine?.mood === k ? 'on' : ''} m-${k}" data-act="mood" data-id="${k}">${ic(icn)}<span>${label}</span></button>`).join('')}</div>
    <div class="partner-mood">${pm
      ? `${ic(pm[2], 'sm')} ${esc(name(p))}は「${pm[1]}」${theirs.mood === 'tired' || theirs.mood === 'bad'
        ? `<span class="muted"> — 今日は家事を代わってみては？</span>
           <div class="line-row">${lineButton('おつかれさま。今日は無理しないでね。家事はやっておくよ', 'LINEでひとこと送る', 'small')}</div>` : ''}`
      : `<span class="muted">${esc(name(p))}はまだ今日の気分を選んでいません</span>`}</div>
  </div>`;
}

const REQUEST_STATUS = { open: 'お返事待ち', accepted: '引き受け済み', done: '完了', declined: 'むずかしい' };

function inviteCard() {
  return `<div class="card hint invite-card">
    ${illustration('invite', 'small')}
    <div>
      <h2>パートナーを招待しましょう</h2>
      <p class="muted">招待リンクを LINE などで送るだけで、家事や買い物リストがふたりのスマホでつながります。</p>
      <button class="btn small" data-act="share-invite">${ic('share')} 招待リンクを送る</button>
    </div>
  </div>`;
}

// ---------- 各画面 ----------
const screens = {
  home() {
    const me = device.me, p = other(me), t = today();
    const due = L.choresWithStatus(all('chores'), all('log')).filter(x => x.st.due);
    const mine = due.filter(x => x.who === me || x.who === 'both');
    const up = L.upcomingEvents(all('events'))[0];
    const lastThanks = all('thanks').sort(byNewest)[0];
    const shopLeft = all('shopping').filter(s => !s.done).length;
    const covered = all('log').filter(l => l.cover && l.for === me && !l.thanked && Date.now() - l.at < 3 * DAY).sort(byNewest);
    const requests = all('requests').filter(r => r.to === me && (r.status === 'open' || r.status === 'accepted'));
    const lowStock = all('stock').filter(s => s.low).length;
    const ping = all('pings').filter(x => x.from === p && x.kind === 'home' && Date.now() - x.at < 3 * 3600e3).sort(byNewest)[0];
    const dinner = L.dinnerState(all('dinner'), t);
    const net = L.balance(all('expenses'));
    const showPushHint = sync.enabled && pushSupported() && (!isIos || isStandalone()) && !device.push && !device.pushHintOff;
    const todo = mine.length + requests.length + covered.length;
    return `
      ${!sync.enabled ? inviteCard() : ''}
      ${ping ? `<div class="card banner">
        ${ic('coming-home')}
        <div class="grow"><strong>${esc(name(p))}が今から帰ってきます</strong><div class="muted">${ping.eta ? `${esc(ping.eta)}ごろ着 · ` : ''}${fmtDate(ping.at)}に連絡</div></div>
        ${shopLeft ? `<button class="btn small ghost" data-goto="shopping">買い物 ${shopLeft}件</button>` : ''}
      </div>` : ''}
      ${moodCard()}
      ${showPushHint ? `<div class="card hint">
        <h2>${ic('bell')} 通知をオンにしませんか？</h2>
        <p class="muted">朝の家事リマインド、買い物リストの追加、ありがとうやお願いが届いたときにお知らせします。</p>
        <div class="btn-row"><button class="btn small" data-act="enable-push">オンにする</button><button class="btn small ghost" data-act="push-hint-off">あとで</button></div>
      </div>` : ''}
      <div class="card">
        <h2>${ic('list')} 今日やること（${esc(name(me))}）</h2>
        ${todo ? `<ul class="list">
          ${covered.map(l => `<li class="todo-thanks">
            <span class="todo-ic">${ic('sparkles')}</span>
            <div class="grow"><div class="title">${esc(name(l.by))}が代わりに「${esc(l.title)}」をやってくれました</div><div class="muted">${fmtDate(l.at)}</div></div>
            <button class="btn small" data-act="thank-cover" data-id="${esc(l.id)}">ありがとう</button>
          </li>`).join('')}
          ${requests.map(r => `<li>
            <span class="todo-ic">${ic('request')}</span>
            <div class="grow"><div class="title">${esc(r.text)}</div><div class="muted">${esc(name(p))}からのお願い · ${REQUEST_STATUS[r.status]}${r.due ? ` · ${esc(r.due)}まで` : ''}</div></div>
            <button class="btn small ghost" data-goto="futari/requests">見る</button>
          </li>`).join('')}
          ${mine.map(x => choreItem(x, false)).join('')}
        </ul>` : `<div class="empty-illust">${illustration('relax', 'small')}<p class="empty">今日やることはありません</p></div>`}
        ${due.length > mine.length ? `<p class="muted">${esc(name(p))}の担当で残っている家事: ${due.length - mine.length}件（代わりにやると伝わります）</p>` : ''}
      </div>
      <div class="tiles">
        <button class="tile" data-goto="shopping">${ic('shopping')}<span class="tile-num">${shopLeft}</span><span class="tile-label">買うもの${lowStock ? `・残りわずか${lowStock}` : ''}</span></button>
        <button class="tile" data-act="sheet" data-id="dinner">${ic('dinner')}<span class="tile-num">${dinner.match.length ? '決定' : dinner.a.size + dinner.b.size ? `${dinner.a.size + dinner.b.size}票` : '―'}</span><span class="tile-label">${dinner.match.length ? `今夜は「${esc(dinner.match[0])}」` : '晩ごはん相談'}</span></button>
        <button class="tile" data-goto="budget">${ic('scale')}<span class="tile-num">${net ? fmtYen(Math.abs(net)) : '0'}</span><span class="tile-label">${net ? `精算 ${esc(name(net > 0 ? 'b' : 'a'))}→${esc(name(net > 0 ? 'a' : 'b'))}` : '精算なし'}</span></button>
        <button class="tile" data-goto="futari/events">${ic('calendar')}<span class="tile-num">${up ? esc(L.eventLabel(up).when) : '―'}</span><span class="tile-label">${up ? esc(up.ev.title) : '記念日を登録'}</span></button>
      </div>
      <div class="card">
        <h2>${ic('thanks')} 最近のありがとう</h2>
        ${lastThanks ? `<ul class="list">${thanksItem(lastThanks)}</ul>` : '<p class="empty">小さなことでも「ありがとう」を残してみましょう</p>'}
        <p><button class="btn small" data-act="sheet" data-id="thanks">ありがとうを書く</button></p>
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
      ${editing ? `<div class="card hint"><h2>${ic('edit')} 家事を編集</h2>${choreForm(editing)}</div>` : ''}
      <div class="card">
        <h2>${ic('chores')} 家事リスト</h2>
        ${list.length ? `<ul class="list">${list.map(x => choreItem(x, true)).join('')}</ul>` : '<p class="empty">家事を追加しましょう</p>'}
      </div>
      <div class="card">
        <h2>${ic('sparkles')} よくある家事から選ぶ</h2>
        <div class="chips">${L.PRESETS.map((p, i) => `<button class="chip ${i === cat ? 'on' : ''}" data-act="preset-cat" data-id="${i}">${esc(p.cat)}</button>`).join('')}</div>
        <ul class="list">${L.PRESETS[cat].items.map((p, i) => `
          <li>
            <div class="grow"><div class="title">${esc(p.title)}</div><div class="muted">${esc(L.scheduleLabel(p))} · ${p.points}pt</div></div>
            ${existing.has(p.title) ? `<span class="muted">${ic('check', 'sm')} 追加済み</span>` : `<button class="btn small" data-act="add-preset" data-id="${i}">${ic('plus', 'sm')} 追加</button>`}
          </li>`).join('')}</ul>
        <p class="muted">追加した家事は、あとから鉛筆のボタンで担当や曜日を変えられます。</p>
      </div>
      <div class="card">
        <h2>${ic('plus')} 自分で追加</h2>
        ${choreForm(null)}
      </div>
      ${balanceCard()}
      <div class="card">
        <h2>${ic('review')} 最近の記録</h2>
        ${log.length ? `<ul class="list">${log.map(l => `
          <li>
            <span class="tag ${esc(l.by)}">${esc(name(l.by))}</span>
            <div class="grow"><div class="title">${esc(l.title)}${l.cover ? ' <span class="badge">代わりに</span>' : ''}</div><div class="muted">${fmtDate(l.at)} · ${l.points}pt</div></div>
            <button class="icon-btn" data-act="undo-log" data-id="${esc(l.id)}" aria-label="取り消し">${ic('undo')}</button>
          </li>`).join('')}</ul>` : '<p class="empty">まだ記録がありません</p>'}
      </div>`;
  },

  shopping() {
    const items = all('shopping').sort((x, y) => (x.done - y.done) || (x.at || 0) - (y.at || 0));
    const open = items.filter(x => !x.done);
    const done = items.filter(x => x.done);
    const openNames = new Set(open.map(x => x.name));
    const freq = all('shopfreq').filter(f => !openNames.has(f.name)).sort((x, y) => (y.count - x.count) || (y.lastAt - x.lastAt)).slice(0, 12);
    const shopItem = x => `
      <li class="${x.done ? 'done' : ''}" data-swipe="right:toggle-shop left:del-shop">
        <button class="check ${x.done ? 'on' : ''}" data-act="toggle-shop" data-id="${esc(x.id)}" aria-label="購入済みにする">${ic('check')}</button>
        <div class="grow"><div class="title">${esc(x.name)}</div><div class="muted">${esc(name(x.by))}が追加${x.stockId ? ' · 在庫から' : ''}</div></div>
        <button class="icon-btn" data-act="del-shop" data-id="${esc(x.id)}" aria-label="削除">${ic('trash')}</button>
      </li>`;
    const stock = all('stock').sort((x, y) => (y.low - x.low) || x.name.localeCompare(y.name, 'ja'));
    return `
      <div class="card">
        <form class="add" data-form="shop">
          <div class="row"><input name="name" placeholder="例: 牛乳" required maxlength="40"><button class="btn" style="flex:0 0 auto">追加</button></div>
        </form>
      </div>
      ${freq.length ? `<div class="card">
        <h2>${ic('history')} いつもの</h2>
        <div class="chips">${freq.map(f => `<button class="chip" data-act="shop-suggest" data-id="${esc(f.id)}">${ic('plus', 'sm')} ${esc(f.name)}</button>`).join('')}</div>
      </div>` : ''}
      <div class="card">
        ${open.length ? L.SHOP_CATS.map(c => [c, open.filter(x => L.shopCategory(x.name) === c)]).filter(([, l]) => l.length).map(([c, l]) => `
          <div class="group-label">${esc(c)}</div><ul class="list">${l.map(shopItem).join('')}</ul>`).join('') : '<p class="empty">買うものはありません</p>'}
        ${done.length ? `<div class="group-label">購入済み</div><ul class="list">${done.map(shopItem).join('')}</ul>
          <p><button class="btn small ghost" data-act="clear-shop">購入済みを消す</button></p>` : ''}
        ${items.length ? '<p class="muted swipe-hint">右にスワイプで購入済み、左にスワイプで削除</p>' : ''}
      </div>
      <div class="card">
        <h2>${ic('package')} 在庫チェック</h2>
        <p class="muted">「少ない」にすると買い物リストに自動で入ります。買ったら「ある」に戻ります。</p>
        ${stock.length ? `<ul class="list">${stock.map(s => `
          <li>
            <div class="grow"><div class="title">${esc(s.name)}</div></div>
            <button class="stock-btn ${s.low ? 'low' : ''}" data-act="toggle-stock" data-id="${esc(s.id)}">${s.low ? '少ない' : 'ある'}</button>
            <button class="icon-btn" data-act="del-stock" data-id="${esc(s.id)}" aria-label="削除">${ic('trash')}</button>
          </li>`).join('')}</ul>` : `<p><button class="btn small ghost" data-act="stock-presets">よくある日用品を追加</button></p>`}
        <form class="add" data-form="stock" style="margin-top:10px">
          <div class="row"><input name="name" placeholder="例: 洗濯洗剤" required maxlength="40"><button class="btn ghost" style="flex:0 0 auto">追加</button></div>
        </form>
      </div>`;
  },

  budget() {
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
    // カテゴリ別の合計（多い順）。1色の横棒で大きさを比べる
    const byCat = {};
    spend.forEach(e => { const c = e.category || L.expenseCategory(e.title); byCat[c] = (byCat[c] || 0) + (Number(e.amount) || 0); });
    const cats = Object.entries(byCat).sort((x, y) => y[1] - x[1]);
    const maxCat = cats.length ? cats[0][1] : 0;
    const recurring = all('recurring').sort((x, y) => (x.day - y.day) || x.title.localeCompare(y.title, 'ja'));
    return `
      <div class="card">
        <h2>${ic('scale')} 精算</h2>
        ${net ? `<div class="big">${esc(name(debtor))} → ${esc(name(other(debtor)))} ${fmtYen(Math.abs(net))}</div>
          <p class="muted">これまでの立て替えをまとめた金額です。</p>
          <button class="btn small" data-act="settle">精算した</button>` : `<p>${ic('thumbs-up')} 貸し借りはありません</p>`}
      </div>
      <div class="card">
        <h2>${ic('receipt')} 支出を記録</h2>
        ${receiptButton()}
        ${ui.receipt ? `<div class="receipt-result">
          <div class="muted">読み取り結果（まちがっていたら直してから「記録」を押してください）</div>
          ${ui.receipt.items.length ? `<ul class="list compact">${ui.receipt.items.map(i => `<li><span class="grow">${esc(i.name)}</span><span>${fmtYen(i.price)}</span></li>`).join('')}</ul>` : ''}
        </div>` : ''}
        ${expenseForm(ui.receipt)}
      </div>
      <div class="card">
        <div class="month-nav">
          <button class="icon-btn" data-act="month" data-id="-1" aria-label="前の月">${ic('back')}</button>
          <h2>${month.getFullYear()}年${month.getMonth() + 1}月</h2>
          <button class="icon-btn" data-act="month" data-id="1" aria-label="次の月" ${ui.month >= 0 || !ui.month ? 'disabled' : ''}>${ic('next')}</button>
        </div>
        <div class="big">${fmtYen(total)}</div>
        <p class="muted">${esc(name('a'))} ${fmtYen(paid('a'))} / ${esc(name('b'))} ${fmtYen(paid('b'))}</p>
        ${cats.length ? `<div class="cat-bars" role="table" aria-label="カテゴリ別の支出">${cats.map(([c, v]) => `
          <div class="cat-row" role="row" title="${esc(catLabel(c))} ${fmtYen(v)}（${Math.round(v / total * 100)}%）">
            <span class="cat-name" role="cell">${esc(catLabel(c))}</span>
            <span class="cat-track" aria-hidden="true"><span class="cat-bar" style="width:${Math.max(2, Math.round(v / maxCat * 100))}%"></span></span>
            <span class="cat-val" role="cell">${fmtYen(v)}<small>${Math.round(v / total * 100)}%</small></span>
          </div>`).join('')}</div>` : ''}
        ${inMonth.length ? `<ul class="list">${inMonth.map(e => e.kind === 'settle' ? `
          <li class="done" data-swipe="left:del-expense"><div class="grow"><div class="title">精算 ${esc(name(e.from))} → ${esc(name(e.to))}</div><div class="muted">${esc(e.date)}</div></div>
            <strong>${fmtYen(e.amount)}</strong><button class="icon-btn" data-act="del-expense" data-id="${esc(e.id)}" aria-label="削除">${ic('trash')}</button></li>` : `
          <li data-swipe="left:del-expense">
            <span class="tag ${esc(e.paidBy)}">${esc(name(e.paidBy))}</span>
            <div class="grow"><div class="title">${esc(e.title)}${e.recurringId ? ` ${ic('recurring', 'sm')}` : ''}</div><div class="muted">${esc(e.date)} · ${esc(catLabel(e.category || L.expenseCategory(e.title)))} · ${SPLIT[e.split] || ''}</div></div>
            <strong>${fmtYen(e.amount)}</strong>
            <button class="icon-btn" data-act="del-expense" data-id="${esc(e.id)}" aria-label="削除">${ic('trash')}</button>
          </li>`).join('')}</ul>` : '<p class="empty">この月の記録はありません</p>'}
      </div>
      <div class="card">
        <h2>${ic('recurring')} 毎月の固定費</h2>
        <p class="muted">家賃やサブスクなど。登録した月から、毎月その日に家計簿へ自動で記録します。</p>
        ${recurring.length ? `<ul class="list">${recurring.map(r => `
          <li data-swipe="left:del-recurring">
            <span class="tag ${esc(r.paidBy)}">${esc(name(r.paidBy))}</span>
            <div class="grow"><div class="title">${esc(r.title)}</div><div class="muted">毎月${r.day}日 · ${esc(catLabel(r.category))} · ${SPLIT[r.split] || ''}</div></div>
            <strong>${fmtYen(r.amount)}</strong>
            <button class="icon-btn" data-act="del-recurring" data-id="${esc(r.id)}" aria-label="削除">${ic('trash')}</button>
          </li>`).join('')}</ul>` : ''}
        <details class="add-details" ${recurring.length ? '' : 'open'}>
          <summary>${ic('plus', 'sm')} 固定費を追加</summary>
          <form class="add" data-form="recurring">
            <input name="title" placeholder="例: 家賃 / Netflix" required maxlength="40">
            <div class="row">
              <input name="amount" type="number" inputmode="numeric" min="1" max="10000000" placeholder="金額（円）" required>
              <label class="field inline">毎月<input name="day" type="number" min="1" max="28" value="${new Date().getDate() > 28 ? 28 : new Date().getDate()}" required style="width:64px">日</label>
            </div>
            <div class="row">
              <label class="field">払う人
                <select name="paidBy"><option value="a" ${device.me === 'a' ? 'selected' : ''}>${esc(name('a'))}</option><option value="b" ${device.me === 'b' ? 'selected' : ''}>${esc(name('b'))}</option></select>
              </label>
              <label class="field">だれの分
                <select name="split"><option value="half">ふたりの分</option><option value="other">相手の分</option><option value="self">自分の分</option></select>
              </label>
            </div>
            <label class="field">カテゴリ
              <select name="category"><option value="">自動で分ける</option>${L.EXPENSE_CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
            </label>
            <button class="btn">登録</button>
          </form>
        </details>
      </div>`;
  },

  futari() {
    const openForMe = all('requests').filter(r => r.to === device.me && r.status === 'open').length;
    const segs = Object.entries(FUTARI_SEGS).map(([k, label]) =>
      `<button class="seg ${k === futariSeg ? 'on' : ''}" data-goto="futari/${k}">${label}${k === 'requests' && openForMe ? `<span class="dot-count">${openForMe}</span>` : ''}</button>`).join('');
    return `<div class="segs">${segs}</div>${futariScreens[futariSeg]()}`;
  },

  settings() {
    const n = names();
    const syncCard = sync.enabled ? `
      <div class="card">
        <h2>${ic('users')} ふたりの同期 <span class="sync-label">${esc({ ok: '同期済み', syncing: '同期中…', offline: 'オフライン', local: '' }[sync.status])}</span></h2>
        <p class="muted">パートナーのスマホでまだつないでいなければ、招待リンクを送ってください。</p>
        <button class="btn" data-act="share-invite">${ic('share')} 招待リンクを送る</button>
        <p class="muted" style="margin-top:12px">リンクを使えないときは、「コードで参加」にこのコードを入力します。</p>
        <div class="code">${esc(device.sync.room.replace(/(.{5})/, '$1-'))}</div>
        <div class="btn-row">
          <button class="btn small ghost" data-act="copy-code">${ic('copy')} コードをコピー</button>
          <button class="btn small ghost" data-act="leave">同期を解除</button>
        </div>
        <p class="muted">サーバー: ${esc(device.sync.server)}</p>
      </div>` : `
      <div class="card">
        <h2>${ic('users')} ふたりの同期</h2>
        <p class="muted">招待リンクを送ると、パートナーがリンクを開くだけでつながります。</p>
        <div class="btn-row"><button class="btn" data-act="share-invite">${ic('share')} 招待リンクを送る</button></div>
        <form class="add" data-form="join" style="margin-top:14px">
          <label class="field">コードで参加（招待された側）
            <input name="room" placeholder="例: ABCDE-FGH23" required autocomplete="off" autocapitalize="characters">
          </label>
          <button class="btn ghost">参加する</button>
        </form>
        <details style="margin-top:12px">
          <summary class="muted">同期サーバーのURL</summary>
          <input id="server-url" value="${esc(defaultServer())}" placeholder="https://example.com" style="margin-top:8px">
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
          ${tog('partner', 'お願い・代わりにやった・相手が疲れているとき')}
          ${tog('chat', '今から帰る・ありがとう・晩ごはん')}
          <p class="muted small-note">「今から帰る・ありがとう・晩ごはん」は LINE で伝え合う前提なので、初期設定はオフです。</p>
          ${tog('weekly', '日曜夜のふりかえり')}
        </form>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn small" data-act="test-push">テスト通知</button>
          <button class="btn small ghost" data-act="disable-push">通知をオフ</button>
        </div>`;
    }

    return `
      ${syncCard}
      <div class="card"><h2>${ic('bell')} 通知</h2>${pushBody}</div>
      <div class="card">
        <h2>${ic('user')} この端末を使う人</h2>
        <div class="btn-row">
          ${['a', 'b'].map(w => `<button class="chip ${device.me === w ? 'on' : ''}" data-act="set-me" data-id="${w}">${esc(name(w))}</button>`).join('')}
        </div>
      </div>
      <div class="card">
        <h2>${ic('edit')} ふたりの名前</h2>
        <form class="add" data-form="names">
          <label class="field">1人目<input name="a" value="${esc(n.a)}" maxlength="12" required></label>
          <label class="field">2人目<input name="b" value="${esc(n.b)}" maxlength="12" required></label>
          <button class="btn">保存</button>
        </form>
      </div>
      <div class="card">
        <h2>${ic('package')} データのバックアップ</h2>
        <div class="btn-row">
          <button class="btn small" data-act="export">書き出す</button>
          <label class="btn small ghost">読み込む<input type="file" accept="application/json" data-act="import" hidden></label>
          ${sync.enabled ? '' : '<button class="btn small ghost" data-act="reset">初期化</button>'}
        </div>
      </div>
      <p class="muted center">アイコン: <a href="https://lucide.dev" target="_blank" rel="noopener">Lucide</a>（ISC License）</p>`;
  },
};

// 「ふたり」タブの中の画面
const futariScreens = {
  thanks() {
    const s = L.weekSummary({ log: all('log'), thanks: all('thanks'), requests: all('requests') });
    const thanks = all('thanks').sort(byNewest);
    const row = (label, key, unit) => `<tr><th>${label}</th><td>${s[key].a}${unit}</td><td>${s[key].b}${unit}</td></tr>`;
    const covers = s.cover.a + s.cover.b;
    return `
      <div class="card">
        <h2>${ic('thanks')} ${esc(name(other(device.me)))}へのありがとう</h2>
        <form class="add" data-form="thanks">
          <textarea name="text" placeholder="例: 今日ご飯を作ってくれてありがとう。すごくおいしかった！" required maxlength="300"></textarea>
          <button class="btn">送る</button>
        </form>
      </div>
      <div class="card">
        <h2>${ic('review')} この7日間のふりかえり</h2>
        <table class="summary">
          <tr><th></th><td><span class="tag a">${esc(name('a'))}</span></td><td><span class="tag b">${esc(name('b'))}</span></td></tr>
          ${row('家事', 'chores', '回')}${row('ポイント', 'points', 'pt')}${row('ありがとう', 'thanks', '回')}${row('お願いに応えた', 'requestsDone', '回')}
        </table>
        <p class="muted">${covers ? `代わりにやった家事が${covers}回ありました。` : ''}${s.thanks.a + s.thanks.b ? 'ありがとうを伝え合えていますね。' : '今週はまだありがとうがありません。ひとこと送ってみませんか？'}</p>
        ${lineButton(`今週もおつかれさま！家事はふたりで${s.chores.a + s.chores.b}回やったよ。来週もよろしくね`, 'LINEで「今週もおつかれさま」', 'small ghost')}
      </div>
      <div class="card">
        <h2>${ic('heart')} これまでのありがとう</h2>
        ${thanks.length ? `<ul class="list">${thanks.slice(0, ui.thanksAll ? undefined : 20).map(thanksItem).join('')}</ul>` : '<p class="empty">まだありません</p>'}
        ${thanks.length > 20 && !ui.thanksAll ? '<button class="btn small ghost" data-act="thanks-all">もっと見る</button>' : ''}
      </div>`;
  },

  requests() {
    const me = device.me;
    const reqs = all('requests').sort(byNewest);
    const forMe = reqs.filter(r => r.to === me && (r.status === 'open' || r.status === 'accepted'));
    const fromMe = reqs.filter(r => r.from === me && r.status !== 'done');
    const done = reqs.filter(r => r.status === 'done' && Date.now() - (r.doneAt || 0) < 14 * DAY);
    return `
      ${forMe.length ? `<div class="card hint">
        <h2>${ic('request')} ${esc(name(other(me)))}からのお願い</h2>
        <ul class="list">${forMe.map(r => `
          <li>
            <div class="grow"><div class="title">${esc(r.text)}</div><div class="muted">${r.due ? `${esc(r.due)}まで · ` : ''}${REQUEST_STATUS[r.status]}</div></div>
            <div class="btn-col">${r.status === 'open'
              ? `<button class="btn small" data-act="req-accept" data-id="${esc(r.id)}">引き受ける</button><button class="btn small ghost" data-act="req-decline" data-id="${esc(r.id)}">むずかしい</button>`
              : `<button class="btn small" data-act="req-done" data-id="${esc(r.id)}">やった！</button>`}</div>
          </li>`).join('')}</ul>
      </div>` : ''}
      <div class="card">
        <h2>${ic('request')} ${esc(name(other(me)))}へのお願い</h2>
        <form class="add" data-form="request">
          <input name="text" placeholder="例: 今度の休みに電球を替えてほしい" required maxlength="100">
          <div class="row"><label class="field">いつまでに（任意）<input type="date" name="due"></label></div>
          <button class="btn">お願いする</button>
        </form>
      </div>
      ${fromMe.length ? `<div class="card">
        <h2>お願いしたこと</h2>
        <ul class="list">${fromMe.map(r => `
          <li>
            <div class="grow"><div class="title">${esc(r.text)}</div><div class="muted">${r.due ? `${esc(r.due)}まで · ` : ''}${REQUEST_STATUS[r.status]}</div></div>
            <button class="icon-btn" data-act="req-cancel" data-id="${esc(r.id)}" aria-label="取り消し">${ic('trash')}</button>
          </li>`).join('')}</ul>
      </div>` : ''}
      ${done.length ? `<div class="card">
        <h2>${ic('done')} かなったお願い</h2>
        <ul class="list">${done.map(r => `
          <li class="done">
            <span class="tag ${esc(r.to)}">${esc(name(r.to))}</span>
            <div class="grow"><div class="title">${esc(r.text)}</div></div>
            ${r.from === me && !r.thanked ? `<button class="btn small" data-act="req-thanks" data-id="${esc(r.id)}">ありがとう</button>` : ''}
          </li>`).join('')}</ul>
      </div>` : ''}`;
  },

  events() {
    const up = L.upcomingEvents(all('events'));
    const past = all('events').filter(ev => !up.some(u => u.ev.id === ev.id));
    const soon = up.find(x => L.eventLabel(x).days <= 30);
    const ideas = all('wishes').filter(w => !w.done).sort(byNewest).slice(0, 3);
    return `
      ${soon && ideas.length ? `<div class="card hint">
        <h2>${ic('gift')} ${L.eventLabel(soon).days === 0 ? `今日は${esc(soon.ev.title)}` : `${esc(soon.ev.title)}まであと${L.eventLabel(soon).days}日`}</h2>
        <p class="muted">「行きたい」リストから選んでみませんか？</p>
        <ul class="list">${ideas.map(w => `<li><span class="todo-ic">${ic((WISH_KINDS.find(([k]) => k === w.kind) || WISH_KINDS[3])[2])}</span><div class="grow">${esc(w.title)}</div></li>`).join('')}</ul>
        <div class="btn-row">
          ${lineButton(`${soon.ev.title}、どこ行こうか？ 候補: ${ideas.map(w => w.title).join('、')}`, 'LINEで相談', 'small')}
          <button class="btn small ghost" data-goto="futari/wishes">リストを見る</button>
        </div>
      </div>` : ''}
      <div class="card">
        <h2>${ic('calendar')} 記念日・予定を追加</h2>
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
        <h2>${ic('gift')} これから</h2>
        ${up.length ? `<ul class="list">${up.map(x => { const l = L.eventLabel(x); return `
          <li>
            <div class="grow"><div class="title">${esc(x.ev.title)}${esc(l.extra)}</div><div class="muted">${l.dateText}${x.ev.yearly ? ' · 毎年' : ''}</div></div>
            <strong>${esc(l.when)}</strong>
            <button class="icon-btn" data-act="del-event" data-id="${esc(x.ev.id)}" aria-label="削除">${ic('trash')}</button>
          </li>`; }).join('')}</ul>` : '<p class="empty">登録された記念日はありません</p>'}
      </div>
      ${past.length ? `<div class="card"><h2>過ぎた予定</h2><ul class="list">${past.map(ev => `
          <li class="done"><div class="grow"><div class="title">${esc(ev.title)}</div><div class="muted">${esc(ev.date)}</div></div>
          <button class="icon-btn" data-act="del-event" data-id="${esc(ev.id)}" aria-label="削除">${ic('trash')}</button></li>`).join('')}</ul></div>` : ''}
      ${calendarCard()}`;
  },

  wishes() {
    const list = all('wishes').sort(byNewest);
    const open = list.filter(w => !w.done);
    const done = list.filter(w => w.done);
    const item = w => {
      const kind = WISH_KINDS.find(([k]) => k === w.kind) || WISH_KINDS[3];
      const url = /^https?:\/\//.test(w.note || '') ? w.note : '';
      return `<li class="${w.done ? 'done' : ''}" data-swipe="right:wish-done left:del-wish">
        <span class="todo-ic">${ic(kind[2])}</span>
        <div class="grow"><div class="title">${esc(w.title)}</div>
          <div class="muted">${esc(kind[1])} · ${esc(name(w.by))}${w.note ? ` · ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">リンク</a>` : esc(w.note)}` : ''}</div></div>
        <button class="check ${w.done ? 'on' : ''}" data-act="wish-done" data-id="${esc(w.id)}" aria-label="行った・やった">${ic('check')}</button>
        <button class="icon-btn" data-act="del-wish" data-id="${esc(w.id)}" aria-label="削除">${ic('trash')}</button>
      </li>`;
    };
    return `
      <div class="card">
        <h2>${ic('place')} 行きたいところ・やりたいこと</h2>
        <form class="add" data-form="wish">
          <div class="chips kind-chips">${WISH_KINDS.map(([k, l, icn], i) => `<label class="chip-radio"><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''}><span>${ic(icn, 'sm')} ${l}</span></label>`).join('')}</div>
          <input name="title" placeholder="例: 駅前のイタリアン / 箱根温泉 / 〇〇の映画" required maxlength="40">
          <input name="note" placeholder="メモやURL（任意）" maxlength="200">
          <button class="btn">追加</button>
        </form>
      </div>
      <div class="card">
        ${open.length ? WISH_KINDS.map(([k, l]) => [l, open.filter(w => (w.kind || 'other') === k)]).filter(([, x]) => x.length)
          .map(([l, x]) => `<div class="group-label">${esc(l)}</div><ul class="list">${x.map(item).join('')}</ul>`).join('')
          : '<p class="empty">ふたりで行きたいお店や旅行先をためておきましょう</p>'}
        ${done.length ? `<details><summary class="muted">行った・やった（${done.length}）</summary><ul class="list">${done.map(item).join('')}</ul></details>` : ''}
      </div>`;
  },

  notes() {
    const notes = all('notes').sort((x, y) => (!!y.pinned - !!x.pinned) || (y.updatedAt - x.updatedAt));
    return `
      <div class="card">
        <h2>${ic('note')} メモを追加</h2>
        <form class="add" data-form="note">
          <input name="title" placeholder="例: Wi-Fi のパスワード / ゴミの分別" required maxlength="40">
          <textarea name="body" placeholder="内容" maxlength="2000"></textarea>
          <button class="btn">追加</button>
        </form>
      </div>
      <div class="card">
        ${notes.length ? notes.map(n => `
          <details class="note-item" data-id="${esc(n.id)}" ${ui.openNote === n.id ? 'open' : ''}>
            <summary>${n.pinned ? ic('pin', 'sm') + ' ' : ''}${esc(n.title)}</summary>
            <form class="add" data-form="note" data-id="${esc(n.id)}">
              <input name="title" value="${esc(n.title)}" required maxlength="40">
              <textarea name="body" maxlength="2000">${esc(n.body)}</textarea>
              <div class="btn-row">
                <button class="btn small">保存</button>
                <button type="button" class="btn small ghost" data-act="pin-note" data-id="${esc(n.id)}">${n.pinned ? 'ピンを外す' : `${ic('pin', 'sm')} ピン留め`}</button>
                <button type="button" class="btn small ghost danger" data-act="del-note" data-id="${esc(n.id)}">削除</button>
              </div>
            </form>
          </details>`).join('') : '<p class="empty">ふたりで覚えておきたいことを書いておけます</p>'}
      </div>`;
  },
};

// ---------- ＋ボタンから開くシート ----------
const sheet = {
  name: null,
  open(name) { this.name = name; this.render(); document.body.classList.add('sheet-open'); },
  close() { this.name = null; sheetEl.innerHTML = ''; sheetEl.hidden = true; document.body.classList.remove('sheet-open'); },
  render() {
    sheetEl.hidden = false;
    const body = this.views[this.name] ? this.views[this.name]() : '';
    sheetEl.innerHTML = `
      <div class="sheet-backdrop" data-act="sheet-close"></div>
      <div class="sheet-panel" role="dialog" aria-modal="true">
        <div class="sheet-head">
          ${this.name !== 'menu' ? `<button class="icon-btn" data-act="sheet" data-id="menu" aria-label="戻る">${ic('back')}</button>` : '<span></span>'}
          <strong>${this.titles[this.name] || ''}</strong>
          <button class="icon-btn" data-act="sheet-close" aria-label="閉じる">${ic('close')}</button>
        </div>
        ${body}
      </div>`;
    const first = sheetEl.querySelector('input:not([type=file]):not([type=checkbox]), textarea');
    // 文字を入れるための画面だけ、入力欄にすぐカーソルを置く（晩ごはん相談などは相手の選択がすぐ見えるように置かない）
    if (first && ['shop', 'expense', 'thanks', 'request'].includes(this.name)) setTimeout(() => first.focus(), 50);
  },
  line: '',
  openLine(text) { this.line = text; this.open('line'); },
  titles: { line: 'LINEで送る', menu: '記録する', chore: '家事をやった', shop: '買い物に追加', expense: '支出を記録', thanks: 'ありがとう', request: 'お願い', home: '今から帰る', dinner: '晩ごはん相談' },
  views: {
    menu() {
      const item = (id, icn, label, cls = '') => `<button class="sheet-item ${cls}" data-act="sheet" data-id="${id}">${ic(icn)}<span>${label}</span></button>`;
      return `<div class="sheet-grid">
        ${item('chore', 'done', '家事をやった', 'c-chore')}
        ${item('shop', 'shopping', '買い物に追加', 'c-shop')}
        ${receiptAvailable() ? `<label class="sheet-item c-budget">${ic('camera')}<span>レシートを読む</span><input type="file" accept="image/*" data-act="receipt" hidden></label>` : ''}
        ${item('expense', 'budget', '支出を記録', 'c-budget')}
        ${item('home', 'coming-home', '今から帰る', 'c-home')}
        ${item('dinner', 'dinner', '晩ごはん相談', 'c-dinner')}
        ${item('thanks', 'thanks', 'ありがとう', 'c-thanks')}
        ${item('request', 'request', 'お願い', 'c-request')}
      </div>`;
    },
    chore() {
      const list = L.choresWithStatus(all('chores'), all('log')).sort((x, y) => (y.st.due - x.st.due) || x.c.title.localeCompare(y.c.title, 'ja'));
      return list.length ? `<ul class="list">${list.map(x => choreItem(x, false)).join('')}</ul>` : '<p class="empty">家事タブから家事を追加してください</p>';
    },
    shop() {
      return `<form class="add" data-form="shop"><div class="row"><input name="name" placeholder="例: 牛乳" required maxlength="40"><button class="btn" style="flex:0 0 auto">追加</button></div></form>`;
    },
    expense() { return expenseForm(null); },
    line() {
      return `<p class="muted">アプリにも記録しました。LINE でも伝えましょう（文面は直せます）。</p>
        <textarea class="line-text" data-line maxlength="500">${esc(sheet.line)}</textarea>
        <div class="btn-col" style="margin-top:10px">${lineButton(sheet.line, 'LINEで送る', 'big')}
          <button class="btn ghost" data-act="sheet-close">閉じる</button></div>`;
    },
    home() {
      const left = all('shopping').filter(x => !x.done).length;
      return `<p class="muted">${esc(name(other(device.me)))}に通知でお知らせします。${left ? `（買い物リストが${left}件あります）` : ''}</p>
        <div class="eta-grid">${[10, 20, 30, 60].map(m => `<button class="chip big" data-act="ping" data-id="${m}">${m === 60 ? '1時間' : `${m}分`}で着く</button>`).join('')}</div>
        <form class="add" data-form="ping"><div class="row"><label class="field">到着時刻を指定<input type="time" name="eta" required></label><button class="btn" style="align-self:flex-end">伝える</button></div></form>`;
    },
    dinner() {
      const t = today(), me = device.me, p = other(me);
      const st = L.dinnerState(all('dinner'), t);
      const cands = [...new Set([...st.match, ...st[p], ...st[me], ...L.dinnerSuggestions(t)])];
      return `${st.match.length
          ? `<div class="match">${ic('party')} 今夜は「${esc(st.match[0])}」に決まり！</div>
             <div class="line-row">${lineButton(`今夜は「${st.match[0]}」に決まり！`, 'LINEで送る', 'small')}</div>`
          : `<p class="muted">食べたいものを、いくつでも選んでください。ふたりが同じものを選ぶと決まります。</p>`}
        <div class="dish-grid">${cands.map(n => `<button class="dish ${st[me].has(n) ? 'on' : ''} ${st.match.includes(n) ? 'match' : ''}" data-act="dinner-vote" data-name="${esc(n)}">
          <span>${esc(n)}</span>${st[p].has(n) ? `<span class="p-mark">${esc(name(p))}</span>` : ''}</button>`).join('')}</div>
        <form class="add" data-form="dinner" style="margin-top:12px"><div class="row"><input name="name" placeholder="ほかの料理を追加" maxlength="20" required><button class="btn" style="flex:0 0 auto">追加</button></div></form>`;
    },
    thanks() {
      return `<form class="add" data-form="thanks">
        <textarea name="text" placeholder="${esc(name(other(device.me)))}へ。例: 今日ご飯を作ってくれてありがとう！" required maxlength="300"></textarea>
        <button class="btn">送る</button></form>`;
    },
    request() {
      return `<form class="add" data-form="request">
        <input name="text" placeholder="${esc(name(other(device.me)))}へ。例: 電球を替えてほしい" required maxlength="100">
        <div class="row"><label class="field">いつまでに（任意）<input type="date" name="due"></label></div>
        <button class="btn">お願いする</button></form>`;
    },
  },
};

// ---------- はじめての案内 ----------
const onboard = {
  step: null,
  open(step) { this.step = step; this.render(); },
  close() { this.step = null; onboardEl.hidden = true; onboardEl.innerHTML = ''; device.onboarded = true; persist(); render(); },
  render() {
    onboardEl.hidden = false;
    const s = this.views[this.step]();
    const order = ['welcome', 'invite', 'notify', 'done'];
    const idx = order.indexOf(this.step === 'join' || this.step === 'who' ? 'invite' : this.step);
    onboardEl.innerHTML = `
      <div class="ob-panel">
        <div class="ob-top">
          <div class="ob-dots">${order.map((_, i) => `<span class="${i <= idx ? 'on' : ''}"></span>`).join('')}</div>
          ${this.step !== 'done' ? '<button class="ob-skip" data-act="ob-skip">スキップ</button>' : ''}
        </div>
        ${illustration(s.illust)}
        <h1>${s.title}</h1>
        ${s.body}
      </div>`;
  },
  views: {
    welcome: () => ({
      illust: 'welcome',
      title: 'ふたりの暮らしへようこそ',
      body: `<p class="muted">家事の分担、買い物、ありがとうを、ふたりで気持ちよく共有するアプリです。</p>
        <form class="add" data-form="ob-names">
          <label class="field">あなたの名前<input name="me" required maxlength="12" placeholder="例: ひろ"></label>
          <label class="field">パートナーの名前<input name="partner" required maxlength="12" placeholder="例: ゆき"></label>
          <button class="btn">次へ</button>
        </form>
        <button class="link-btn" data-act="ob-step" data-id="join">招待リンク・コードを受け取った方はこちら</button>`,
    }),
    invite: () => ({
      illust: 'invite',
      title: `${esc(name(other(device.me)))}を招待しましょう`,
      body: `<p class="muted">招待リンクを LINE などで送ってください。${esc(name(other(device.me)))}がリンクを開くと、ふたりのスマホがつながります。</p>
        <button class="btn" data-act="share-invite">${ic('share')} 招待リンクを送る</button>
        ${sync.enabled ? `<p class="muted invite-url">${esc(inviteUrl())}</p>` : ''}
        <div class="btn-row ob-nav"><button class="btn ghost" data-act="ob-step" data-id="notify">${sync.enabled ? '次へ' : 'あとで'}</button></div>`,
    }),
    join: () => ({
      illust: 'invite',
      title: '招待を受け取った方',
      body: `<p class="muted">招待リンクを開くと自動でつながります。コードを受け取った場合は、ここに入力してください。</p>
        <form class="add" data-form="join"><input name="room" placeholder="例: ABCDE-FGH23" required autocomplete="off" autocapitalize="characters"><button class="btn">参加する</button></form>
        <button class="link-btn" data-act="ob-step" data-id="welcome">戻る</button>`,
    }),
    who: () => ({
      illust: 'welcome',
      title: 'あなたはどちらですか？',
      body: `<p class="muted">このスマホを使う人を選んでください。あとから設定で変えられます。</p>
        <div class="btn-row who">${['a', 'b'].map(w => `<button class="chip big ${device.me === w ? 'on' : ''}" data-act="set-me" data-id="${w}">${esc(name(w))}</button>`).join('')}</div>
        <div class="btn-row ob-nav"><button class="btn" data-act="ob-step" data-id="notify">次へ</button></div>`,
    }),
    notify: () => {
      let body;
      if (isIos && !isStandalone()) {
        body = `<p class="muted">iPhone では、ホーム画面に追加すると通知を受け取れます。</p>
          <ol class="steps"><li>下の共有ボタンを押す</li><li>「ホーム画面に追加」を選ぶ</li><li>ホーム画面の「ふたり」から開き直す</li></ol>`;
      } else if (!pushSupported() || !sync.enabled) {
        body = `<p class="muted">${sync.enabled ? 'この端末は通知に対応していません。' : 'パートナーとつなぐと、朝の家事リマインドやありがとうの通知を受け取れます。設定からいつでもオンにできます。'}</p>`;
      } else if (device.push) {
        body = `<p>${ic('check')} 通知はオンになっています</p>`;
      } else {
        body = `<p class="muted">朝の家事リマインド、買い物リストの追加、ありがとうやお願いが届いたときにお知らせします。</p>
          <button class="btn" data-act="enable-push">${ic('bell')} 通知をオンにする</button>`;
      }
      return { illust: 'notify', title: '通知を受け取る', body: `${body}<div class="btn-row ob-nav"><button class="btn ghost" data-act="ob-step" data-id="done">${device.push ? '次へ' : 'あとで'}</button></div>` };
    },
    done: () => ({
      illust: 'done',
      title: '準備ができました',
      body: `<p class="muted">右下の ＋ ボタンから、いつでも家事・買い物・支出・ありがとうを記録できます。</p>
        <button class="btn" data-act="ob-done">はじめる</button>`,
    }),
  },
};

// 初めて開いたときだけ案内を出す（すでに使っているデータがあれば出さない）
function shouldOnboard() {
  if (device.onboarded || device.sync) return false;
  return !COLLECTIONS.some(col => Object.values(store.records[col]).some(r => r.updatedAt > 1));
}

// 「今から帰る」の LINE の文面（買い物リストも添える）
function homeMessage(eta) {
  const left = all('shopping').filter(x => !x.done).map(x => x.name);
  return `今から帰るね！${eta}ごろ着く予定。${left.length ? `\n買うものある？ リスト: ${left.slice(0, 6).join('、')}${left.length > 6 ? ` ほか${left.length - 6}件` : ''}` : ''}`;
}

// ---------- 操作 ----------
function serverUrl() {
  const input = document.getElementById('server-url');
  const v = (input ? input.value : defaultServer()).trim();
  if (!/^https?:\/\/[^\s]+$/.test(v)) { toast('同期サーバーのURLを入力してください'); return null; }
  device.lastServer = v;
  return v;
}

const normalizeCode = s => {
  const m = /#join=([A-Za-z0-9-]+)/.exec(s); // 招待リンクをそのまま貼られたとき
  return (m ? m[1] : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
};

function setStock(s, low) {
  put('stock', { ...s, low });
  const open = all('shopping').filter(x => x.stockId === s.id && !x.done);
  if (low && !open.length) {
    addShopping(s.name, { stockId: s.id });
    toast(`「${s.name}」を買い物リストに入れました`);
  }
  if (!low) open.forEach(x => remove('shopping', x.id));
}

function startReceipt(file) {
  sheet.close();
  if (tab !== 'budget') go('budget');
  ui.reading = true;
  ui.receipt = null;
  render();
  readReceipt(file).then(r => {
    if (!r.is_receipt) { toast('レシートや支払い画面が見つかりませんでした'); return; }
    ui.receipt = r;
    toast(r.total ? `${fmtYen(r.total)} を読み取りました` : '金額が読み取れませんでした。入力してください');
  }).catch(err => toast(err.message)).finally(() => { ui.reading = false; if (tab === 'budget') render(); });
}

async function onClick(e) {
  const goEl = e.target.closest('[data-goto]');
  if (goEl) {
    const [t, seg] = goEl.dataset.goto.split('/');
    sheet.close();
    go(t, seg);
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.matches('input')) return;
  const id = el.dataset.id;
  const inSheet = sheetEl.contains(el);
  switch (el.dataset.act) {
    // シート・案内
    case 'sheet': sheet.open(id); return;
    case 'sheet-close': sheet.close(); return;
    case 'ob-step': onboard.open(id); return;
    case 'ob-skip': case 'ob-done': onboard.close(); return;
    case 'share-invite':
      el.disabled = true;
      try { await shareInvite(); } catch (err) { toast('サーバーにつながりません'); }
      el.disabled = false;
      break;
    // 家事
    case 'done-chore': completeChore(id); if (inSheet) sheet.close(); break;
    case 'edit-chore': ui.editChore = id; render(); window.scrollTo(0, 0); return;
    case 'cancel-edit': ui.editChore = null; break;
    case 'del-chore': removeWithUndo('chores', id, '家事'); ui.editChore = null; break;
    case 'undo-log': removeWithUndo('log', id, '記録'); break;
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
      toast('ありがとうを送りました', lineToastAction(`代わりに「${l.title}」をやってくれてありがとう！`));
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
    case 'del-shop': removeWithUndo('shopping', id, get('shopping', id) ? `「${get('shopping', id).name}」` : '項目'); break;
    case 'shop-suggest': {
      const f = get('shopfreq', id);
      if (f) { addShopping(f.name); toast(`「${f.name}」を追加しました`); }
      break;
    }
    case 'clear-shop': all('shopping').filter(s => s.done).forEach(s => remove('shopping', s.id)); break;
    case 'toggle-stock': { const s = get('stock', id); if (s) setStock(s, !s.low); break; }
    case 'del-stock': removeWithUndo('stock', id, '在庫の項目'); break;
    case 'stock-presets': L.STOCK_PRESETS.forEach(n => put('stock', { id: uid(), name: n, low: false })); break;
    // ふたり
    case 'react': {
      const t = get('thanks', id);
      if (!t) return;
      put('thanks', { ...t, reaction: t.reaction === el.dataset.r ? null : el.dataset.r });
      break;
    }
    case 'del-thanks': removeWithUndo('thanks', id, 'ありがとう'); break;
    case 'thanks-all': ui.thanksAll = true; break;
    case 'req-accept': case 'req-decline': case 'req-done': {
      const r = get('requests', id);
      if (!r) return;
      const status = { 'req-accept': 'accepted', 'req-decline': 'declined', 'req-done': 'done' }[el.dataset.act];
      put('requests', { ...r, status, ...(status === 'done' ? { doneAt: Date.now() } : {}) });
      if (status === 'done') toast('おつかれさま！伝えておきます');
      break;
    }
    case 'req-cancel': removeWithUndo('requests', id, 'お願い'); break;
    case 'req-thanks': {
      const r = get('requests', id);
      if (!r) return;
      sendThanks(`「${r.text}」をやってくれてありがとう！`);
      put('requests', { ...r, thanked: true });
      toast('ありがとうを送りました', lineToastAction(`「${r.text}」をやってくれてありがとう！`));
      break;
    }
    // 記念日・家計簿・メモ
    case 'del-event': removeWithUndo('events', id, '記念日'); break;
    case 'wish-done': { const w = get('wishes', id); if (w) put('wishes', { ...w, done: !w.done, doneAt: Date.now() }); if (w && !w.done) toast('いい思い出になりましたね'); break; }
    case 'del-wish': removeWithUndo('wishes', id, '項目'); break;
    case 'del-recurring': removeWithUndo('recurring', id, '固定費'); break;
    case 'mood': {
      const t = today();
      const cur = get('moods', `m-${device.me}-${t}`);
      if (cur?.mood === id) remove('moods', cur.id);
      else put('moods', { id: `m-${device.me}-${t}`, who: device.me, date: t, mood: id, at: Date.now() });
      break;
    }
    case 'ping': {
      const d = new Date(Date.now() + Number(id) * 60000);
      const eta = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      put('pings', { id: uid(), from: device.me, kind: 'home', eta, at: Date.now() });
      sheet.openLine(homeMessage(eta));
      return;
    }
    case 'dinner-vote': {
      const t = today(), dish = el.dataset.name;
      const vid = `dv-${t}-${device.me}-${L.hashId(dish)}`;
      if (get('dinner', vid)) remove('dinner', vid);
      else {
        put('dinner', { id: vid, who: device.me, date: t, name: dish });
        if (L.dinnerState(all('dinner'), t).match.includes(dish)) toast(`今夜は「${dish}」に決まり！`);
      }
      break;
    }
    case 'month': ui.month = Math.min(0, (ui.month || 0) + Number(id)); break;
    case 'del-expense': removeWithUndo('expenses', id, '支出'); break;
    case 'settle': {
      const net = L.balance(all('expenses'));
      if (!net) return;
      const from = net > 0 ? 'b' : 'a';
      if (!confirm(`${name(from)} → ${name(other(from))} ${fmtYen(Math.abs(net))} を精算済みにしますか？`)) return;
      put('expenses', { id: uid(), kind: 'settle', from, to: other(from), amount: Math.abs(net), date: today(), at: Date.now() });
      break;
    }
    case 'cal-create': case 'cal-reset':
      if (el.dataset.act === 'cal-reset' && !confirm('今のURLは使えなくなります。カレンダーに登録済みなら、登録し直しが必要です。作り直しますか？')) return;
      try { await calendarUrl(el.dataset.act === 'cal-reset'); } catch (err) { toast('サーバーにつながりません'); return; }
      break;
    case 'cal-copy':
      try { await navigator.clipboard.writeText(calendarLinks(device.calToken, device.calChores).https); toast('コピーしました'); }
      catch (err) { toast('コピーできませんでした'); }
      return;
    case 'pin-note': { const n = get('notes', id); if (n) put('notes', { ...n, pinned: !n.pinned }); ui.openNote = id; break; }
    case 'del-note': removeWithUndo('notes', id, 'メモ'); break;
    // 設定
    case 'set-me': device.me = id; persist(); pushUpdate(); break;
    case 'export': exportData(); return;
    case 'reset':
      if (!confirm('この端末のデータをすべて消して初期状態に戻しますか？')) return;
      store = seededStore(); pending = new Set(); persist(); break;
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
}

// メモの開閉を覚えておく（toggle はバブリングしないのでキャプチャで拾う）
view.addEventListener('toggle', e => {
  if (e.target.matches('details.note-item')) {
    if (e.target.open) ui.openNote = e.target.dataset.id;
    else if (ui.openNote === e.target.dataset.id) ui.openNote = null;
  }
}, true);

sheetEl.addEventListener('input', e => {
  if (!e.target.matches('textarea[data-line]')) return;
  sheet.line = e.target.value;
  const a = sheetEl.querySelector('a.line-btn');
  if (a) a.href = lineUrl(e.target.value);
});

function onChange(e) {
  const t = e.target;
  if (t.name === 'schedule') {
    t.closest('form').querySelector('.days-row').hidden = t.value !== 'days';
    return;
  }
  if (t.closest('form[data-form=push-prefs]')) {
    const f = new FormData(t.closest('form'));
    device.push.prefs = {
      morning: f.has('morning'), events: f.has('events'), shopping: f.has('shopping'),
      partner: f.has('partner'), chat: f.has('chat'), weekly: f.has('weekly'), time: f.get('time') || '08:00',
    };
    persist();
    pushUpdate();
    toast('通知の設定を保存しました');
    return;
  }
  if (t.dataset.act === 'cal-chores') {
    device.calChores = t.checked;
    persist();
    render();
    return;
  }
  if (t.dataset.act === 'receipt') {
    if (t.files[0]) startReceipt(t.files[0]);
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
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const me = device.me;
  const inSheet = sheetEl.contains(form);
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
      addShopping(text('name'));
      if (inSheet) toast(`「${text('name')}」を追加しました`);
      break;
    case 'stock':
      put('stock', { id: uid(), name: text('name'), low: false });
      break;
    case 'thanks':
      sendThanks(text('text'));
      toast('ありがとうを残しました', lineToastAction(text('text')));
      break;
    case 'request':
      put('requests', { id: uid(), from: me, to: other(me), text: text('text'), due: f.get('due') || '', status: 'open', at: Date.now() });
      toast(`${name(other(me))}にお願いしました`, lineToastAction(`お願いがあるんだけど、「${text('text')}」${f.get('due') ? `（${f.get('due')}までに）` : ''}お願いできる？ アプリにも入れておいたよ`));
      break;
    case 'event':
      put('events', { id: uid(), title: text('title'), date: f.get('date'), yearly: f.get('yearly') === 'on' });
      break;
    case 'expense': {
      const amount = Math.round(Number(f.get('amount')));
      if (!(amount > 0)) { toast('金額を入力してください'); return; }
      const r = inSheet ? null : ui.receipt;
      put('expenses', {
        id: uid(), title: text('title'), amount, date: f.get('date') || today(), paidBy: f.get('paidBy'), split: f.get('split'), at: Date.now(),
        category: f.get('category') || (r?.category) || L.expenseCategory(text('title')),
        ...(r?.items.length ? { items: r.items.slice(0, 20) } : {}),
      });
      if (!inSheet) ui.receipt = null;
      toast('記録しました');
      break;
    }
    case 'note': {
      const prev = form.dataset.id ? get('notes', form.dataset.id) : null;
      put('notes', { ...(prev || { id: uid() }), title: text('title'), body: String(f.get('body') || '') });
      if (prev) { ui.openNote = prev.id; toast('保存しました'); }
      break;
    }
    case 'ping':
      put('pings', { id: uid(), from: me, kind: 'home', eta: f.get('eta'), at: Date.now() });
      sheet.openLine(homeMessage(f.get('eta')));
      return;
    case 'dinner': {
      const t = today(), dish = text('name');
      put('dinner', { id: `dv-${t}-${me}-${L.hashId(dish)}`, who: me, date: t, name: dish });
      form.reset();
      sheet.render();
      return;
    }
    case 'wish':
      put('wishes', { id: uid(), kind: f.get('kind') || 'other', title: text('title'), note: text('note'), by: me, at: Date.now(), done: false });
      toast('追加しました');
      break;
    case 'recurring': {
      const amount = Math.round(Number(f.get('amount')));
      const day = Math.min(28, Math.max(1, Math.round(Number(f.get('day')) || 1)));
      if (!(amount > 0)) { toast('金額を入力してください'); return; }
      const n = new Date();
      put('recurring', {
        id: uid(), title: text('title'), amount, day, paidBy: f.get('paidBy'), split: f.get('split'),
        category: f.get('category') || L.expenseCategory(text('title')), startYm: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`,
      });
      const added = applyRecurring();
      toast(added ? '登録して、今月の分を記録しました' : `登録しました。毎月${day}日に記録します`);
      break;
    }
    case 'names':
      put('settings', { id: 'names', a: text('a'), b: text('b') });
      toast('保存しました');
      break;
    case 'ob-names':
      device.me = 'a';
      put('settings', { id: 'names', a: text('me'), b: text('partner') });
      onboard.open('invite');
      return;
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
      if (onboard.step) { onboard.open('who'); return; }
      break;
    }
    default: return;
  }
  if (inSheet) sheet.close();
  render();
}

// ---------- スワイプ（行を右へ: 完了、左へ: 削除） ----------
// li に data-swipe="right:toggle-shop left:del-shop" のように、行の中のボタンの data-act を書いておく
let swipe = null;
let swipeClickBlock = false;
view.addEventListener('pointerdown', e => {
  const li = e.target.closest('li[data-swipe]');
  if (!li || e.target.closest('input, select, textarea, a')) return;
  const acts = Object.fromEntries(li.dataset.swipe.split(' ').map(x => x.split(':')));
  swipe = { li, acts, x: e.clientX, y: e.clientY, dx: 0, on: false, pid: e.pointerId };
});
view.addEventListener('pointermove', e => {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.on) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < 12) return;
    swipe.on = true;
    swipe.li.classList.add('swiping');
  }
  const allowed = (dx > 0 && swipe.acts.right) || (dx < 0 && swipe.acts.left);
  swipe.dx = allowed ? dx : 0;
  swipe.li.style.transform = `translateX(${swipe.dx}px)`;
  swipe.li.classList.toggle('sw-right', swipe.dx > 30);
  swipe.li.classList.toggle('sw-left', swipe.dx < -30);
});
function endSwipe() {
  if (!swipe) return;
  const { li, dx, on, acts } = swipe;
  swipe = null;
  li.style.transform = '';
  li.classList.remove('swiping', 'sw-right', 'sw-left');
  if (!on) return;
  swipeClickBlock = true; // スワイプ後のクリックは無視する
  setTimeout(() => { swipeClickBlock = false; }, 350);
  const act = dx > 90 ? acts.right : dx < -90 ? acts.left : null;
  const btn = act && li.querySelector(`[data-act="${act}"]`);
  if (btn) { swipeClickBlock = false; btn.click(); }
}
view.addEventListener('pointerup', endSwipe);
view.addEventListener('pointercancel', endSwipe);
view.addEventListener('click', e => { if (swipeClickBlock) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

for (const root of [view, sheetEl, onboardEl]) {
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
}

document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) { sheet.close(); go(b.dataset.tab); }
});
document.getElementById('back').addEventListener('click', () => go(prevTab));
document.getElementById('settings-btn').addEventListener('click', () => go('settings'));
document.getElementById('fab').addEventListener('click', () => sheet.open('menu'));

window.addEventListener('hashchange', () => {
  const m = /^#join=(.+)$/.exec(location.hash);
  if (m) { joinFromLink(normalizeCode(m[1])); return; }
  const r = route(location.hash);
  if (r.tab !== tab || (r.seg && r.seg !== futariSeg)) go(r.tab, r.seg);
});

// 通知をタップしたとき（サービスワーカーから）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.tab) { const [t, seg] = e.data.tab.split('/'); go(t, seg); } });
}

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

// タブとヘッダーのアイコン
document.querySelectorAll('.tabs button').forEach(b => { b.innerHTML = `${ic(TAB_ICONS[b.dataset.tab])}<span class="tab-label">${titles[b.dataset.tab]}</span>`; });
document.getElementById('settings-btn').innerHTML = ic('settings');
document.getElementById('back').innerHTML = ic('back');
document.getElementById('fab').innerHTML = ic('plus');

applyRecurring();
render();
sync.connect();
pushUpdate();
checkFeatures().then(() => { if (tab === 'budget' || sheet.name) render(); });
{
  const m = /^#join=(.+)$/.exec(location.hash);
  if (m) joinFromLink(normalizeCode(m[1]));
  else if (shouldOnboard()) onboard.open('welcome');
}
