// シールの見た目（形・絵・重ね方）と、触ったときの動き（傾き・押し込み・音）

export const SHAPES = {
  heart: '<path d="M50 90C19 67 5 51 5 32 5 17 17 7 30 7c9 0 16 5 20 12 4-7 11-12 20-12 13 0 25 10 25 25 0 19-14 35-45 58Z"/>',
  star: '<path d="M50 4c3 0 4 2 5 4l9 20 22 3c5 1 7 6 3 9L73 56l4 22c1 5-4 8-8 6L50 73 31 84c-4 2-9-1-8-6l4-22L11 40c-4-3-2-8 3-9l22-3 9-20c1-2 2-4 5-4Z"/>',
  circle: '<circle cx="50" cy="50" r="46"/>',
  cloud: '<path d="M26 80C11 80 4 67 10 56 3 43 15 29 29 34c4-17 29-21 37-5 14-8 31 3 26 19 10 7 6 32-12 32Z"/>',
  // 力士：まげ・頭・まんまるのおなか・足
  rikishi: '<path d="M38 13c4-10 20-10 24 0l-4 6H42Z"/><circle cx="50" cy="32" r="19"/><ellipse cx="50" cy="65" rx="37" ry="29"/><ellipse cx="32" cy="92" rx="10" ry="6"/><ellipse cx="68" cy="92" rx="10" ry="6"/>',
  // 力士ニャンコ：三角耳としっぽ
  rikishiCat: '<path d="M33 22 30 4 45 14Z"/><path d="M67 22 70 4 55 14Z"/><path d="M38 13c4-10 20-10 24 0l-4 6H42Z"/><circle cx="50" cy="32" r="19"/><ellipse cx="50" cy="65" rx="37" ry="29"/><ellipse cx="32" cy="92" rx="10" ry="6"/><ellipse cx="68" cy="92" rx="10" ry="6"/><path d="M84 74q13-2 9-17" stroke="#000" stroke-width="7" fill="none" stroke-linecap="round"/>',
  // 力士ワンコ：たれ耳と巻きしっぽ
  rikishiDog: '<path d="M38 13c4-10 20-10 24 0l-4 6H42Z"/><circle cx="50" cy="32" r="19"/><ellipse cx="30" cy="31" rx="6.5" ry="11" transform="rotate(22 30 31)"/><ellipse cx="70" cy="31" rx="6.5" ry="11" transform="rotate(-22 70 31)"/><ellipse cx="50" cy="65" rx="37" ry="29"/><ellipse cx="32" cy="92" rx="10" ry="6"/><ellipse cx="68" cy="92" rx="10" ry="6"/><path d="M85 66q11-6 6-15q-6 2-3 8" stroke="#000" stroke-width="6" fill="none" stroke-linecap="round"/>',
  bear: '<circle cx="50" cy="56" r="36"/><circle cx="22" cy="24" r="14"/><circle cx="78" cy="24" r="14"/>',
  ribbon: '<path d="M50 44C38 28 14 18 10 34c-4 16 6 34 22 30 8-2 14-8 18-14 4 6 10 12 18 14 16 4 26-14 22-30C86 18 62 28 50 44Z"/><circle cx="50" cy="48" r="10"/><path d="M44 54 34 88l12-6 4 10 4-10 12 6-10-34Z"/>',
  onigiri: '<path d="M50 8c8 0 14 6 20 16l20 38c8 16-2 30-20 30H30C12 92 2 78 10 62l20-38C36 14 42 8 50 8Z"/>',
  clover: '<circle cx="50" cy="28" r="17"/><circle cx="28" cy="50" r="17"/><circle cx="72" cy="50" r="17"/><circle cx="50" cy="70" r="17"/><path d="M54 82q5 8 14 11" stroke="#000" stroke-width="6" fill="none" stroke-linecap="round"/>',
  // おしり：まんまるのほっぺ2つ＋しっぽや葉っぱ
  oshiriDog: '<ellipse cx="33" cy="60" rx="27" ry="29"/><ellipse cx="67" cy="60" rx="27" ry="29"/><path d="M50 34q-12-18 3-26q16 3 5 17" stroke="#000" stroke-width="10" fill="none" stroke-linecap="round"/>',
  oshiriCat: '<ellipse cx="33" cy="60" rx="27" ry="29"/><ellipse cx="67" cy="60" rx="27" ry="29"/><path d="M52 36q-3-20 12-28" stroke="#000" stroke-width="9" fill="none" stroke-linecap="round"/>',
  momo: '<ellipse cx="34" cy="60" rx="28" ry="30"/><ellipse cx="66" cy="60" rx="28" ry="30"/><path d="M50 34q-2-16 13-24q11 9-4 23Z"/>'
};
export const maskURI = shape =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>${SHAPES[shape]}</svg>`)}")`;

// ラメの粒テクスチャをその場で生成
export function initGlitter() {
  const c = document.createElement('canvas');
  c.width = c.height = 140;
  const g = c.getContext('2d');
  const colors = ['#ffffff', '#fff3b0', '#ffc2e2', '#bdf3ff', '#e2ccff'];
  for (let i = 0; i < 260; i++) {
    g.fillStyle = colors[i % colors.length];
    g.globalAlpha = .5 + Math.random() * .5;
    const x = Math.random() * 140, y = Math.random() * 140, r = .5 + Math.random() * 1.3;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    if (i % 23 === 0) { // ときどき十字の光
      g.fillRect(x - 5, y - .5, 10, 1);
      g.fillRect(x - .5, y - 5, 1, 10);
    }
  }
  document.documentElement.style.setProperty('--glitter', `url(${c.toDataURL()})`);
}

// 力士の絵（顔・まげ・まわし）。横綱は綱と紙垂つき。species で人・ネコ・イヌを描き分ける
export function rikishiArt(s) {
  const ink = '#3a2530', mw = s.mw, skin = '#d9876c';
  const cat = s.species === 'cat', dog = s.species === 'dog';
  const head = cat ? `
    <path d="M34.5 18 32.5 8.5 41 14.5ZM65.5 18 67.5 8.5 59 14.5Z" fill="#ff9fb8" opacity=".8"/>
    ${s.pattern === 'tabby' ? `<path d="M40 20l2 4M60 20l-2 4M31 30h4M65 30h4M32 33.5h3M65 33.5h3" stroke="${s.fur}" stroke-width="2" stroke-linecap="round"/>` : ''}
    ${s.pattern === 'calico' ? `<path d="M31 22q5-9 14-5q-2 8-12 10Z" fill="#f2a54a"/><path d="M57 17q10-3 12 8q-6 3-12-2Z" fill="#3a3338"/><ellipse cx="72" cy="57" rx="7" ry="5" fill="#f2a54a"/><ellipse cx="29" cy="70" rx="5" ry="4" fill="#3a3338"/>` : ''}`
    : dog ? `
    <ellipse cx="30" cy="31" rx="6.5" ry="11" transform="rotate(22 30 31)" fill="${s.fur}"/>
    <ellipse cx="70" cy="31" rx="6.5" ry="11" transform="rotate(-22 70 31)" fill="${s.fur}"/>
    <ellipse cx="50" cy="40" rx="10" ry="6.5" fill="${s.muzzle}"/>
    ${s.pattern === 'shiba' ? `<ellipse cx="39" cy="40" rx="6" ry="4.5" fill="${s.muzzle}"/><ellipse cx="61" cy="40" rx="6" ry="4.5" fill="${s.muzzle}"/><circle cx="42" cy="28.5" r="1.8" fill="${s.muzzle}"/><circle cx="58" cy="28.5" r="1.8" fill="${s.muzzle}"/>` : ''}`
    : `<path d="M31 31a19 19 0 0 1 38 0c-6-5-12-7-19-7s-13 2-19 7Z" fill="${ink}"/>`;
  const snout = cat
    ? `<path d="M48.5 37.3h3l-1.5 1.9Z" fill="#ff7f9e"/><path d="M27 36.5h7M27 40.5l7-1M73 36.5h-7M73 40.5l-7-1" stroke="${ink}" stroke-width="1" opacity=".55" stroke-linecap="round"/>`
    : dog ? `<ellipse cx="50" cy="37.4" rx="2.7" ry="2" fill="${ink}"/><path d="M48.8 42.6q1.2 2.8 2.4 0Z" fill="#ff7f9e"/>` : '';
  const belly = cat || dog
    ? `<ellipse cx="50" cy="60" rx="17" ry="11" fill="${s.muzzle || '#fff6ea'}" opacity=".85"/>`
    : `<ellipse cx="50" cy="61" rx="1.6" ry="2.3" fill="${skin}" opacity=".75"/>`;
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    ${head}
    ${s.yokozuna
      ? `<path d="M38 13c4-10 20-10 24 0l-4 6H42Z" fill="${ink}"/>`
      : `<ellipse cx="50" cy="13" rx="7" ry="5" fill="${ink}"/>`}
    <rect x="46.5" y="16" width="7" height="6" rx="2.5" fill="${ink}"/>
    ${s.heart
      ? `<path d="M39.5 33c0-1.8 2.6-2.5 3.3-.7.7-1.8 3.3-1.1 3.3.7 0 2-3.3 3.9-3.3 3.9s-3.3-1.9-3.3-3.9Z" fill="#ff4f86"/><path d="M54 33c0-1.8 2.6-2.5 3.3-.7.7-1.8 3.3-1.1 3.3.7 0 2-3.3 3.9-3.3 3.9s-3.3-1.9-3.3-3.9Z" fill="#ff4f86"/>`
      : `<path d="M39 34q3.5-3.5 7 0M54 34q3.5-3.5 7 0" stroke="${ink}" stroke-width="2.3" fill="none" stroke-linecap="round"/>`}
    <ellipse cx="37" cy="39.5" rx="4.2" ry="2.4" fill="#ff6f96" opacity=".5"/>
    <ellipse cx="63" cy="39.5" rx="4.2" ry="2.4" fill="#ff6f96" opacity=".5"/>
    ${snout}
    <path d="M46.5 41q1.75 2 3.5 0q1.75 2 3.5 0" stroke="${ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M21 56q-4 9 1 17M79 56q4 9-1 17" stroke="${cat || dog ? ink : skin}" stroke-width="1.6" fill="none" opacity="${cat || dog ? '.2' : '.5'}" stroke-linecap="round"/>
    ${belly}
    <path d="M14 71q36 13 72 0l-1.5 10q-34.5 12-69 0Z" fill="${mw}"/>
    <path d="M44 80h12l-1.5 13h-9Z" fill="${mw}"/>
    <path d="M37.5 82v9M41 83v10M59 83v10M62.5 82v9" stroke="${mw}" stroke-width="1.7" stroke-linecap="round" opacity=".85"/>
    ${s.yokozuna ? `<path d="M16 66q34 12 68 0" stroke="#fffdf4" stroke-width="5.5" fill="none" stroke-linecap="round"/>
    <path d="M16 66q34 12 68 0" stroke="#e8dcc0" stroke-width="5.5" fill="none" stroke-dasharray="2 3" opacity=".6"/>
    <path d="M39 72.5l-2.5 4 3 1.2-2.5 4.3M61 72.5l2.5 4-3 1.2 2.5 4.3" stroke="#fff" stroke-width="2" fill="none" stroke-linejoin="round"/>` : ''}
  </svg>`;
}

// おしり：割れ目・ほっぺの赤み・しっぽや葉っぱ
function oshiriArt(s) {
  const crease = `<path d="M50 38q-3.5 20 0 44" stroke="rgba(120,50,40,.32)" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  const blush = `<ellipse cx="28" cy="70" rx="7" ry="4" fill="#ff7fa0" opacity=".42"/><ellipse cx="72" cy="70" rx="7" ry="4" fill="#ff7fa0" opacity=".42"/>`;
  const extra = s.shape === 'oshiriDog'
    ? `<ellipse cx="50" cy="84" rx="17" ry="8" fill="#fff4e2"/><path d="M50 34q-12-18 3-26q16 3 5 17" stroke="#fff4e2" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
    : s.shape === 'oshiriCat'
      ? `<path d="M53 30l6-2M55 22l6-3M59 15l5-4" stroke="${s.fur}" stroke-width="2.4" stroke-linecap="round"/><path d="M9 55l6 2M8 63l6 1M91 55l-6 2M92 63l-6 1" stroke="${s.fur}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
      : `<path d="M50 34q-2-16 13-24q11 9-4 23Z" fill="#7cc576"/><path d="M52 31q3-10 10-17" stroke="#4f9a4b" stroke-width="1.4" fill="none"/>`;
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${extra}${crease}${blush}</svg>`;
}
// シンプル：線と面だけのフラットな絵
function simpleArt(s) {
  const ink = '#3a2530';
  if (s.shape === 'onigiri') return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <path d="M33 64h34v28H33Z" fill="#26332a"/><circle cx="42" cy="47" r="2.4" fill="${ink}"/><circle cx="58" cy="47" r="2.4" fill="${ink}"/>
    <path d="M46.5 53q3.5 3 7 0" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <ellipse cx="36" cy="53" rx="4" ry="2.3" fill="#ff8fa8" opacity=".5"/><ellipse cx="64" cy="53" rx="4" ry="2.3" fill="#ff8fa8" opacity=".5"/></svg>`;
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <path d="M50 16v24M50 60v24M16 50h24M60 50h24" stroke="rgba(255,255,255,.55)" stroke-width="2.2" stroke-linecap="round"/></svg>`;
}
export const artFor = s => s.art === 'rikishi' ? rikishiArt(s) : s.art === 'oshiri' ? oshiriArt(s) : s.art === 'simple' ? simpleArt(s) : '';

export function makeSticker(s) {
  const el = document.createElement('div');
  el.className = `st ${s.kind}`;
  el.style.setProperty('--mask', maskURI(s.shape));
  el.style.setProperty('--base', s.base);
  if (s.base2) el.style.setProperty('--base2', s.base2);
  if (s.tint) el.style.setProperty('--tint', s.tint);
  el.seed = Math.random() * 6;
  el.innerHTML = `<div class="tilt"><div class="edge"></div><div class="face">
    <i class="base"></i><i class="lentB"></i><i class="aur"></i><i class="rainbow"></i><i class="pr"></i><i class="foil"></i><i class="mt"></i><i class="g1"></i><i class="g2"></i>
    ${s.art ? `<i class="art">${artFor(s)}</i>` : ''}
    ${s.art === 'rikishi' && s.kind === 'lenti' ? `<i class="art art2">${rikishiArt({ ...s, mw: s.mw2 || s.mw, heart: true })}</i>` : ''}
    <i class="ridge"></i><i class="gel"></i><i class="rim"></i><i class="glare"></i><i class="gloss"></i><i class="dot"></i>
    ${s.kao ? '<i class="kao"><em></em><b></b><em></em></i>' : ''}
    <i class="dropfx"></i><i class="press"></i>
  </div></div>`;
  return el;
}
