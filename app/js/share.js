// シール帳をSNS用の画像にする（アプリ名入り）。
// 画面のシールはCSSで光らせているので、画像用には同じ形と絵をSVGで描き直す
import { SHAPES, artFor } from './stickers.js';
import { DESIGN_OF } from './catalog.js';

const colorsOf = base => (String(base).match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) || ['#ffc2dc']).slice(0, 3);
const KAO = `<g><ellipse cx="41" cy="52" rx="4.5" ry="5.5" fill="#4a2140"/><ellipse cx="59" cy="52" rx="4.5" ry="5.5" fill="#4a2140"/>
  <path d="M43 62q7 7 14 0" stroke="#4a2140" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="30" cy="61" rx="6" ry="3.5" fill="#ff5a8c" opacity=".45"/><ellipse cx="70" cy="61" rx="6" ry="3.5" fill="#ff5a8c" opacity=".45"/></g>`;

function stickerSvg(d) {
  const [c1, c2 = c1, c3 = c2] = colorsOf(d.base);
  const shape = SHAPES[d.shape];
  const art = d.art ? artFor(d).replace('<svg ', '<svg x="0" y="0" width="100" height="100" ') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 124 124" width="360" height="360">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient>
      <clipPath id="c">${shape}</clipPath>
    </defs>
    <g fill="#fff" stroke="#fff" stroke-width="14" stroke-linejoin="round">${shape.replaceAll('stroke="#000"', 'stroke="#fff"')}</g>
    <g fill="url(#g)">${shape.replaceAll('stroke="#000"', `stroke="${c2}"`)}</g>
    ${art}
    ${d.kao ? KAO : ''}
    <g clip-path="url(#c)"><ellipse cx="34" cy="24" rx="16" ry="9" fill="#fff" opacity=".55" transform="rotate(-25 34 24)"/></g>
  </svg>`;
}

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

export async function buildShareImage(stickers, nickname) {
  await document.fonts?.ready;
  const list = stickers.slice(0, 12);
  const cols = 3, cell = 320, pad = 60, head = 190, foot = 130;
  const rows = Math.max(1, Math.ceil(list.length / cols));
  const W = 1080, H = head + rows * (cell + 40) + foot;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const font = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", sans-serif';

  // 台紙（剥離紙のしま）
  g.fillStyle = '#fff6fb';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#f3e3f1';
  g.lineWidth = 2;
  for (let y = 0; y < H; y += 36) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

  g.fillStyle = '#3a2d45';
  g.textAlign = 'center';
  g.font = `900 64px ${font}`;
  g.fillText(`${nickname}のシール帳`, W / 2, 110);
  g.font = `700 30px ${font}`;
  g.fillStyle = '#85759a';
  g.fillText(`${stickers.length}まい あつめたよ`, W / 2, 160);

  for (let i = 0; i < list.length; i++) {
    const d = { ...DESIGN_OF[list[i].code], ...list[i] };
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(stickerSvg(d)));
    const x = pad + (i % cols) * ((W - pad * 2) / cols), y = head + Math.floor(i / cols) * (cell + 40);
    g.save();
    g.shadowColor = 'rgba(80, 40, 90, .25)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 10;
    g.drawImage(img, x + 10, y, cell - 20, cell - 20);
    g.restore();
    g.fillStyle = '#3a2d45';
    g.font = `700 28px ${font}`;
    g.fillText(d.name, x + (W - pad * 2) / cols / 2, y + cell + 10);
  }

  g.fillStyle = '#e8508f';
  g.font = `900 40px ${font}`;
  g.fillText('ぷくホロシール帳', W / 2, H - 60);
  return new Promise(resolve => cv.toBlob(resolve, 'image/png'));
}

export async function shareOrSave(blob, text) {
  const file = new File([blob], 'puku-holo.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'puku-holo.png';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'saved';
}
