// ふたりの暮らし: 画面に依存しない計算ロジック。
// ブラウザ（window.Logic）とサーバー（require）の両方から使う。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const other = who => (who === 'a' ? 'b' : 'a');

  function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); }
  function ymd(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }
  const alive = recs => recs.filter(r => r && !r.deleted);

  // ---------- 家事 ----------
  function lastDoneMap(log) {
    const m = {};
    alive(log).forEach(l => { if (!m[l.choreId] || m[l.choreId] < l.at) m[l.choreId] = l.at; });
    return m;
  }

  function lastLogOf(choreId, log) {
    let last = null;
    alive(log).forEach(l => { if (l.choreId === choreId && (!last || l.at > last.at)) last = l; });
    return last;
  }

  // 月曜はじまりの週番号（交代制で使う）
  function weekIndex(d) {
    const monday = new Date(1970, 0, 5); // 1970-01-05 は月曜
    return Math.floor(daysBetween(monday, d) / 7);
  }

  // rotate: 'each' = やった人の次は相手 / 'weekly' = 週ごとに交代
  function assigneeOf(chore, log, now = new Date()) {
    if (chore.assignee === 'both' || !chore.rotate) return chore.assignee;
    if (chore.rotate === 'each') {
      const last = lastLogOf(chore.id, log);
      return last && (last.by === 'a' || last.by === 'b') ? other(last.by) : chore.assignee;
    }
    if (chore.rotate === 'weekly') return weekIndex(now) % 2 === 0 ? chore.assignee : other(chore.assignee);
    return chore.assignee;
  }

  // days: [0-6] があれば曜日指定、なければ every 日ごと（0 = 1回だけ）
  function choreStatus(chore, lastDone, now = new Date()) {
    if (Array.isArray(chore.days) && chore.days.length) {
      const doneToday = lastDone && daysBetween(lastDone, now) === 0;
      if (doneToday) return { due: false, label: '今日済み' };
      if (chore.days.includes(now.getDay())) return { due: true, label: '今日' };
      for (let i = 1; i <= 7; i++) {
        const wd = (now.getDay() + i) % 7;
        if (chore.days.includes(wd)) return { due: false, label: i === 1 ? '明日' : `次は${WEEKDAYS[wd]}曜` };
      }
    }
    if (!lastDone) return { due: true, label: 'まだ' };
    if (!chore.every) return { due: false, label: '完了' };
    const left = chore.every - daysBetween(lastDone, now);
    if (left <= 0) return { due: true, label: left === 0 ? '今日' : `${-left}日遅れ` };
    return { due: false, label: `あと${left}日` };
  }

  function scheduleLabel(chore) {
    if (Array.isArray(chore.days) && chore.days.length) {
      return chore.days.length === 7 ? '毎日' : `毎週${[...chore.days].sort().map(d => WEEKDAYS[d]).join('・')}`;
    }
    if (!chore.every) return '1回だけ';
    return { 1: '毎日', 7: '毎週', 14: '2週ごと', 30: '毎月' }[chore.every] || `${chore.every}日ごと`;
  }

  function choresWithStatus(chores, log, now = new Date()) {
    const last = lastDoneMap(log);
    return alive(chores).map(c => ({ c, st: choreStatus(c, last[c.id], now), who: assigneeOf(c, log, now) }));
  }

  function dueChoresFor(who, chores, log, now = new Date()) {
    return choresWithStatus(chores, log, now).filter(x => x.st.due && (x.who === who || x.who === 'both'));
  }

  // ---------- 記念日 ----------
  function nextOccurrence(ev, now = new Date()) {
    const today = startOfDay(now);
    const [y, m, d] = String(ev.date).split('-').map(Number);
    if (!ev.yearly) return new Date(y, m - 1, d);
    let next = new Date(today.getFullYear(), m - 1, d);
    if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
    return next;
  }

  function upcomingEvents(events, now = new Date()) {
    const today = startOfDay(now);
    return alive(events)
      .filter(ev => /^\d{4}-\d{2}-\d{2}$/.test(ev.date))
      .map(ev => ({ ev, next: nextOccurrence(ev, now) }))
      .filter(x => x.next >= today)
      .sort((x, y) => x.next - y.next);
  }

  function eventLabel({ ev, next }, now = new Date()) {
    const days = daysBetween(now, next);
    const when = days === 0 ? '今日！' : `あと${days}日`;
    let extra = '';
    if (ev.yearly) {
      const years = next.getFullYear() - Number(ev.date.slice(0, 4));
      if (years > 0) extra = `（${years}回目）`;
    }
    return { days, when, extra, dateText: `${next.getMonth() + 1}/${next.getDate()}` };
  }

  // ---------- ふりかえり ----------
  function weekSummary(data, now = new Date()) {
    const since = now.getTime() - 7 * DAY;
    const s = {
      chores: { a: 0, b: 0 }, points: { a: 0, b: 0 }, cover: { a: 0, b: 0 },
      thanks: { a: 0, b: 0 }, requestsDone: { a: 0, b: 0 },
    };
    alive(data.log || []).filter(l => l.at >= since && s.chores[l.by] !== undefined).forEach(l => {
      s.chores[l.by]++; s.points[l.by] += l.points || 0; if (l.cover) s.cover[l.by]++;
    });
    alive(data.thanks || []).filter(t => t.at >= since && s.thanks[t.from] !== undefined).forEach(t => { s.thanks[t.from]++; });
    alive(data.requests || []).filter(r => r.status === 'done' && (r.doneAt || 0) >= since && s.requestsDone[r.to] !== undefined)
      .forEach(r => { s.requestsDone[r.to]++; });
    return s;
  }

  // ---------- 家計簿 ----------
  // 戻り値: b が a に払うべき金額（マイナスなら a が b に払う）
  function balance(expenses) {
    let net = 0;
    alive(expenses).forEach(e => {
      const amount = Number(e.amount) || 0;
      if (e.kind === 'settle') {
        net += e.from === 'b' ? -amount : amount;
        return;
      }
      const owed = e.split === 'other' ? amount : e.split === 'self' ? 0 : amount / 2;
      net += e.paidBy === 'a' ? owed : -owed;
    });
    return Math.round(net);
  }

  // ---------- よくある家事 ----------
  // every: n日ごと / days: 曜日（0=日）
  const PRESETS = [
    { cat: '料理・台所', items: [
      { title: '朝ごはん作り', every: 1, points: 2 }, { title: '夕ごはん作り', every: 1, points: 3 },
      { title: 'お弁当作り', days: [1, 2, 3, 4, 5], points: 2 }, { title: '食器洗い', every: 1, points: 1 },
      { title: '食器をしまう', every: 1, points: 1 }, { title: 'シンクの掃除', every: 3, points: 1 },
      { title: '冷蔵庫の整理', every: 14, points: 2 }, { title: '排水口の掃除', every: 7, points: 2 },
    ] },
    { cat: '洗濯', items: [
      { title: '洗濯機を回す', every: 1, points: 1 }, { title: '洗濯物を干す', every: 1, points: 2 },
      { title: '洗濯物をたたむ', every: 1, points: 2 }, { title: 'シーツの洗濯', every: 14, points: 2 },
      { title: 'アイロンがけ', every: 7, points: 2 }, { title: 'クリーニングに出す', every: 30, points: 1 },
    ] },
    { cat: '掃除', items: [
      { title: '掃除機がけ', every: 3, points: 2 }, { title: 'お風呂掃除', every: 1, points: 2 },
      { title: 'トイレ掃除', every: 7, points: 2 }, { title: '洗面所の掃除', every: 7, points: 1 },
      { title: '床の拭き掃除', every: 7, points: 2 }, { title: '玄関の掃除', every: 14, points: 1 },
      { title: '窓ふき', every: 30, points: 3 }, { title: 'エアコンのフィルター掃除', every: 30, points: 2 },
    ] },
    { cat: 'ゴミ', items: [
      { title: '燃えるゴミ出し', days: [1, 4], points: 1 }, { title: 'プラごみ出し', days: [3], points: 1 },
      { title: '資源ごみ出し', days: [5], points: 1 }, { title: 'ゴミ袋のセット', every: 3, points: 1 },
      { title: 'ゴミの分別', every: 1, points: 1 },
    ] },
    { cat: '買い物・お金', items: [
      { title: '日用品の買い出し', every: 7, points: 2 }, { title: '食材の買い出し', every: 3, points: 2 },
      { title: '家計簿をつける', every: 7, points: 1 }, { title: '支払い・振込', every: 30, points: 1 },
    ] },
    { cat: '子ども・ペット', items: [
      { title: '保育園の送り', days: [1, 2, 3, 4, 5], points: 2 }, { title: '保育園のお迎え', days: [1, 2, 3, 4, 5], points: 2 },
      { title: 'お風呂に入れる', every: 1, points: 2 }, { title: '寝かしつけ', every: 1, points: 2 },
      { title: '学校の準備チェック', days: [0, 1, 2, 3, 4], points: 1 }, { title: 'ペットのごはん', every: 1, points: 1 },
      { title: 'ペットの散歩', every: 1, points: 2 }, { title: 'トイレ砂の交換', every: 3, points: 1 },
    ] },
    { cat: 'そのほか', items: [
      { title: '植物の水やり', every: 3, points: 1 }, { title: '布団を干す', every: 14, points: 2 },
      { title: 'タオルの交換', every: 3, points: 1 }, { title: '郵便物の整理', every: 7, points: 1 },
      { title: '車の掃除', every: 30, points: 3 },
    ] },
  ];

  const STOCK_PRESETS = ['トイレットペーパー', 'ティッシュ', '洗濯洗剤', '食器用洗剤', 'シャンプー', 'ボディソープ', 'ゴミ袋', 'お米', '調味料（しょうゆ）', 'キッチンペーパー'];

  return {
    DAY, WEEKDAYS, PRESETS, STOCK_PRESETS, other, startOfDay, daysBetween, ymd, alive,
    lastDoneMap, lastLogOf, assigneeOf, choreStatus, scheduleLabel, choresWithStatus, dueChoresFor,
    nextOccurrence, upcomingEvents, eventLabel, weekSummary, balance,
  };
});
