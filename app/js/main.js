// アプリ本体：画面の切り替え・ホーム（毎日の特典とパック）・シール帳・図鑑・友達・設定
import { api, token, connectEvents } from './api.js';
import { DESIGN_OF, DESIGNS, RARITY, SERIES } from './catalog.js';
import { makeSticker, initGlitter } from './stickers.js';
import { startFeel, feel, setSound, enableGyro } from './feel.js';
import { buildShareImage, shareOrSave } from './share.js';
import { initTrade } from './trade.js';

const $ = id => document.getElementById(id);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));
const pick = a => a[Math.floor(Math.random() * a.length)];

export const S = {
  me: null, stickers: [], newIds: new Set(),
  friends: { friends: [], incoming: [], outgoing: [], trades: [] },
  meta: { stamps: [], reportReasons: [] }
};
export const full = s => ({ ...DESIGN_OF[s.code], ...s });
export const fmt = s => {
  const of = DESIGN_OF[s.code].of;
  return of >= 10000 ? `No.${s.no}` : `No.${String(s.no).padStart(String(of).length, '0')} / ${of}`;
};
export const chipHTML = rarity => `<span class="chip ${RARITY[rarity].cls}">${RARITY[rarity].label}</span>`;

const toastEl = $('toast');
export function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastEl.t);
  toastEl.t = setTimeout(() => { toastEl.hidden = true; }, 3200);
}
export const showError = e => toast(e?.message || 'うまくいきませんでした');

// ---------- はじめての人 ----------
function showOnboard() {
  $('appRoot').hidden = true;
  $('onboard').hidden = false;
  const y = new Date().getFullYear();
  $('suYear').innerHTML = '<option value="">えらんでね</option>' +
    Array.from({ length: 75 }, (_, i) => y - 6 - i).map(v => `<option value="${v}">${v}年</option>`).join('');
}
$('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('suErr');
  err.hidden = true;
  try {
    const r = await api('POST', '/api/signup', { nickname: $('suName').value, birthYear: Number($('suYear').value), agreed: $('suAgree').checked });
    token.set(r.token);
    await boot();
  } catch (x) { err.textContent = x.message; err.hidden = false; }
});
$('claimForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('claimErr');
  err.hidden = true;
  try {
    const r = await api('POST', '/api/transfer/claim', { code: $('claimCode').value });
    token.set(r.token);
    await boot();
  } catch (x) { err.textContent = x.message; err.hidden = false; }
});

// ---------- 画面の切り替え ----------
const views = [...document.querySelectorAll('.view')];
function go(name) {
  if (!views.some(v => v.dataset.view === name)) name = 'home';
  views.forEach(v => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll('.tabs button').forEach(b => {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (name === 'zukan') loadZukan();
  if (name === 'book') renderBook();
  if (name === 'friends') renderFriends();
  if (name === 'settings') renderSettings();
  try { history.replaceState(null, '', name === 'home' ? location.pathname : `#${name}`); } catch {}
  scrollTo({ top: 0 });
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
export const goto = go;

// ---------- 読み込み ----------
export async function loadStickers() {
  S.stickers = await api('GET', '/api/stickers');
  if (!views.find(v => v.dataset.view === 'book').hidden) renderBook();
}
export async function loadFriends() {
  S.friends = await api('GET', '/api/friends');
  const badge = $('friendBadge');
  badge.hidden = !S.friends.incoming.length;
  badge.textContent = String(S.friends.incoming.length);
  renderInvites();
  if (!views.find(v => v.dataset.view === 'friends').hidden) renderFriends();
}
async function loadMe() {
  S.me = await api('GET', '/api/me');
  $('hello').textContent = `${S.me.nickname}さん`;
  renderDaily();
}

// ---------- ホーム：スタンプと無料パック ----------
function renderDaily(stampedNow) {
  const { stamps, freePackAvailable } = S.me.daily;
  $('stamps7').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const on = i < stamps;
    const cls = [on ? 'on' : '', i === 6 ? 'goal' : '', stampedNow && i === stamps - 1 ? 'fresh' : ''].filter(Boolean).join(' ');
    return `<i class="${cls}">${on ? '★' : i === 6 ? '賞' : i + 1}</i>`;
  }).join('');
  $('stampNote').textContent = `ログインスタンプ ${stamps}/7・7こで「がんばりぼし」。休んでも消えないよ`;
  const free = $('freeBtn');
  free.disabled = !freePackAvailable;
  free.textContent = freePackAvailable ? '今日の無料パック' : '無料パックはまた明日';
  $('mainBtn').hidden = !freePackAvailable && state === 'idle';
  $('hint').hidden = !freePackAvailable || state !== 'idle';
  const { rare, srare } = S.me.pity;
  $('pRare').textContent = rare <= 1 ? '次で確定！' : `あと${rare}パック`;
  $('pSR').textContent = srare <= 1 ? '次で確定！' : `あと${srare}パック`;
  $('pRareBar').style.width = `${(10 - rare) * 10}%`;
  $('pSRBar').style.width = `${(50 - srare) * 2}%`;
}
async function checkIn() {
  const r = await api('POST', '/api/daily/checkin');
  S.me.daily.stamps = r.stamps;
  if (!r.stamped) return;
  renderDaily(true);
  if (r.reward) {
    S.newIds.add(r.reward.id);
    await loadStickers();
    toast('スタンプが7こたまった！「がんばりぼし」をシール帳に貼ったよ');
  } else toast(`ログインスタンプ ${r.stamps}こめ！`);
}
function renderInvites() {
  const box = $('invites');
  box.innerHTML = '';
  S.friends.trades.forEach(t => {
    const f = S.friends.friends.find(x => x.id === t.friendId);
    if (!f) return;
    const row = document.createElement('div');
    row.className = 'inbox';
    const text = document.createElement('span');
    text.textContent = `${f.nickname}と交換中（${t.mode === 'blind' ? 'ふせて交換' : 'ふつう交換'}）`;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = 'ひらく';
    b.addEventListener('click', () => trade.open(f));
    row.append(text, b);
    box.append(row);
  });
}

// パックの開封演出
const stage = $('stage'), pack = $('pack'), packTop = $('packTop'), slot = $('slot'), glow = $('glow'), hint = $('hint'), result = $('result'), mainBtn = $('mainBtn');
let state = 'idle', revealed = null;
const anim = (el, frames, opts) => el.animate(frames, { fill: 'forwards', easing: 'cubic-bezier(.2,.8,.2,1)', ...opts }).finished;
let tearFrom = null;
pack.addEventListener('pointerdown', e => {
  if (state !== 'idle' || !S.me.daily.freePackAvailable) return;
  tearFrom = e.clientX;
  pack.setPointerCapture(e.pointerId);
});
pack.addEventListener('pointermove', e => {
  if (tearFrom == null) return;
  const t = Math.max(0, Math.min(1, (e.clientX - tearFrom) / (pack.offsetWidth * .8)));
  pack.style.setProperty('--tear', t.toFixed(3));
  if (t >= 1) { tearFrom = null; openPack(); }
});
pack.addEventListener('pointerup', () => {
  if (tearFrom == null) return;
  tearFrom = null;
  if (state === 'idle') pack.style.setProperty('--tear', 0);
});
function burst(count, colors) {
  for (let i = 0; i < count; i++) {
    const s = document.createElement('i');
    s.className = 'spark';
    s.style.background = colors[i % colors.length];
    stage.append(s);
    const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 110, size = .5 + Math.random();
    s.animate([{ transform: `translate(0,0) scale(${size})`, opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(0)`, opacity: 0 }],
      { duration: 900 + Math.random() * 600, easing: 'cubic-bezier(.1,.8,.3,1)' }).finished.then(() => s.remove());
  }
}
async function openPack() {
  if (state !== 'idle' || !S.me.daily.freePackAvailable) return;
  state = 'opening';
  mainBtn.hidden = true;
  hint.hidden = true;
  let r;
  try { r = await api('POST', '/api/packs/free'); } catch (e) {
    state = 'idle';
    pack.style.setProperty('--tear', 0);
    showError(e);
    await loadMe();
    return;
  }
  S.me.daily.freePackAvailable = false;
  const d = full(r.sticker), rar = d.rarity, fast = reduce;
  pack.style.setProperty('--tear', 1);
  stage.dataset.r = rar;
  await anim(packTop, [{ transform: 'none', opacity: 1 }, { transform: 'translate(60px,-90px) rotate(38deg)', opacity: 0 }], { duration: fast ? 1 : 450 });
  if (!fast && (rar === 'srare' || rar === 'secret')) {
    await Promise.all([
      pack.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px) rotate(-2deg)' }, { transform: 'translateX(5px) rotate(2deg)' }, { transform: 'translateX(0)' }],
        { duration: 120, iterations: rar === 'secret' ? 7 : 4 }).finished,
      anim(glow, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1.2)' }], { duration: rar === 'secret' ? 840 : 480 })
    ]);
    const f = document.createElement('div');
    f.className = 'flash';
    document.body.append(f);
    f.animate([{ opacity: 0 }, { opacity: rar === 'secret' ? .95 : .6 }, { opacity: 0 }], { duration: 600 }).finished.then(() => f.remove());
    await wait(180);
  } else if (!fast) {
    await anim(glow, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: rar === 'normal' ? .5 : .9, transform: 'scale(1)' }], { duration: 350 });
  }
  revealed = makeSticker(d);
  slot.append(revealed);
  const colors = { normal: ['#fff', '#ffd6ea'], rare: ['#fff', '#8fd0ff', '#c8e8ff'], srare: ['#fff', '#ff8fd0', '#ffe38a'], secret: ['#fff', '#ffd766', '#ffb3d9', '#8dffc6'] }[rar];
  if (rar !== 'normal') stage.classList.add('lit');
  if (!fast) burst({ normal: 10, rare: 22, srare: 34, secret: 60 }[rar], colors);
  await Promise.all([
    anim(pack, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(140px)', opacity: 0 }], { duration: fast ? 1 : 500 }),
    anim(revealed, [{ transform: 'translateY(70px) scale(.5)', opacity: 0 }, { transform: 'translateY(-8px) scale(1.08)', opacity: 1, offset: .7 }, { transform: 'none', opacity: 1 }], { duration: fast ? 1 : 750 })
  ]);
  $('rName').textContent = d.name;
  $('rChip').className = `chip ${RARITY[rar].cls}`;
  $('rChip').textContent = RARITY[rar].label;
  $('rSerial').textContent = fmt(d);
  $('rLeft').textContent = `世界に${d.of.toLocaleString()}枚・残り${r.left.toLocaleString()}枚` + (r.pity ? '・天井で確定！' : '');
  result.hidden = false;
  mainBtn.textContent = 'シール帳に貼って見にいく';
  mainBtn.hidden = false;
  state = 'revealed';
  S.newIds.add(r.sticker.id);
  loadStickers();
  loadMe();
}
function resetStage() {
  revealed?.remove();
  revealed = null;
  result.hidden = true;
  stage.classList.remove('lit');
  stage.removeAttribute('data-r');
  glow.getAnimations().forEach(a => a.cancel());
  [pack, packTop].forEach(el => el.getAnimations().forEach(a => a.cancel()));
  pack.style.setProperty('--tear', 0);
  mainBtn.textContent = 'タップで開ける';
  state = 'idle';
  renderDaily();
}
mainBtn.addEventListener('click', () => {
  if (state === 'idle') openPack();
  else if (state === 'revealed') { resetStage(); go('book'); }
});
$('freeBtn').addEventListener('click', () => { if (state === 'revealed') resetStage(); openPack(); });

// ---------- シール帳 ----------
const book = $('book');
let justReordered = false;
function renderBook() {
  book.innerHTML = '';
  $('bookCount').textContent = `${S.stickers.length}まい`;
  S.stickers.forEach(s => {
    const d = full(s);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.s = s;
    cell.setAttribute('aria-label', `${d.name}（${RARITY[d.rarity].label}）を大きく見る`);
    cell.append(makeSticker(d));
    cell.insertAdjacentHTML('beforeend', `<span class="name">${d.name}</span>${chipHTML(d.rarity)}<span class="serial">${fmt(d)}</span>` +
      (S.newIds.has(s.id) ? '<span class="new">NEW</span>' : ''));
    cell.addEventListener('click', () => { if (!justReordered && !movedSinceDown) openDetail(s); });
    book.append(cell);
  });
}

// 長押しで並べ替え
let lift = null, movedSinceDown = false, downAt = null;
addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; movedSinceDown = false; });
addEventListener('pointermove', e => { if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) movedSinceDown = true; });
book.addEventListener('pointerdown', e => {
  const cell = e.target.closest('.cell');
  justReordered = false;
  if (!cell || !e.target.closest('.st')) return;
  lift = { cell, active: false, x: e.clientX, y: e.clientY, timer: setTimeout(() => startLift(cell, e.pointerId), 380) };
});
function startLift(cell, pointerId) {
  if (!lift || lift.cell !== cell) return;
  lift.active = true;
  justReordered = true;
  try { book.setPointerCapture(pointerId); } catch {}
  cell.classList.add('placeholder');
  const ghost = makeSticker(full(cell.s));
  ghost.classList.add('reorder-ghost');
  ghost.style.left = lift.x + 'px';
  ghost.style.top = lift.y + 'px';
  document.body.append(ghost);
  lift.ghost = ghost;
  if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
}
book.addEventListener('pointermove', e => {
  if (!lift) return;
  if (!lift.active) {
    if (Math.hypot(e.clientX - lift.x, e.clientY - lift.y) > 8) { clearTimeout(lift.timer); lift = null; }
    return;
  }
  lift.ghost.style.left = e.clientX + 'px';
  lift.ghost.style.top = e.clientY + 'px';
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const target = over?.closest?.('#book .cell');
  if (!target || target === lift.cell) return;
  const cells = [...book.children];
  if (cells.indexOf(target) > cells.indexOf(lift.cell)) book.insertBefore(lift.cell, target.nextSibling);
  else book.insertBefore(lift.cell, target);
});
async function saveOrder(movedCell) {
  const ids = [...book.children].map(c => c.s.id);
  S.stickers = ids.map(id => S.stickers.find(s => s.id === id));
  reactAround(movedCell);
  try { await api('POST', '/api/stickers/order', { ids }); } catch (e) { showError(e); await loadStickers(); renderBook(); }
}
function endLift() {
  if (!lift) return;
  clearTimeout(lift.timer);
  if (lift.active) {
    lift.ghost.remove();
    lift.cell.classList.remove('placeholder');
    saveOrder(lift.cell);
  }
  lift = null;
}
book.addEventListener('pointerup', endLift);
book.addEventListener('pointercancel', endLift);

// シールの拡大
const dlg = $('dlg');
let openS = null;
function openDetail(s) {
  openS = s;
  const d = full(s);
  const holder = $('dSticker');
  holder.innerHTML = '';
  holder.append(makeSticker(d));
  $('dName').textContent = d.name;
  $('dChip').className = `chip ${RARITY[d.rarity].cls}`;
  $('dChip').textContent = RARITY[d.rarity].label;
  $('dSerial').textContent = fmt(d);
  $('dRate').innerHTML = Array.from({ length: 5 }, (_, k) => `<i class="${k < d.rate ? 'on' : ''}"></i>`).join('');
  $('dNote').textContent = (d.rank ? `番付は${d.rank}。` : '') + (d.reward
    ? 'ログインスタンプのごほうび。パックからは出ないよ。'
    : `このシールは世界に${d.of.toLocaleString()}枚だけ。あなたのは${s.no}番目です。`);
  dlg.showModal();
}
function move(delta) {
  if (!openS) return;
  const cells = [...book.children];
  const cell = cells.find(c => c.s.id === openS.id);
  const i = cells.indexOf(cell), j = i + delta;
  if (i < 0 || j < 0 || j >= cells.length) return;
  if (delta < 0) book.insertBefore(cell, cells[j]); else book.insertBefore(cell, cells[j].nextSibling);
  saveOrder(cell);
}
$('dPrev').addEventListener('click', () => move(-1));
$('dNext').addEventListener('click', () => move(1));
$('dClose').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

// となりリアクション
function tagsOf(d) {
  const t = new Set(['any']);
  if (d.art === 'rikishi') t.add(d.species === 'cat' ? 'cat' : d.species === 'dog' ? 'dog' : 'rikishi');
  if (d.yokozuna) t.add('yokozuna');
  if (['mochi', 'ichigo', 'mikan', 'jelly', 'onigiri', 'momojiri'].includes(d.code)) t.add('food');
  if (['kumo', 'mint', 'nagare', 'prism', 'himitsu', 'aurora', 'ganbari'].includes(d.code)) t.add('sky');
  if (d.rarity === 'secret') t.add('shiny');
  if (d.kind === 'jelly') t.add('jelly');
  if (d.art === 'oshiri') t.add('oshiri');
  return t;
}
const RULES = [
  ['cat', 'rikishi', ['ちょっと怖いにゃ…', 'おすもうさん、大きいにゃ…']],
  ['cat', 'dog', ['ワンコはあっち行ってにゃ', 'シャーッ！']],
  ['dog', 'cat', ['あそぼワン！', 'ネコさん、こっち向いてワン']],
  ['dog', 'rikishi', ['いっしょに四股ふむワン！', 'ごっつぁんですワン']],
  ['food', 'rikishi', ['た、食べないで…', 'ちゃんこにしないで〜']],
  ['yokozuna', 'rikishi', ['胸を貸そう', 'かかってきなさい']],
  ['rikishi', 'food', ['おいしそう…', 'ちゃんこにしたい']],
  ['rikishi', 'cat', ['ネコちゃん、怖くないよ〜', 'なでてもいい？']],
  ['rikishi', 'dog', ['よし、稽古だ！', 'いい当たりだ！']],
  ['rikishi', 'rikishi', ['どすこい！', 'はっけよい！']],
  ['oshiri', 'oshiri', ['おしりあいだね', 'ぷりぷり〜']],
  ['cat', 'cat', ['なかまだにゃ〜', 'にゃんにゃん']],
  ['dog', 'dog', ['なかまだワン！', 'わんわん！']],
  ['any', 'shiny', ['まぶしい…！', 'キラキラしてる〜']],
  ['sky', 'sky', ['いっしょに夜空だね', 'ふわふわ〜']],
  ['jelly', 'any', ['ぷるぷる']],
  ['any', 'jelly', ['ぷにぷにしてる']]
];
function neighbors(cell) {
  const r = cell.getBoundingClientRect();
  return [...book.children].filter(c => {
    if (c === cell) return false;
    const q = c.getBoundingClientRect();
    const dx = Math.abs(q.left - r.left), dy = Math.abs(q.top - r.top);
    return (dy < r.height / 2 && dx < r.width * 1.5) || (dx < r.width / 2 && dy < r.height * 1.5);
  });
}
function lineFor(cell) {
  const mine = tagsOf(full(cell.s));
  const near = neighbors(cell).map(c => tagsOf(full(c.s)));
  for (const [a, b, lines] of RULES) if (mine.has(a) && near.some(t => t.has(b))) return pick(lines);
  return null;
}
function speak(cell, text) {
  cell.querySelector('.say')?.remove();
  const b = document.createElement('span');
  b.className = 'say';
  b.setAttribute('role', 'status');
  b.textContent = text;
  cell.append(b);
  setTimeout(() => b.remove(), 2800);
}
function reactAround(cell) {
  [cell, ...neighbors(cell)].forEach((c, i) => { const l = lineFor(c); if (l) setTimeout(() => speak(c, l), i * 260); });
}
setInterval(() => {
  if (document.hidden || book.closest('.view').hidden || document.querySelector('dialog[open]') || lift) return;
  const talkers = [...book.children].map(c => [c, lineFor(c)]).filter(([, l]) => l);
  if (talkers.length) { const [c, l] = pick(talkers); speak(c, l); }
}, 5000);

// SNSシェア
const shareDlg = $('shareDlg');
let shareBlob = null;
$('shareBtn').addEventListener('click', async () => {
  if (!S.stickers.length) return toast('まだシールがないよ');
  $('shareBtn').disabled = true;
  try {
    shareBlob = await buildShareImage(S.stickers, S.me.nickname);
    $('shImg').src = URL.createObjectURL(shareBlob);
    shareDlg.showModal();
  } catch { toast('画像を作れませんでした'); }
  $('shareBtn').disabled = false;
});
$('shGo').addEventListener('click', async () => {
  const r = await shareOrSave(shareBlob, 'ぷくホロシール帳で集めたシール、見て！ #ぷくホロシール帳');
  if (r === 'saved') toast('画像を保存したよ');
});
$('shClose').addEventListener('click', () => shareDlg.close());

// ---------- 図鑑 ----------
async function loadZukan() {
  let z;
  try { z = await api('GET', '/api/zukan'); } catch (e) { return showError(e); }
  const seen = new Set(z.seen);
  const body = $('zBody');
  body.innerHTML = '';
  let got = 0;
  SERIES.forEach(([key, label]) => {
    const list = DESIGNS.filter(d => d.series === key);
    const have = list.filter(d => seen.has(d.code)).length;
    got += have;
    const group = document.createElement('div');
    group.className = 'z-group';
    group.innerHTML = `<h3><span>${label}</span><span>${have}/${list.length}</span></h3>`;
    const grid = document.createElement('div');
    grid.className = 'z-grid';
    list.forEach(d => {
      const known = seen.has(d.code);
      const cell = document.createElement('div');
      cell.className = 'z-cell';
      const st = makeSticker(d);
      if (!known) st.classList.add('unknown');
      cell.append(st);
      cell.insertAdjacentHTML('beforeend', known
        ? `<span>${d.name}</span><small>${z.counts[d.code] ? `もってる ×${z.counts[d.code]}` : 'いまは持ってない'}</small>`
        : '<span>？？？</span><small>まだ</small>');
      grid.append(cell);
    });
    group.append(grid);
    body.append(group);
  });
  const pct = Math.floor(got / DESIGNS.length * 100);
  $('zPct').textContent = `${pct}%`;
  $('zCount').textContent = `${got} / ${DESIGNS.length} 種類`;
  $('zBar').style.width = `${pct}%`;
}

// ---------- 友達 ----------
const inviteURL = () => `${location.origin}/?invite=${S.me.friendCode}`;
function renderFriends() {
  $('myCode').textContent = S.me.friendCode;
  const inc = $('incoming');
  inc.innerHTML = '';
  S.friends.incoming.forEach(r => {
    const row = document.createElement('div');
    row.className = 'inbox';
    const t = document.createElement('span');
    t.textContent = `${r.nickname}から友達申請`;
    const yes = document.createElement('button');
    yes.type = 'button'; yes.className = 'btn small'; yes.textContent = '友達になる';
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'btn ghost small'; no.textContent = 'ことわる';
    const respond = async accept => {
      try { S.friends = await api('POST', '/api/friends/respond', { requestId: r.id, accept }); await loadFriends(); renderFriends(); }
      catch (e) { showError(e); }
    };
    yes.addEventListener('click', () => respond(true));
    no.addEventListener('click', () => respond(false));
    row.append(t, yes, no);
    inc.append(row);
  });
  const ul = $('friendList');
  ul.innerHTML = '';
  if (!S.friends.friends.length) ul.innerHTML = '<li class="empty">まだ友達がいないよ。フレンドコードを交換しよう</li>';
  S.friends.friends.forEach(f => {
    const li = document.createElement('li');
    const av = document.createElement('span');
    av.className = 'avatar';
    av.textContent = [...f.nickname][0] || '?';
    const name = document.createElement('b');
    name.textContent = f.nickname;
    const tradeBtn = document.createElement('button');
    tradeBtn.type = 'button'; tradeBtn.className = 'btn small'; tradeBtn.textContent = '交換';
    tradeBtn.addEventListener('click', () => trade.open(f));
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'btn ghost small'; more.textContent = '…';
    more.setAttribute('aria-label', `${f.nickname}のメニュー`);
    more.addEventListener('click', () => openFriendMenu(f));
    li.append(av, name, tradeBtn, more);
    ul.append(li);
  });
  $('outgoing').textContent = S.friends.outgoing.length ? `申請中：${S.friends.outgoing.map(o => o.nickname).join('、')}` : '';
}
$('copyInvite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(inviteURL()); toast('招待リンクをコピーしたよ'); }
  catch { toast(inviteURL()); }
});
$('addFriendForm').addEventListener('submit', async e => {
  e.preventDefault();
  await sendRequest($('friendCode').value);
  $('friendCode').value = '';
});
async function sendRequest(code) {
  try {
    const r = await api('POST', '/api/friends/request', { friendCode: code });
    toast(r.status === 'friends' ? '友達になったよ！' : r.status === 'already' ? 'もう友達だよ' : '友達申請を送ったよ');
    await loadFriends();
  } catch (e) { showError(e); }
}

const friendDlg = $('friendDlg');
let menuFriend = null;
function openFriendMenu(f) {
  menuFriend = f;
  $('fdName').textContent = f.nickname;
  const box = $('fdReasons');
  box.innerHTML = '';
  S.meta.reportReasons.forEach(reason => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn ghost small'; b.textContent = reason;
    b.addEventListener('click', async () => {
      try { await api('POST', '/api/report', { userId: f.id, reason }); toast('通報を受け付けました。運営が確認します'); friendDlg.close(); }
      catch (e) { showError(e); }
    });
    box.append(b);
  });
  friendDlg.showModal();
}
$('fdTrade').addEventListener('click', () => { friendDlg.close(); trade.open(menuFriend); });
$('fdRemove').addEventListener('click', async () => {
  if ($('fdRemove').dataset.confirm !== '1') { $('fdRemove').dataset.confirm = '1'; $('fdRemove').textContent = 'もう一度押すと友達をやめます'; return; }
  try { await api('POST', '/api/friends/remove', { userId: menuFriend.id }); toast('友達をやめました'); friendDlg.close(); await loadFriends(); }
  catch (e) { showError(e); }
});
$('fdBlock').addEventListener('click', async () => {
  if ($('fdBlock').dataset.confirm !== '1') { $('fdBlock').dataset.confirm = '1'; $('fdBlock').textContent = 'もう一度押すとブロックします'; return; }
  try { await api('POST', '/api/block', { userId: menuFriend.id }); toast('ブロックしました。相手からは申請も交換もできません'); friendDlg.close(); await loadFriends(); }
  catch (e) { showError(e); }
});
$('fdClose').addEventListener('click', () => friendDlg.close());
friendDlg.addEventListener('close', () => {
  $('fdRemove').dataset.confirm = ''; $('fdRemove').textContent = '友達をやめる';
  $('fdBlock').dataset.confirm = ''; $('fdBlock').textContent = 'ブロックする';
});

// ---------- 設定 ----------
function renderSettings() {
  $('nickInput').value = S.me.nickname;
  $('soundBtn').textContent = feel.sound ? 'オン' : 'オフ';
}
$('nickForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { S.me = await api('POST', '/api/me/nickname', { nickname: $('nickInput').value }); $('hello').textContent = `${S.me.nickname}さん`; toast('ニックネームを変えたよ'); }
  catch (x) { showError(x); }
});
$('soundBtn').addEventListener('click', () => { setSound(!feel.sound); renderSettings(); });
$('gyroBtn').addEventListener('click', async () => {
  const ok = await enableGyro();
  $('gyroBtn').textContent = ok ? '使用中' : '使えません';
  $('gyroBtn').disabled = true;
});
$('transferBtn').addEventListener('click', async () => {
  try {
    const r = await api('POST', '/api/transfer/issue');
    const el = $('transferCode');
    el.textContent = r.code;
    el.hidden = false;
    toast('新しい端末でこのコードを入れてね（7日間有効）');
  } catch (e) { showError(e); }
});

// ご意見
$('fbForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    await api('POST', '/api/feedback', { category: $('fbCat').value, text: $('fbText').value });
    $('fbText').value = '';
    toast('送ったよ。ありがとう！');
  } catch (x) { showError(x); }
  btn.disabled = false;
});

// アカウント削除（確認のチェックを入れないと押せない）
const delDlg = $('delDlg');
$('delOpen').addEventListener('click', () => {
  $('delAgree').checked = false;
  $('delGo').disabled = true;
  $('delErr').hidden = true;
  delDlg.showModal();
});
$('delAgree').addEventListener('change', () => { $('delGo').disabled = !$('delAgree').checked; });
$('delCancel').addEventListener('click', () => delDlg.close());
$('delGo').addEventListener('click', async () => {
  $('delGo').disabled = true;
  try {
    await api('POST', '/api/me/delete');
    token.clear();
    location.replace(location.pathname);
  } catch (x) {
    $('delErr').textContent = x.message;
    $('delErr').hidden = false;
    $('delGo').disabled = false;
  }
});

// ホーム画面に追加の案内（アプリとして開いているとき・閉じたあとは出さない）
let installEvent = null;
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvent = e;
  renderA2hs();
});
function renderA2hs() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let dismissed = false;
  try { dismissed = localStorage.getItem('puku-a2hs') === 'closed'; } catch {}
  const box = $('a2hs');
  box.hidden = standalone || dismissed;
  if (box.hidden) return;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  $('a2hsInstall').hidden = !installEvent;
  $('a2hsHow').textContent = installEvent ? '' : ios
    ? 'Safari の下にある共有ボタン（□に↑）→「ホーム画面に追加」を押してね'
    : 'ブラウザのメニュー（︙）→「ホーム画面に追加」または「アプリをインストール」を押してね';
}
$('a2hsInstall').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => null);
  installEvent = null;
  renderA2hs();
});
$('a2hsClose').addEventListener('click', () => {
  try { localStorage.setItem('puku-a2hs', 'closed'); } catch {}
  $('a2hs').hidden = true;
});

// ---------- リアルタイム ----------
let trade;
function onEvent(msg) {
  if (msg.type === 'friends' || msg.type === 'resync') loadFriends().catch(() => {});
  if (msg.type === 'stickers' || msg.type === 'resync') loadStickers().catch(() => {});
  if (msg.type === 'trade') { trade.onEvent(msg.id); loadFriends().catch(() => {}); }
}

// ---------- 起動 ----------
let started = false;
async function boot() {
  if (!token.get()) return showOnboard();
  try { await loadMe(); } catch (e) {
    if (e.status === 401) { token.clear(); return showOnboard(); }
    throw e;
  }
  $('onboard').hidden = true;
  $('appRoot').hidden = false;
  await Promise.all([loadStickers(), loadFriends()]);
  if (!started) {
    started = true;
    trade = initTrade({ S, full, fmt, toast, showError, loadStickers, goto: go });
    connectEvents(onEvent);
  }
  checkIn().catch(() => {});
  $('fbCat').innerHTML = (S.meta.feedbackCategories || ['そのほか']).map(c => `<option>${c}</option>`).join('');
  renderA2hs();
  const invite = new URLSearchParams(location.search).get('invite');
  if (invite) {
    try { history.replaceState(null, '', location.pathname); } catch {}
    if (invite !== S.me.friendCode) await sendRequest(invite);
  }
  go((location.hash || '#home').slice(1).replace(/[^a-z]/g, '') || 'home');
}

initGlitter();
startFeel();
api('GET', '/api/meta').then(m => { S.meta = m; }).catch(() => {}).finally(() => boot().catch(showError));
