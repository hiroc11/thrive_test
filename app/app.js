'use strict';

// ---------- データ ----------
// レコードはすべて { id, updatedAt, deleted? } を持ち、同期では updatedAt が新しい方を採用する。
// 削除は deleted: true の「墓標」を残して相手の端末にも伝える。
const STORE_KEY = 'futari-store-v2';     // { rev, records: { col: { id: rec } } }  ふたりで共有するデータ
const PENDING_KEY = 'futari-pending-v2'; // ["col/id", ...]  まだサーバーに送っていない変更
const DEVICE_KEY = 'futari-device-v2';   // { me, clientId, sync: { server, room } | null }  この端末だけの設定
const LEGACY_KEY = 'futari-data-v1';

const COLLECTIONS = ['settings', 'chores', 'log', 'shopping', 'thanks', 'events'];
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
}

function leaveRoom() {
  sync.disconnect();
  device.sync = null;
  store.rev = 0;
  persist();
  sync.setStatus('local');
}

// ---------- ユーティリティ ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const names = () => get('settings', 'names') || SEED.settings[0];
const name = who => who === 'both' ? 'ふたり' : names()[who];
const other = who => (who === 'a' ? 'b' : 'a');
const DAY = 86400000;

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); }
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const byNewest = (x, y) => y.at - x.at;

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ---------- 家事ロジック ----------
// 最後に完了した日時は記録（log）から求める。ふたりが同時に完了しても記録が消えない。
function lastDoneMap() {
  const m = {};
  all('log').forEach(l => { if (!m[l.choreId] || m[l.choreId] < l.at) m[l.choreId] = l.at; });
  return m;
}

// every: 0 = 1回きり, n = n日ごと
function choreStatus(c, lastDone) {
  if (!lastDone) return { due: true, label: 'まだ' };
  if (c.every === 0) return { due: false, label: '完了' };
  const left = c.every - daysBetween(lastDone, new Date());
  if (left <= 0) return { due: true, label: left === 0 ? '今日' : `${-left}日遅れ` };
  return { due: false, label: `あと${left}日` };
}

function completeChore(id) {
  const c = get('chores', id);
  if (!c) return;
  put('log', { id: uid(), choreId: c.id, title: c.title, by: device.me, at: Date.now(), points: c.points });
  toast(`「${c.title}」おつかれさま！`);
}

function weekPoints() {
  const since = Date.now() - 7 * DAY;
  const p = { a: 0, b: 0 };
  all('log').filter(l => l.at >= since && p[l.by] !== undefined).forEach(l => { p[l.by] += l.points; });
  return p;
}

// ---------- 記念日ロジック ----------
function nextOccurrence(ev) {
  const today = startOfDay();
  const [y, m, d] = ev.date.split('-').map(Number);
  if (!ev.yearly) return new Date(y, m - 1, d);
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  return next;
}

function upcomingEvents() {
  const today = startOfDay();
  return all('events')
    .map(ev => ({ ev, next: nextOccurrence(ev) }))
    .filter(x => x.next >= today)
    .sort((x, y) => x.next - y.next);
}

function eventLabel({ ev, next }) {
  const days = daysBetween(new Date(), next);
  const when = days === 0 ? '今日！' : `あと${days}日`;
  let extra = '';
  if (ev.yearly) {
    const years = next.getFullYear() - Number(ev.date.slice(0, 4));
    if (years > 0) extra = `（${years}回目）`;
  }
  return { when, extra, dateText: `${next.getMonth() + 1}/${next.getDate()}` };
}

// ---------- 画面 ----------
const view = document.getElementById('view');
const titles = { home: 'ホーム', chores: '家事', shopping: '買い物', thanks: 'ありがとう', events: '記念日', settings: '設定' };
let tab = 'home';
let renderDeferred = false;

function render() {
  renderDeferred = false;
  document.getElementById('page-title').textContent = titles[tab];
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
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

function choreItem(c, st, withMenu) {
  return `
    <li>
      <button class="check" data-act="done-chore" data-id="${esc(c.id)}" aria-label="完了にする"></button>
      <div class="grow">
        <div class="title">${esc(c.title)}</div>
        <div class="muted">${c.every === 0 ? '1回だけ' : `${c.every}日ごと`} · ${c.points}pt · ${esc(st.label)}</div>
      </div>
      <span class="tag ${esc(c.assignee)}">${esc(name(c.assignee))}</span>
      ${withMenu ? `<button class="icon-btn" data-act="del-chore" data-id="${esc(c.id)}" aria-label="削除">🗑</button>` : ''}
    </li>`;
}

function choresWithStatus() {
  const last = lastDoneMap();
  return all('chores').map(c => ({ c, st: choreStatus(c, last[c.id]) }));
}

const screens = {
  home() {
    const due = choresWithStatus().filter(x => x.st.due);
    const mine = due.filter(x => x.c.assignee === device.me || x.c.assignee === 'both');
    const up = upcomingEvents()[0];
    const lastThanks = all('thanks').sort(byNewest)[0];
    const shopLeft = all('shopping').filter(s => !s.done).length;
    return `
      ${!sync.enabled ? `<div class="card hint">
        <h2>ふたりの端末をつなげましょう</h2>
        <p class="muted">共有コードでつなぐと、家事や買い物リストがふたりのスマホで自動的に同期されます。</p>
        <button class="btn small" data-goto="settings">つなぐ</button>
      </div>` : ''}
      <div class="card">
        <h2>今日やること（${esc(name(device.me))}）</h2>
        ${mine.length ? `<ul class="list">${mine.map(x => choreItem(x.c, x.st, false)).join('')}</ul>` : '<p class="empty">今日の担当家事はありません 🎉</p>'}
        ${due.length > mine.length ? `<p class="muted">相手の担当で残っている家事: ${due.length - mine.length}件</p>` : ''}
      </div>
      ${balanceCard()}
      <div class="card">
        <h2>次の記念日</h2>
        ${up ? (() => { const l = eventLabel(up); return `<div class="big">${esc(l.when)}</div><div>${esc(up.ev.title)}${esc(l.extra)} · ${l.dateText}</div>`; })()
             : '<p class="empty">記念日タブから登録できます</p>'}
      </div>
      <div class="card">
        <h2>最近のありがとう</h2>
        ${lastThanks ? `<div class="note">${esc(lastThanks.text)}</div><div class="muted">${esc(name(lastThanks.from))} → ${esc(name(other(lastThanks.from)))} · ${fmtDate(lastThanks.at)}</div>`
                     : '<p class="empty">小さなことでも「ありがとう」を残してみましょう</p>'}
        <p><button class="btn small" data-goto="thanks">ありがとうを書く</button></p>
      </div>
      <div class="card">
        <h2>買い物リスト</h2>
        <p>${shopLeft ? `未購入 ${shopLeft}件` : '買うものはありません'}</p>
        <button class="btn small ghost" data-goto="shopping">開く</button>
      </div>`;
  },

  chores() {
    const sorted = choresWithStatus().sort((x, y) => (y.st.due - x.st.due) || x.c.title.localeCompare(y.c.title, 'ja'));
    const log = all('log').sort(byNewest).slice(0, 20);
    return `
      <div class="card">
        <h2>家事リスト</h2>
        ${sorted.length ? `<ul class="list">${sorted.map(x => choreItem(x.c, x.st, true)).join('')}</ul>` : '<p class="empty">家事を追加しましょう</p>'}
      </div>
      <div class="card">
        <h2>家事を追加</h2>
        <form class="add" data-form="chore">
          <input name="title" placeholder="例: 掃除機がけ" required maxlength="40">
          <div class="row">
            <label class="field">担当
              <select name="assignee">
                <option value="a">${esc(name('a'))}</option>
                <option value="b">${esc(name('b'))}</option>
                <option value="both">ふたり</option>
              </select>
            </label>
            <label class="field">頻度
              <select name="every">
                <option value="1">毎日</option><option value="2">2日ごと</option><option value="3">3日ごと</option>
                <option value="7">毎週</option><option value="14">2週ごと</option><option value="30">毎月</option>
                <option value="0">1回だけ</option>
              </select>
            </label>
            <label class="field">大変さ
              <select name="points"><option value="1">軽い 1pt</option><option value="2">普通 2pt</option><option value="3">重い 3pt</option></select>
            </label>
          </div>
          <button class="btn">追加</button>
        </form>
      </div>
      ${balanceCard()}
      <div class="card">
        <h2>最近の記録</h2>
        ${log.length ? `<ul class="list">${log.map(l => `
          <li>
            <span class="tag ${esc(l.by)}">${esc(name(l.by))}</span>
            <div class="grow"><div class="title">${esc(l.title)}</div><div class="muted">${fmtDate(l.at)} · ${l.points}pt</div></div>
            <button class="icon-btn" data-act="undo-log" data-id="${esc(l.id)}" aria-label="取り消し">↩︎</button>
          </li>`).join('')}</ul>` : '<p class="empty">まだ記録がありません</p>'}
      </div>`;
  },

  shopping() {
    const items = all('shopping').sort((x, y) => (x.done - y.done) || (x.at || 0) - (y.at || 0));
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
            <div class="grow"><div class="title">${esc(s.name)}</div><div class="muted">${esc(name(s.by))}が追加</div></div>
            <button class="icon-btn" data-act="del-shop" data-id="${esc(s.id)}" aria-label="削除">🗑</button>
          </li>`).join('')}</ul>` : '<p class="empty">買うものはありません</p>'}
        ${items.some(s => s.done) ? '<p><button class="btn small ghost" data-act="clear-shop">購入済みを消す</button></p>' : ''}
      </div>`;
  },

  thanks() {
    const me = device.me;
    const list = all('thanks').sort(byNewest);
    const count = who => list.filter(t => t.from === who).length;
    return `
      <div class="card">
        <h2>${esc(name(other(me)))}へのありがとう</h2>
        <form class="add" data-form="thanks">
          <textarea name="text" placeholder="例: 今日ご飯を作ってくれてありがとう。すごくおいしかった！" required maxlength="300"></textarea>
          <button class="btn">残す</button>
        </form>
        <p class="muted">言葉にしにくい感謝も、ここに書いておけば相手が後から読めます。</p>
      </div>
      <div class="card">
        <h2>これまでのありがとう</h2>
        <p class="muted">${esc(name('a'))} → ${count('a')}件 / ${esc(name('b'))} → ${count('b')}件</p>
        ${list.length ? `<ul class="list">${list.map(t => `
          <li>
            <span class="tag ${esc(t.from)}">${esc(name(t.from))}</span>
            <div class="grow"><div class="note">${esc(t.text)}</div><div class="muted">${fmtDate(t.at)}</div></div>
            <button class="icon-btn" data-act="del-thanks" data-id="${esc(t.id)}" aria-label="削除">🗑</button>
          </li>`).join('')}</ul>` : '<p class="empty">まだありません</p>'}
      </div>`;
  },

  events() {
    const up = upcomingEvents();
    const past = all('events').filter(ev => !up.some(u => u.ev.id === ev.id));
    return `
      <div class="card">
        <h2>記念日・予定を追加</h2>
        <form class="add" data-form="event">
          <input name="title" placeholder="例: 結婚記念日 / 誕生日 / 旅行" required maxlength="40">
          <div class="row">
            <input name="date" type="date" required>
            <label class="field" style="flex-direction:row;display:flex;align-items:center;gap:6px">
              <input type="checkbox" name="yearly" checked style="width:auto"> 毎年
            </label>
          </div>
          <button class="btn">追加</button>
        </form>
      </div>
      <div class="card">
        <h2>これから</h2>
        ${up.length ? `<ul class="list">${up.map(x => { const l = eventLabel(x); return `
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

  settings() {
    const n = names();
    const defaultServer = /^https?:$/.test(location.protocol) ? location.origin : '';
    const syncCard = sync.enabled ? `
      <div class="card">
        <h2>ふたりの同期 <span class="sync-label">${esc({ ok: '同期済み', syncing: '同期中…', offline: 'オフライン', local: '' }[sync.status])}</span></h2>
        <p class="muted">相手のスマホでこのアプリを開き、「設定 → コードで参加」にこのコードを入力してください。</p>
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
    return `
      ${syncCard}
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

// ---------- イベント ----------
document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) { tab = b.dataset.tab; render(); window.scrollTo(0, 0); }
});

document.getElementById('me-toggle').addEventListener('click', () => {
  device.me = other(device.me);
  persist();
  toast(`${name(device.me)}として操作中`);
  render();
});

function serverUrl() {
  const v = (document.getElementById('server-url')?.value || '').trim();
  if (!/^https?:\/\/[^\s]+$/.test(v)) { toast('同期サーバーのURLを入力してください'); return null; }
  device.lastServer = v;
  return v;
}

const normalizeCode = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

view.addEventListener('click', async e => {
  const go = e.target.closest('[data-goto]');
  if (go) { tab = go.dataset.goto; render(); return; }
  const el = e.target.closest('button[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'done-chore': completeChore(id); break;
    case 'del-chore':
      if (!confirm('この家事を削除しますか？')) return;
      remove('chores', id); break;
    case 'undo-log': remove('log', id); break;
    case 'toggle-shop': { const s = get('shopping', id); if (s) put('shopping', { ...s, done: !s.done }); break; }
    case 'del-shop': remove('shopping', id); break;
    case 'clear-shop': all('shopping').filter(s => s.done).forEach(s => remove('shopping', s.id)); break;
    case 'del-thanks':
      if (!confirm('削除しますか？')) return;
      remove('thanks', id); break;
    case 'del-event': remove('events', id); break;
    case 'set-me': device.me = id; persist(); break;
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
      leaveRoom(); break;
    default: return;
  }
  render();
});

view.addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const me = device.me;
  switch (e.target.dataset.form) {
    case 'chore':
      put('chores', {
        id: uid(), title: f.get('title').trim(), assignee: f.get('assignee'),
        every: Number(f.get('every')), points: Number(f.get('points')),
      });
      break;
    case 'shop':
      put('shopping', { id: uid(), name: f.get('name').trim(), done: false, by: me, at: Date.now() });
      break;
    case 'thanks':
      put('thanks', { id: uid(), from: me, text: f.get('text').trim(), at: Date.now() });
      toast('ありがとうを残しました 💌');
      break;
    case 'event':
      put('events', { id: uid(), title: f.get('title').trim(), date: f.get('date'), yearly: f.get('yearly') === 'on' });
      break;
    case 'names':
      put('settings', { id: 'names', a: f.get('a').trim(), b: f.get('b').trim() });
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
  }
  render();
});

view.addEventListener('change', e => {
  if (e.target.dataset.act !== 'import') return;
  const file = e.target.files[0];
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

function exportData() {
  const blob = new Blob([JSON.stringify({ version: 2, records: store.records }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `futari-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
sync.connect();
