'use strict';

// ---------- データ ----------
const STORAGE_KEY = 'futari-data-v1';

const DEFAULT_DATA = {
  settings: { names: { a: 'わたし', b: '奥さん' }, me: 'a' },
  chores: [
    { id: 'c1', title: '食器洗い', assignee: 'a', every: 1, points: 1, lastDone: null },
    { id: 'c2', title: 'ゴミ出し', assignee: 'a', every: 3, points: 1, lastDone: null },
    { id: 'c3', title: '洗濯', assignee: 'b', every: 2, points: 2, lastDone: null },
    { id: 'c4', title: 'お風呂掃除', assignee: 'both', every: 7, points: 2, lastDone: null },
  ],
  log: [],      // { id, choreId, title, by, at, points }
  shopping: [], // { id, name, done, by }
  thanks: [],   // { id, from, text, at }
  events: [],   // { id, title, date: 'YYYY-MM-DD', yearly }
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...structuredClone(DEFAULT_DATA), ...JSON.parse(raw) };
  } catch (e) { /* 読めない場合は初期データ */ }
  return structuredClone(DEFAULT_DATA);
}

let data = load();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { toast('保存に失敗しました'); }
}

// ---------- ユーティリティ ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const name = who => who === 'both' ? 'ふたり' : data.settings.names[who];
const other = who => (who === 'a' ? 'b' : 'a');
const DAY = 86400000;

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); }
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
  setTimeout(() => el.remove(), 1800);
}

// ---------- 家事ロジック ----------
// every: 0 = 1回きり, n = n日ごと
function choreStatus(c) {
  if (!c.lastDone) return { due: true, label: 'まだ' };
  const since = daysBetween(c.lastDone, new Date());
  if (c.every === 0) return { due: false, label: '完了' };
  const left = c.every - since;
  if (left <= 0) return { due: true, label: left === 0 ? '今日' : `${-left}日遅れ` };
  return { due: false, label: `あと${left}日` };
}

function completeChore(id) {
  const c = data.chores.find(x => x.id === id);
  if (!c) return;
  const by = data.settings.me;
  c.lastDone = Date.now();
  data.log.unshift({ id: uid(), choreId: c.id, title: c.title, by, at: c.lastDone, points: c.points });
  data.log = data.log.slice(0, 500);
  save();
  toast(`「${c.title}」おつかれさま！`);
}

function undoLog(logId) {
  const entry = data.log.find(l => l.id === logId);
  data.log = data.log.filter(l => l.id !== logId);
  if (entry) {
    const c = data.chores.find(x => x.id === entry.choreId);
    if (c) {
      const prev = data.log.find(l => l.choreId === c.id);
      c.lastDone = prev ? prev.at : null;
    }
  }
  save();
}

function weekPoints() {
  const since = Date.now() - 7 * DAY;
  const p = { a: 0, b: 0 };
  data.log.filter(l => l.at >= since).forEach(l => { p[l.by] += l.points; });
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
  return data.events
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

function render() {
  document.getElementById('page-title').textContent = titles[tab];
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('me-toggle').textContent = `👤 ${name(data.settings.me)}`;
  view.innerHTML = screens[tab]();
}

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

function choreItem(c, withMenu) {
  const st = choreStatus(c);
  return `
    <li>
      <button class="check" data-act="done-chore" data-id="${c.id}" aria-label="完了にする"></button>
      <div class="grow">
        <div class="title">${esc(c.title)}</div>
        <div class="muted">${c.every === 0 ? '1回だけ' : `${c.every}日ごと`} · ${c.points}pt · ${esc(st.label)}</div>
      </div>
      <span class="tag ${c.assignee}">${esc(name(c.assignee))}</span>
      ${withMenu ? `<button class="icon-btn" data-act="del-chore" data-id="${c.id}" aria-label="削除">🗑</button>` : ''}
    </li>`;
}

const screens = {
  home() {
    const due = data.chores.filter(c => choreStatus(c).due);
    const mine = due.filter(c => c.assignee === data.settings.me || c.assignee === 'both');
    const up = upcomingEvents()[0];
    const lastThanks = data.thanks[0];
    const shopLeft = data.shopping.filter(s => !s.done).length;
    return `
      <div class="card">
        <h2>今日やること（${esc(name(data.settings.me))}）</h2>
        ${mine.length ? `<ul class="list">${mine.map(c => choreItem(c, false)).join('')}</ul>` : '<p class="empty">今日の担当家事はありません 🎉</p>'}
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
    const sorted = [...data.chores].sort((x, y) => choreStatus(y).due - choreStatus(x).due);
    return `
      <div class="card">
        <h2>家事リスト</h2>
        ${sorted.length ? `<ul class="list">${sorted.map(c => choreItem(c, true)).join('')}</ul>` : '<p class="empty">家事を追加しましょう</p>'}
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
        ${data.log.length ? `<ul class="list">${data.log.slice(0, 20).map(l => `
          <li>
            <span class="tag ${l.by}">${esc(name(l.by))}</span>
            <div class="grow"><div class="title">${esc(l.title)}</div><div class="muted">${fmtDate(l.at)} · ${l.points}pt</div></div>
            <button class="icon-btn" data-act="undo-log" data-id="${l.id}" aria-label="取り消し">↩︎</button>
          </li>`).join('')}</ul>` : '<p class="empty">まだ記録がありません</p>'}
      </div>`;
  },

  shopping() {
    const items = [...data.shopping].sort((x, y) => x.done - y.done);
    return `
      <div class="card">
        <form class="add" data-form="shop">
          <div class="row"><input name="name" placeholder="例: 牛乳" required maxlength="40"><button class="btn" style="flex:0 0 auto">追加</button></div>
        </form>
      </div>
      <div class="card">
        ${items.length ? `<ul class="list">${items.map(s => `
          <li class="${s.done ? 'done' : ''}">
            <button class="check ${s.done ? 'on' : ''}" data-act="toggle-shop" data-id="${s.id}" aria-label="購入済みにする">${s.done ? '✓' : ''}</button>
            <div class="grow"><div class="title">${esc(s.name)}</div><div class="muted">${esc(name(s.by))}が追加</div></div>
            <button class="icon-btn" data-act="del-shop" data-id="${s.id}" aria-label="削除">🗑</button>
          </li>`).join('')}</ul>` : '<p class="empty">買うものはありません</p>'}
        ${data.shopping.some(s => s.done) ? '<p><button class="btn small ghost" data-act="clear-shop">購入済みを消す</button></p>' : ''}
      </div>`;
  },

  thanks() {
    const me = data.settings.me;
    const count = who => data.thanks.filter(t => t.from === who).length;
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
        ${data.thanks.length ? `<ul class="list">${data.thanks.map(t => `
          <li>
            <span class="tag ${t.from}">${esc(name(t.from))}</span>
            <div class="grow"><div class="note">${esc(t.text)}</div><div class="muted">${fmtDate(t.at)}</div></div>
            <button class="icon-btn" data-act="del-thanks" data-id="${t.id}" aria-label="削除">🗑</button>
          </li>`).join('')}</ul>` : '<p class="empty">まだありません</p>'}
      </div>`;
  },

  events() {
    const up = upcomingEvents();
    const past = data.events.filter(ev => !up.some(u => u.ev.id === ev.id));
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
            <button class="icon-btn" data-act="del-event" data-id="${x.ev.id}" aria-label="削除">🗑</button>
          </li>`; }).join('')}</ul>` : '<p class="empty">登録された記念日はありません</p>'}
      </div>
      ${past.length ? `<div class="card"><h2>過ぎた予定</h2><ul class="list">${past.map(ev => `
          <li class="done"><div class="grow"><div class="title">${esc(ev.title)}</div><div class="muted">${esc(ev.date)}</div></div>
          <button class="icon-btn" data-act="del-event" data-id="${ev.id}" aria-label="削除">🗑</button></li>`).join('')}</ul></div>` : ''}`;
  },

  settings() {
    return `
      <div class="card">
        <h2>ふたりの名前</h2>
        <form class="add" data-form="names">
          <label class="field">1人目<input name="a" value="${esc(data.settings.names.a)}" maxlength="12" required></label>
          <label class="field">2人目<input name="b" value="${esc(data.settings.names.b)}" maxlength="12" required></label>
          <button class="btn">保存</button>
        </form>
      </div>
      <div class="card">
        <h2>データのバックアップ</h2>
        <p class="muted">データはこの端末の中だけに保存されています。書き出したファイルを相手の端末で読み込むと、同じ内容を共有できます。</p>
        <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn small" data-act="export">書き出す</button>
          <label class="btn small ghost">読み込む<input type="file" accept="application/json" data-act="import" hidden></label>
          <button class="btn small ghost" data-act="reset">初期化</button>
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
  data.settings.me = other(data.settings.me);
  save();
  toast(`${name(data.settings.me)}として操作中`);
  render();
});

view.addEventListener('click', e => {
  const go = e.target.closest('[data-goto]');
  if (go) { tab = go.dataset.goto; render(); return; }
  const el = e.target.closest('button[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'done-chore': completeChore(id); break;
    case 'del-chore':
      if (!confirm('この家事を削除しますか？')) return;
      data.chores = data.chores.filter(c => c.id !== id); break;
    case 'undo-log': undoLog(id); break;
    case 'toggle-shop': { const s = data.shopping.find(x => x.id === id); if (s) s.done = !s.done; break; }
    case 'del-shop': data.shopping = data.shopping.filter(s => s.id !== id); break;
    case 'clear-shop': data.shopping = data.shopping.filter(s => !s.done); break;
    case 'del-thanks':
      if (!confirm('削除しますか？')) return;
      data.thanks = data.thanks.filter(t => t.id !== id); break;
    case 'del-event': data.events = data.events.filter(ev => ev.id !== id); break;
    case 'export': exportData(); return;
    case 'reset':
      if (!confirm('すべてのデータを消して初期状態に戻しますか？')) return;
      data = structuredClone(DEFAULT_DATA); break;
    default: return;
  }
  save();
  render();
});

view.addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const me = data.settings.me;
  switch (e.target.dataset.form) {
    case 'chore':
      data.chores.push({
        id: uid(), title: f.get('title').trim(), assignee: f.get('assignee'),
        every: Number(f.get('every')), points: Number(f.get('points')), lastDone: null,
      });
      break;
    case 'shop':
      data.shopping.push({ id: uid(), name: f.get('name').trim(), done: false, by: me });
      break;
    case 'thanks':
      data.thanks.unshift({ id: uid(), from: me, text: f.get('text').trim(), at: Date.now() });
      toast('ありがとうを残しました 💌');
      break;
    case 'event':
      data.events.push({ id: uid(), title: f.get('title').trim(), date: f.get('date'), yearly: f.get('yearly') === 'on' });
      break;
    case 'names':
      data.settings.names = { a: f.get('a').trim(), b: f.get('b').trim() };
      toast('保存しました');
      break;
  }
  save();
  render();
});

view.addEventListener('change', e => {
  if (e.target.dataset.act !== 'import') return;
  const file = e.target.files[0];
  if (!file) return;
  file.text().then(txt => {
    const parsed = JSON.parse(txt);
    if (!parsed || !Array.isArray(parsed.chores)) throw new Error('bad');
    data = { ...structuredClone(DEFAULT_DATA), ...parsed };
    save();
    toast('読み込みました');
    render();
  }).catch(() => toast('読み込めないファイルです'));
});

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
