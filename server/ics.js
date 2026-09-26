'use strict';

// カレンダー購読用の iCalendar (.ics) を作る。
// Google カレンダー・Apple カレンダーが URL を定期的に読みに来て、記念日などを表示する。

const Logic = require('../app/logic.js');

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function escapeText(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// 1行75オクテットまで（UTF-8 の文字の途中では切らない）
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const dateValue = ymd => ymd.replace(/-/g, '');
function nextDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Logic.ymd(new Date(y, m - 1, d + 1));
}
function stamp(ts) {
  return new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function allDay(lines, { uid, date, summary, description, rrule, updatedAt }) {
  lines.push('BEGIN:VEVENT', `UID:${uid}@futari`, `DTSTAMP:${stamp(updatedAt > 1 ? updatedAt : Date.now())}`,
    `DTSTART;VALUE=DATE:${dateValue(date)}`, `DTEND;VALUE=DATE:${dateValue(nextDay(date))}`,
    `SUMMARY:${escapeText(summary)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (rrule) lines.push(`RRULE:${rrule}`);
  lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
}

// data: { names, events, requests, chores }, opts: { chores: boolean }
function build(data, opts = {}, now = new Date()) {
  const n = data.names;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//futari//ja', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:ふたりの暮らし', 'X-WR-TIMEZONE:Asia/Tokyo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];

  for (const ev of Logic.alive(data.events || [])) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date)) continue;
    allDay(lines, {
      uid: `event-${ev.id}`, date: ev.date, summary: `💞 ${ev.title}`, updatedAt: ev.updatedAt,
      rrule: ev.yearly ? 'FREQ=YEARLY' : null,
    });
  }

  for (const r of Logic.alive(data.requests || [])) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.due || '') || r.status === 'done' || r.status === 'declined') continue;
    allDay(lines, {
      uid: `request-${r.id}`, date: r.due, updatedAt: r.updatedAt,
      summary: `🙏 ${n[r.to] || ''}へ: ${r.text}`, description: `${n[r.from] || ''}からのお願い`,
    });
  }

  if (opts.chores) {
    for (const c of Logic.alive(data.chores || [])) {
      // 曜日で決めた家事だけ（n日ごとは、やった日しだいで予定が動くのでカレンダーには出さない）
      const days = Array.isArray(c.days) ? c.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [];
      if (!days.length) continue;
      // 開始日は、家事を登録（最終更新）した日以降で最初にその曜日になる日。毎日変わらないようにする
      const first = new Date(c.updatedAt > 1 ? c.updatedAt : now);
      while (!days.includes(first.getDay())) first.setDate(first.getDate() + 1);
      const start = Logic.ymd(first);
      const who = c.assignee === 'both' ? 'ふたり' : (n[c.assignee] || '');
      allDay(lines, {
        uid: `chore-${c.id}`, date: start, updatedAt: c.updatedAt,
        summary: `🧹 ${c.title}（${c.rotate ? '交代' : who}）`,
        rrule: `FREQ=WEEKLY;BYDAY=${[...days].sort().map(d => BYDAY[d]).join(',')}`,
      });
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { build, fold, escapeText };
