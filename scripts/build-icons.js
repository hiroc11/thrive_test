// Lucide のアイコン（ISC License）から、アプリで使うものだけを app/icons.js に書き出す。
// 実行: node scripts/build-icons.js
'use strict';
const fs = require('fs');
const path = require('path');

// アプリ内の名前: Lucide の名前
const USE = {
  home: 'house', chores: 'brush-cleaning', shopping: 'shopping-cart', budget: 'wallet', futari: 'heart-handshake',
  settings: 'settings', plus: 'plus', check: 'check', trash: 'trash-2', edit: 'pencil', undo: 'undo-2',
  camera: 'camera', receipt: 'receipt', calendar: 'calendar-heart', bell: 'bell', note: 'notebook-pen',
  request: 'hand-helping', thanks: 'message-circle-heart', user: 'user', users: 'users', close: 'x',
  back: 'chevron-left', next: 'chevron-right', pin: 'pin', party: 'party-popper', gift: 'gift', link: 'link',
  share: 'share-2', copy: 'copy', phone: 'smartphone', scale: 'scale', sun: 'sun', heart: 'heart', smile: 'smile',
  laugh: 'laugh', 'hand-heart': 'hand-heart', 'thumbs-up': 'thumbs-up', list: 'list-checks', done: 'circle-check',
  sparkles: 'sparkles', review: 'clipboard-list', days: 'calendar-days', package: 'package', repeat: 'repeat',
  arrow: 'arrow-right', 'mood-great': 'sun', 'mood-ok': 'cloud-sun', 'mood-tired': 'cloud', 'mood-bad': 'cloud-rain',
  dinner: 'utensils', trip: 'plane', movie: 'film', place: 'map-pin', chart: 'chart-bar', recurring: 'calendar-clock',
  clock: 'clock', history: 'history', star: 'star', 'coming-home': 'house-heart', soup: 'soup', chat: 'message-circle', piggy: 'piggy-bank', luggage: 'luggage', deadline: 'alarm-clock', topics: 'messages-square', mic: 'mic', carrot: 'carrot', target: 'target',
};

const dir = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');
const out = {};
for (const [key, file] of Object.entries(USE)) {
  const svg = fs.readFileSync(path.join(dir, `${file}.svg`), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').replace(/\s*\n\s*/g, '').trim();
  out[key] = inner;
}
const version = require(path.join(dir, '..', 'package.json')).version;
const js = `// 自動生成: node scripts/build-icons.js
// Icons from Lucide v${version} (https://lucide.dev) - ISC License, Copyright (c) Lucide Icons and Contributors
(function (root) {
  'use strict';
  const ICONS = ${JSON.stringify(out, null, 2)};
  root.icon = function icon(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  };
})(typeof self !== 'undefined' ? self : this);
`;
fs.writeFileSync(path.join(__dirname, '..', 'app', 'icons.js'), js);
console.log(`wrote ${Object.keys(out).length} icons`);
