// 交換テーブル。中身はすべてサーバーが持っていて、変わるとリアルタイムで両方に届く
import { api } from './api.js';
import { makeSticker } from './stickers.js';
import { RARITY } from './catalog.js';

const $ = id => document.getElementById(id);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));

export function initTrade({ S, full, fmt, toast, showError, loadStickers, goto }) {
  const dlg = $('trade');
  const theirHand = $('theirHand'), theirZone = $('theirZone'), myHand = $('myHand'), myZone = $('myZone'), hold = $('tHold');
  let view = null, friend = null, theirStickers = [], busy = false, lastStampAt = null, finishing = false;

  // ---------- 表示 ----------
  function item(s, owner) {
    const d = full(s);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item';
    b.s = s;
    b.owner = owner;
    b.setAttribute('aria-label', `${d.name} ${fmt(d)}（${RARITY[d.rarity].label}）`);
    b.append(makeSticker(d));
    b.insertAdjacentHTML('beforeend', `<span class="serial">No.${s.no}</span>`);
    return b;
  }
  const tag = (b, text) => b.insertAdjacentHTML('beforeend', `<span class="ask">${text}</span>`);
  const clearZone = z => z.querySelectorAll('.item').forEach(x => x.remove());
  const say = (el, text) => {
    el.textContent = text;
    el.hidden = false;
    clearTimeout(el.t);
    el.t = setTimeout(() => { el.hidden = true; }, 2600);
  };
  function status(text, ok) {
    const el = $('tStatus');
    el.textContent = text;
    el.className = ok ? 'ok' : '';
  }

  function render() {
    if (!view) return;
    const blind = view.mode === 'blind';
    $('tName').textContent = friend.nickname;
    $('tAv').textContent = [...friend.nickname][0] || '?';
    $('tScaleName').textContent = friend.nickname;
    dlg.querySelectorAll('.mode').forEach(m => m.setAttribute('aria-pressed', String(m.dataset.mode === view.mode)));
    $('theirLabel').textContent = blind ? `${friend.nickname}がふせた1枚` : `${friend.nickname}が出す`;
    $('myLabel').textContent = blind ? 'あなたがふせる1枚（ドラッグかタップ）' : 'あなたが出す（ドラッグかタップで置く）';
    $('tScale').hidden = blind;

    const myOffer = new Set(view.me.offer.map(s => s.id));
    const theirOffer = new Set(view.them.offer.map(s => s.id));
    myHand.innerHTML = '';
    S.stickers.filter(s => !myOffer.has(s.id)).forEach(s => {
      const b = item(s, 'me');
      if (view.them.ask.includes(s.id)) tag(b, 'ほしいって');
      myHand.append(b);
    });
    clearZone(myZone);
    view.me.offer.forEach(s => myZone.append(item(s, 'me')));

    theirHand.innerHTML = '';
    theirStickers.filter(s => !theirOffer.has(s.id)).forEach(s => {
      const b = item(s, 'them');
      if (view.me.ask.includes(s.id)) tag(b, 'おねだり中');
      theirHand.append(b);
    });
    clearZone(theirZone);
    if (blind) {
      if (view.them.placed) {
        const stub = document.createElement('div');
        stub.className = 'item down stub-item';
        stub.innerHTML = '<span class="stub"></span>';
        theirZone.append(stub);
      }
    } else view.them.offer.forEach(s => theirZone.append(item(s, 'them')));

    const rate = list => list.reduce((v, s) => v + full(s).rate, 0);
    $('tBeam').style.transform = `rotate(${Math.max(-20, Math.min(20, (rate(view.me.offer) - rate(view.them.offer)) * 7))}deg)`;

    const st = view.them.stamp;
    if (st && st.at !== lastStampAt) {
      if (lastStampAt !== null) say($('tBubble'), st.text);
      lastStampAt = st.at;
    } else if (lastStampAt === null) lastStampAt = st ? st.at : 0;

    if (blind) {
      const both = view.me.offer.length === 1 && view.them.placed === 1;
      status(view.them.ready ? `${friend.nickname}はせーの済み！` : view.me.ready ? `${friend.nickname}のせーの待ち`
        : both ? 'そろった！ せーのでめくろう' : view.them.placed ? `${friend.nickname}は1枚ふせたよ` : '1枚ふせてね', both);
    } else {
      status(view.them.ready ? `${friend.nickname}はOK！ せーのして` : view.me.ready ? `${friend.nickname}のせーの待ち` : 'かけひき中', view.them.ready);
    }
  }

  async function refresh() {
    if (!view) return;
    try { view = await api('GET', `/api/trades/${view.id}`); } catch (e) { return showError(e); }
    await afterView();
  }
  async function afterView() {
    if (view.status === 'done') return finish();
    if (view.status === 'cancelled') {
      toast(`${friend.nickname}との交換は終わりました`);
      view = null;
      dlg.close();
      return;
    }
    render();
  }

  async function open(f) {
    friend = f;
    finishing = false;
    lastStampAt = null;
    $('tMain').hidden = false;
    $('tDone').hidden = true;
    try {
      [view, theirStickers] = await Promise.all([
        api('POST', '/api/trades', { friendId: f.id, mode: 'normal' }),
        api('GET', `/api/friends/${f.id}/stickers`)
      ]);
    } catch (e) { return showError(e); }
    if (!dlg.open) dlg.showModal();
    afterView();
  }

  async function send(path, body) {
    busy = true;
    try { view = await api('POST', `/api/trades/${view.id}/${path}`, body); await afterView(); }
    catch (e) { showError(e); await refresh(); }
    finally { busy = false; }
  }

  // ---------- 操作 ----------
  const offerIds = () => view.me.offer.map(s => s.id);
  function place(b) {
    if (view.mode === 'blind') return send('offer', { ids: [b.s.id] });
    if (offerIds().length >= 6) return toast('出せるのは6枚までだよ');
    send('offer', { ids: [...offerIds(), b.s.id] });
  }
  const takeBack = b => send('offer', { ids: offerIds().filter(id => id !== b.s.id) });
  function askFor(b) {
    if (view.mode === 'blind') return toast('ふせて交換ではおねだりできないよ');
    if (b.parentElement !== theirHand) return;
    const ids = view.me.ask.includes(b.s.id) ? view.me.ask.filter(id => id !== b.s.id) : [...view.me.ask, b.s.id];
    send('ask', { ids });
  }

  // ドラッグとタップ
  let drag = null;
  dlg.addEventListener('pointerdown', e => {
    const b = e.target.closest('.item');
    if (!b || busy || !view || b.classList.contains('down')) return;
    drag = { b, x: e.clientX, y: e.clientY, ghost: null };
  });
  dlg.addEventListener('pointermove', e => {
    if (!drag || drag.b.owner !== 'me') return;
    if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
      drag.ghost = makeSticker(full(drag.b.s));
      drag.ghost.classList.add('drag-ghost');
      dlg.append(drag.ghost);
      drag.b.classList.add('lifted');
    }
    if (drag.ghost) {
      drag.ghost.style.left = e.clientX + 'px';
      drag.ghost.style.top = e.clientY + 'px';
      const over = document.elementFromPoint(e.clientX, e.clientY);
      myZone.classList.toggle('over', !!(over && myZone.contains(over)));
    }
  });
  function endDrag(e) {
    if (!drag) return;
    const { b, ghost } = drag;
    drag = null;
    myZone.classList.remove('over');
    if (!ghost) {
      if (b.owner === 'me') (b.parentElement === myZone ? takeBack(b) : place(b)); else askFor(b);
      return;
    }
    ghost.remove();
    b.classList.remove('lifted');
    const over = e && document.elementFromPoint(e.clientX, e.clientY);
    if (over && myZone.contains(over) && b.parentElement !== myZone) place(b);
    else if (over && myHand.contains(over) && b.parentElement === myZone) takeBack(b);
  }
  dlg.addEventListener('pointerup', endDrag);
  dlg.addEventListener('pointercancel', () => endDrag(null));
  dlg.addEventListener('click', e => { // キーボード操作（Enter / Space）
    if (e.detail !== 0 || busy || !view) return;
    const b = e.target.closest('.item');
    if (!b || b.classList.contains('down')) return;
    if (b.owner === 'me') (b.parentElement === myZone ? takeBack(b) : place(b)); else askFor(b);
  });

  dlg.querySelectorAll('.mode').forEach(m => m.addEventListener('click', () => {
    if (view && !busy && m.dataset.mode !== view.mode) send('mode', { mode: m.dataset.mode });
  }));

  // スタンプ
  const stampBox = $('tStamps');
  S.meta.stamps.forEach(text => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stamp';
    b.textContent = text;
    b.addEventListener('click', () => { if (!view) return; say($('tMeBubble'), text); send('stamp', { text }); });
    stampBox.append(b);
  });

  // 長押しで「せーの」
  let start = 0, raf = 0;
  const shake = el => el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 90, iterations: 3 });
  function ready() {
    if (!view) return;
    const blind = view.mode === 'blind';
    if (blind && !(view.me.offer.length === 1 && view.them.placed === 1)) { status('1枚ずつふせてからね'); return shake(hold); }
    if (!blind && !view.me.offer.length && !view.them.offer.length) { status('まだどちらもシールを出してないよ'); return shake(hold); }
    send('ready', { version: view.version });
  }
  function tick(now) {
    const p = Math.min(1, (now - start) / 900);
    hold.style.setProperty('--p', p.toFixed(3));
    if (p < 1) { raf = requestAnimationFrame(tick); return; }
    start = 0;
    hold.style.setProperty('--p', 0);
    ready();
  }
  hold.addEventListener('pointerdown', e => {
    if (busy) return;
    hold.setPointerCapture(e.pointerId);
    start = performance.now();
    raf = requestAnimationFrame(tick);
  });
  const cancelHold = () => { if (!start) return; start = 0; cancelAnimationFrame(raf); hold.style.setProperty('--p', 0); };
  hold.addEventListener('pointerup', cancelHold);
  hold.addEventListener('pointercancel', cancelHold);
  hold.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); ready(); } });

  $('tCancel').addEventListener('click', async () => {
    if (!view) return;
    if ($('tCancel').dataset.confirm !== '1') { $('tCancel').dataset.confirm = '1'; $('tCancel').textContent = 'もう一度押すと交換をやめます'; return; }
    await send('cancel');
  });
  $('tClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => {
    view = null;
    $('tCancel').dataset.confirm = '';
    $('tCancel').textContent = 'この交換をやめる';
  });

  // ---------- 交換成立 ----------
  async function finish() {
    if (finishing) return;
    finishing = true;
    const got = view.result?.got || [];
    const gave = view.result?.gave || [];
    render();
    // ふせて交換なら、相手のカードをめくってから入れ替える
    const stub = theirZone.querySelector('.stub-item');
    if (stub && got[0]) {
      const card = item(got[0], 'them');
      card.classList.add('down');
      stub.replaceWith(card);
      await card.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(90deg)' }], { duration: reduce ? 1 : 260, fill: 'forwards' }).finished;
      card.classList.remove('down');
      await card.animate([{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0)' }], { duration: reduce ? 1 : 260, fill: 'forwards' }).finished;
      await wait(reduce ? 100 : 900);
    }
    const dist = myZone.getBoundingClientRect().top - theirZone.getBoundingClientRect().top;
    await Promise.all([
      ...[...myZone.querySelectorAll('.item')].map(b => b.animate([{ transform: 'none' }, { transform: `translateY(${-dist}px) rotate(360deg) scale(.8)`, opacity: 0 }],
        { duration: reduce ? 1 : 800, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).finished),
      ...[...theirZone.querySelectorAll('.item')].map(b => b.animate([{ transform: 'none' }, { transform: `translateY(${dist}px) rotate(-360deg) scale(1.2)`, opacity: 0 }],
        { duration: reduce ? 1 : 800, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).finished)
    ]);
    const box = $('tGot');
    box.innerHTML = '';
    got.forEach(s => box.append(makeSticker(full(s))));
    got.forEach(s => S.newIds.add(s.id));
    $('tGotText').textContent = got.length
      ? `${got.map(s => `「${full(s).name}」`).join('')}をゲット！ シール帳に貼ったよ。`
      : `${gave.map(s => `「${full(s).name}」`).join('')}をプレゼントしたよ。`;
    $('tMain').hidden = true;
    $('tDone').hidden = false;
    loadStickers();
  }
  $('tFinish').addEventListener('click', () => { dlg.close(); goto('book'); });

  return {
    open,
    onEvent(id) {
      if (view && view.id === id && !finishing) refresh();
    }
  };
}
