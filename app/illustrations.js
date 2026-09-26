// はじめての案内などで使うイラスト（このアプリのために描いたもの）
(function (root) {
  'use strict';

  // 人物: 顔・髪・体。x は中心、color は服の色
  const person = (x, color, hair, long) => `
    <path d="M${x - 24} 150c0-26 10-40 24-40s24 14 24 40z" fill="${color}"/>
    <circle cx="${x}" cy="92" r="17" fill="var(--il-skin)"/>
    ${long
      ? `<path d="M${x - 18} 94c-2-16 6-26 18-26s20 10 18 26c-2-8-8-13-18-13s-16 5-18 13z" fill="${hair}"/>
         <path d="M${x - 18} 92c-3 10-2 20 2 26l4-2c-3-6-4-14-2-22z M${x + 18} 92c3 10 2 20-2 26l-4-2c3-6 4-14 2-22z" fill="${hair}"/>`
      : `<path d="M${x - 17} 90c0-14 7-22 17-22s17 8 17 22c-4-6-10-9-17-9s-13 3-17 9z" fill="${hair}"/>`}
    <circle cx="${x - 6}" cy="94" r="1.8" fill="var(--il-face)"/>
    <circle cx="${x + 6}" cy="94" r="1.8" fill="var(--il-face)"/>
    <path d="M${x - 5} 101q5 4 10 0" stroke="var(--il-face)" stroke-width="2" fill="none" stroke-linecap="round"/>
    <circle cx="${x - 11}" cy="99" r="3" fill="var(--il-cheek)"/>
    <circle cx="${x + 11}" cy="99" r="3" fill="var(--il-cheek)"/>`;

  const heart = (x, y, s, color) =>
    `<path transform="translate(${x} ${y}) scale(${s})" d="M0 6C-3-2-14-2-14 6c0 7 8 12 14 17 6-5 14-10 14-17 0-8-11-8-14 0z" fill="${color}"/>`;

  const ILLUSTRATIONS = {
    // ふたりと家
    welcome: `
      <circle cx="120" cy="92" r="72" fill="var(--il-bg)"/>
      <path d="M58 150V86l62-46 62 46v64z" fill="var(--card)" stroke="var(--il-line)" stroke-width="3" stroke-linejoin="round"/>
      <path d="M50 92l70-52 70 52" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      ${person(96, 'var(--a)', 'var(--il-hair-a)', false)}
      ${person(146, 'var(--b)', 'var(--il-hair-b)', true)}
      ${heart(120, 8, 0.9, 'var(--accent)')}
      <path d="M20 150h200" stroke="var(--il-line)" stroke-width="3" stroke-linecap="round"/>`,

    // 2台のスマホがハートでつながる
    invite: `
      <circle cx="120" cy="88" r="70" fill="var(--il-bg)"/>
      <g transform="rotate(-8 70 90)">
        <rect x="42" y="38" width="56" height="100" rx="12" fill="var(--card)" stroke="var(--il-line)" stroke-width="3"/>
        <rect x="50" y="52" width="40" height="64" rx="4" fill="var(--il-window)"/>
        <circle cx="70" cy="126" r="3.5" fill="var(--il-line)"/>
        <rect x="56" y="62" width="28" height="6" rx="3" fill="var(--a)"/>
        <rect x="56" y="74" width="20" height="6" rx="3" fill="var(--both)"/>
      </g>
      <g transform="rotate(8 170 90)">
        <rect x="142" y="38" width="56" height="100" rx="12" fill="var(--card)" stroke="var(--il-line)" stroke-width="3"/>
        <rect x="150" y="52" width="40" height="64" rx="4" fill="var(--il-window)"/>
        <circle cx="170" cy="126" r="3.5" fill="var(--il-line)"/>
        <rect x="156" y="62" width="28" height="6" rx="3" fill="var(--b)"/>
        <rect x="156" y="74" width="20" height="6" rx="3" fill="var(--both)"/>
      </g>
      <path d="M100 76q20-26 40 0" fill="none" stroke="var(--accent)" stroke-width="3" stroke-dasharray="5 6" stroke-linecap="round"/>
      ${heart(120, 44, 0.9, 'var(--accent)')}`,

    // ベルとハート
    notify: `
      <circle cx="120" cy="88" r="70" fill="var(--il-bg)"/>
      <path d="M120 36c-24 0-38 18-38 42v24l-10 14h96l-10-14V78c0-24-14-42-38-42z" fill="var(--il-bell)" stroke="var(--il-line)" stroke-width="3" stroke-linejoin="round"/>
      <path d="M106 124a14 14 0 0 0 28 0" fill="var(--il-bell)" stroke="var(--il-line)" stroke-width="3"/>
      <circle cx="120" cy="32" r="5" fill="var(--il-line)"/>
      <path d="M62 60q-10 16 0 32 M178 60q10 16 0 32" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>
      ${heart(172, 40, 0.7, 'var(--accent)')}
      ${heart(66, 124, 0.55, 'var(--b)')}
      <circle cx="186" cy="118" r="4" fill="var(--both)"/>
      <circle cx="52" cy="46" r="3" fill="var(--both)"/>`,

    // 準備完了: チェックと紙吹雪
    done: `
      <circle cx="120" cy="88" r="70" fill="var(--il-bg)"/>
      <rect x="78" y="34" width="84" height="108" rx="10" fill="var(--card)" stroke="var(--il-line)" stroke-width="3"/>
      <rect x="100" y="28" width="40" height="14" rx="5" fill="var(--accent)"/>
      <path d="M92 66l6 6 10-12" fill="none" stroke="var(--both)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="114" y="62" width="34" height="6" rx="3" fill="var(--il-window)"/>
      <path d="M92 92l6 6 10-12" fill="none" stroke="var(--both)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="114" y="88" width="28" height="6" rx="3" fill="var(--il-window)"/>
      <path d="M92 118l6 6 10-12" fill="none" stroke="var(--both)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="114" y="114" width="32" height="6" rx="3" fill="var(--il-window)"/>
      <rect x="50" y="50" width="8" height="8" rx="2" fill="var(--a)" transform="rotate(20 54 54)"/>
      <rect x="182" y="62" width="8" height="8" rx="2" fill="var(--b)" transform="rotate(-15 186 66)"/>
      <circle cx="60" cy="112" r="4" fill="var(--both)"/>
      <circle cx="188" cy="112" r="4" fill="var(--accent)"/>
      ${heart(186, 34, 0.6, 'var(--accent)')}`,

    // ひと休み（今日の家事がないとき）
    relax: `
      <circle cx="120" cy="84" r="60" fill="var(--il-bg)"/>
      <path d="M88 84h56v22a24 24 0 0 1-24 24h-8a24 24 0 0 1-24-24z" fill="var(--card)" stroke="var(--il-line)" stroke-width="3" stroke-linejoin="round"/>
      <path d="M144 90h6a10 10 0 0 1 0 20h-8" fill="none" stroke="var(--il-line)" stroke-width="3"/>
      <path d="M104 70q-6-8 0-16 M120 70q-6-8 0-16" fill="none" stroke="var(--il-line)" stroke-width="3" stroke-linecap="round" opacity=".5"/>
      ${heart(116, 96, 0.55, 'var(--accent)')}
      <path d="M78 134h84" stroke="var(--il-line)" stroke-width="3" stroke-linecap="round"/>`,
  };

  root.illustration = function illustration(name, cls) {
    return `<svg class="illust${cls ? ' ' + cls : ''}" viewBox="0 0 240 160" role="img" aria-hidden="true">${ILLUSTRATIONS[name] || ''}</svg>`;
  };
})(typeof self !== 'undefined' ? self : this);
