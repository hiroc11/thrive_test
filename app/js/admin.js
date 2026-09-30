// 運営画面：継続率・毎日の利用者数・合計・ご意見・通報を見る
const $ = id => document.getElementById(id);
const KEY = 'puku-admin-token';
const getToken = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
const setToken = v => { try { sessionStorage.setItem(KEY, v); } catch {} };

async function get(path) {
  const res = await fetch(path, { headers: { 'x-admin-token': getToken() } });
  if (!res.ok) throw new Error(res.status === 404 ? '合言葉がちがうか、運営画面が使えない設定です' : '読み込めませんでした');
  return res.json();
}
const when = ms => new Date(ms).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const md = day => { const [, m, d] = day.split('-'); return `${Number(m)}/${Number(d)}`; };
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function tile(label, value, sub) {
  const t = el('div', 'tile');
  t.append(el('span', null, label), el('b', null, value));
  if (sub) t.append(el('small', null, sub));
  return t;
}

function renderRetention(ret) {
  const box = $('retention');
  box.innerHTML = '';
  ret.forEach(r => box.append(tile(`${r.day}日後`,
    r.rate == null ? '—' : `${Math.round(r.rate * 100)}%`,
    r.cohort ? `${r.cohort}人中 ${r.returned}人` : 'まだ計算できません')));
}

function renderDau(dau) {
  const chart = $('dau'), tip = $('tip');
  chart.innerHTML = '';
  const max = Math.max(1, ...dau.map(d => d.active));
  const peak = dau.reduce((a, d) => (d.active > a.active ? d : a), dau[0]);
  dau.forEach((d, i) => {
    const col = el('div', 'col');
    col.tabIndex = 0;
    col.setAttribute('aria-label', `${md(d.day)}：${d.active}人`);
    const bar = el('i');
    bar.style.height = `${(d.active / max) * 100}%`;
    col.append(bar);
    // ラベルは最新日と最大の日だけ（全部に数字は付けない）
    if (d === peak || i === dau.length - 1) {
      const v = el('span', 'v-label', String(d.active));
      v.style.bottom = `calc(${(d.active / max) * 100}% + 2px)`;
      v.style.top = 'auto';
      col.append(v);
    }
    if (i % 3 === 0 || i === dau.length - 1) col.append(el('span', 'x-label', md(d.day)));
    const show = () => {
      const r = col.getBoundingClientRect();
      tip.textContent = `${md(d.day)}：${d.active}人`;
      tip.style.left = `${r.left + r.width / 2}px`;
      tip.style.top = `${r.top + r.height - (d.active / max) * (r.height)}px`;
      tip.hidden = false;
    };
    col.addEventListener('pointerenter', show);
    col.addEventListener('focus', show);
    col.addEventListener('pointerleave', () => { tip.hidden = true; });
    col.addEventListener('blur', () => { tip.hidden = true; });
    chart.append(col);
  });
  const body = $('dauTable').querySelector('tbody');
  body.innerHTML = '';
  dau.slice().reverse().forEach(d => {
    const tr = el('tr');
    tr.append(el('td', null, md(d.day)), el('td', null, `${d.active}人`));
    body.append(tr);
  });
}

function renderTotals(t) {
  const box = $('totals');
  box.innerHTML = '';
  box.append(tile('登録した人', `${t.users}人`), tile('発行したシール', `${t.stickers}枚`), tile('成立した交換', `${t.trades}回`),
    tile('ご意見', `${t.feedback}件`), tile('通報', `${t.reports}件`));
}

function renderList(id, rows, build, emptyText) {
  const ul = $(id);
  ul.innerHTML = '';
  if (!rows.length) { ul.append(el('li', 'empty', emptyText)); return; }
  rows.forEach(r => ul.append(build(r)));
}

async function load() {
  try {
    const [m, fb, rep] = await Promise.all([get('/api/admin/metrics'), get('/api/admin/feedback'), get('/api/admin/reports')]);
    $('login').hidden = true;
    $('board').hidden = false;
    $('reload').hidden = false;
    renderRetention(m.retention);
    renderDau(m.dau);
    renderTotals(m.totals);
    renderList('feedback', fb, r => {
      const li = el('li');
      const meta = el('div', 'meta');
      meta.append(el('span', 'pill', r.category), el('span', null, when(r.at)));
      li.append(meta, el('p', null, r.text));
      return li;
    }, 'まだご意見はありません');
    renderList('reports', rep, r => {
      const li = el('li');
      const meta = el('div', 'meta');
      meta.append(el('span', 'pill', r.reason), el('span', null, when(r.at)));
      li.append(meta, el('p', null, `${r.reporter} → ${r.target}`));
      return li;
    }, 'まだ通報はありません');
  } catch (e) {
    $('login').hidden = false;
    $('board').hidden = true;
    $('loginErr').textContent = e.message;
    $('loginErr').hidden = false;
  }
}

$('login').addEventListener('submit', e => {
  e.preventDefault();
  setToken($('token').value.trim());
  $('loginErr').hidden = true;
  load();
});
$('reload').addEventListener('click', load);
if (getToken()) load();
