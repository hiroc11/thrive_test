// 触ったときの動き：指が乗っているシールだけ傾く／押すとつぶれてへこむ／離すとぷるんと戻って波紋／素材ごとの音と振動
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = v => Math.max(-1, Math.min(1, v));

export const feel = {
  sound: true,
  gyro: null
};
try { feel.sound = localStorage.getItem('puku-sound') !== 'off'; } catch {}
export function setSound(on) {
  feel.sound = on;
  try { localStorage.setItem('puku-sound', on ? 'on' : 'off'); } catch {}
}

let audio = null;
function tone(type, freq, to, dur, gain, at = 0) {
  const t = audio.currentTime + at;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + .008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + dur + .02);
}
const kindOf = el => {
  const c = el.classList;
  return c.contains('oshiri') ? 'puri' : c.contains('drop') ? 'koron' : c.contains('flat') ? 'kasa' : c.contains('metal') ? 'kin'
    : c.contains('puffy') || c.contains('jelly') ? 'puni' : 'shara';
};
function playFeel(kind) {
  if (!feel.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    if (kind === 'puni') tone('sine', 520, 240, .09, .06);
    else if (kind === 'puri') { tone('sine', 240, 520, .08, .06); tone('sine', 520, 300, .08, .05, .07); }
    else if (kind === 'koron') { tone('sine', 1320, 0, .18, .045); tone('sine', 1980, 0, .14, .025, .04); }
    else if (kind === 'kin') tone('triangle', 2400, 0, .28, .035);
    else if (kind === 'kasa') tone('square', 900, 500, .025, .015);
    else { tone('sine', 2100, 0, .12, .02); tone('sine', 2800, 0, .1, .015, .05); }
  } catch {}
}

export async function enableGyro() {
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return false; } catch { return false; }
  }
  addEventListener('deviceorientation', e => {
    if (e.gamma == null) return;
    feel.gyro = { x: e.gamma / 25, y: (e.beta - 40) / 25 };
  });
  return true;
}

export function startFeel() {
  let px = null, py = null, lastInput = -1e9, activeEl = null, pressedEl = null, counter = 0;
  const stickerAt = e => (e.target instanceof Element ? e.target.closest('.st, .pack') : null);

  addEventListener('pointermove', e => {
    px = e.clientX; py = e.clientY; lastInput = performance.now();
    if (e.pointerType === 'mouse') activeEl = stickerAt(e);
  });
  addEventListener('pointerdown', e => {
    px = e.clientX; py = e.clientY; lastInput = performance.now();
    activeEl = stickerAt(e);
    const st = e.target instanceof Element ? e.target.closest('.st:not(.unknown)') : null;
    if (st) {
      pressedEl = st;
      st.pressed = true;
      playFeel(kindOf(st));
      if (navigator.vibrate) try { navigator.vibrate(kindOf(st) === 'kin' ? 4 : 8); } catch {}
    }
  });
  const release = e => {
    if (e.pointerType !== 'mouse') activeEl = null;
    const el = pressedEl;
    if (!el) return;
    pressedEl = null;
    el.pressed = false;
    if (reduce || !el.isConnected) return;
    const k = parseFloat(getComputedStyle(el).getPropertyValue('--soft')) || .5;
    el.animate([
      { transform: `scale(${1 + .06 * k}, ${1 - .08 * k})` },
      { transform: `scale(${1 - .05 * k}, ${1 + .06 * k})` },
      { transform: `scale(${1 + .025 * k}, ${1 - .03 * k})` },
      { transform: 'none' }
    ], { duration: 300 + 220 * k, easing: 'ease-out', composite: 'add' });
    const face = el.querySelector('.face');
    if (face) {
      const r = document.createElement('i');
      r.className = 'ripple';
      r.style.left = el.style.getPropertyValue('--pxp') || '50%';
      r.style.top = el.style.getPropertyValue('--pyp') || '50%';
      face.append(r);
      r.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: .9 }, { transform: 'translate(-50%,-50%) scale(3.4)', opacity: 0 }],
        { duration: 520, easing: 'ease-out' }).finished.then(() => r.remove());
    }
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);

  function frame(now) {
    const idle = now - lastInput > 2500;
    const t = now / 1000;
    for (const el of document.querySelectorAll('.st:not(.unknown), .pack')) {
      if (el.idx == null) el.idx = counter++;
      if (el.seed == null) el.seed = Math.random() * 6;
      let tx = 0, ty = 0;
      if (feel.gyro) { tx = clamp(feel.gyro.x); ty = clamp(feel.gyro.y); }
      else if (el === activeEl && px != null) {
        const r = el.getBoundingClientRect();
        tx = clamp((px - (r.left + r.width / 2)) / (r.width * .9));
        ty = clamp((py - (r.top + r.height / 2)) / (r.height * .9));
      } else if (idle && !reduce) {
        tx = .6 * Math.sin(t * .9 + el.idx * .7);
        ty = .45 * Math.sin(t * .7 + el.idx * 1.3);
      }
      el.cx = (el.cx || 0) + (tx - (el.cx || 0)) * .14;
      el.cy = (el.cy || 0) + (ty - (el.cy || 0)) * .14;
      const x = el.cx, y = el.cy;
      el.style.setProperty('--tx', x.toFixed(3));
      el.style.setProperty('--ty', y.toFixed(3));
      el.style.setProperty('--mag', Math.min(1, Math.hypot(x, y)).toFixed(3));
      el.style.setProperty('--sp1', (.2 + .8 * Math.max(0, Math.sin(x * 4 + y * 3 + el.seed))).toFixed(3));
      el.style.setProperty('--sp2', (.2 + .8 * Math.max(0, Math.sin(-x * 3 + y * 4 + el.seed + 2))).toFixed(3));
      const target = el.pressed ? 1 : 0;
      if (target || el.pr) {
        el.pr = (el.pr || 0) + (target - (el.pr || 0)) * (target ? .45 : .3);
        if (el.pr < .01 && !target) el.pr = 0;
        el.style.setProperty('--press', el.pr.toFixed(3));
        if (el.pressed && px != null) {
          const r = el.querySelector('.face')?.getBoundingClientRect() || el.getBoundingClientRect();
          el.style.setProperty('--pxp', `${Math.max(0, Math.min(100, (px - r.left) / r.width * 100)).toFixed(1)}%`);
          el.style.setProperty('--pyp', `${Math.max(0, Math.min(100, (py - r.top) / r.height * 100)).toFixed(1)}%`);
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
