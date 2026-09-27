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

  // ---------- アプリのアイコンに出す数（バッジ） ----------
  // その人が対応すること: 今日の担当家事、自分宛てのお願い、まだ見ていないありがとう、
  // 代わりにやってもらった家事へのお礼
  function badgeCount(who, data, now = new Date(), seenThanks = 0) {
    const t = now.getTime();
    const chores = dueChoresFor(who, data.chores || [], data.log || [], now).length;
    const requests = alive(data.requests || []).filter(r => r.to === who && (r.status === 'open' || r.status === 'accepted')).length;
    const thanks = alive(data.thanks || []).filter(x => x.from === other(who) && x.at > seenThanks && t - x.at < 7 * DAY).length;
    const covers = alive(data.log || []).filter(l => l.cover && l.for === who && !l.thanked && t - l.at < 3 * DAY).length;
    return chores + requests + thanks + covers;
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

  // ---------- 買い物の売り場 ----------
  // 表示する順（スーパーを回る順）
  const SHOP_CATS = ['野菜・果物', '肉・魚', '卵・乳製品', '豆腐・加工品', 'パン・主食', '冷凍食品', '調味料', '飲み物', 'お菓子', '日用品', '薬・衛生', 'その他'];
  // 判定する順（「牛乳」を肉、「冷凍餃子」を肉にしないよう、先に見るものを前に）
  const SHOP_WORDS = [
    ['冷凍食品', ['冷凍']],
    ['卵・乳製品', ['牛乳', 'ミルク', '卵', 'たまご', '玉子', 'ヨーグルト', 'チーズ', 'バター', '生クリーム', '豆乳']],
    ['薬・衛生', ['薬', '絆創膏', 'ばんそうこう', '目薬', '湿布', '生理用品', 'コンタクト', '体温計']],
    ['日用品', ['ティッシュ', 'トイレットペーパー', '洗剤', 'シャンプー', 'リンス', 'コンディショナー', 'ボディソープ', '石鹸', 'せっけん', '歯ブラシ', '歯磨き', 'ゴミ袋', 'ラップ', 'ホイル', 'キッチンペーパー', 'スポンジ', '電池', 'マスク', '柔軟剤', 'ハンドソープ', '綿棒', 'おむつ', 'オムツ', 'おしりふき', '漂白']],
    ['野菜・果物', ['キャベツ', 'レタス', '玉ねぎ', 'たまねぎ', '玉葱', 'にんじん', '人参', 'じゃがいも', 'トマト', 'きゅうり', 'ねぎ', 'ネギ', '大根', '白菜', 'もやし', 'ほうれん草', 'ブロッコリー', 'ピーマン', 'なす', 'きのこ', 'しめじ', 'えのき', '椎茸', 'しいたけ', 'まいたけ', 'バナナ', 'りんご', 'みかん', 'いちご', 'レモン', 'アボカド', '果物', '野菜', 'にんにく', '生姜', 'しょうが', 'かぼちゃ', 'さつまいも', 'ごぼう', '小松菜', '水菜', 'オクラ', '豆苗', 'ぶどう', 'キウイ']],
    ['肉・魚', ['肉', '豚', '牛', '鶏', 'ベーコン', 'ハム', 'ソーセージ', 'ウインナー', '魚', '鮭', 'さけ', 'サーモン', 'まぐろ', '刺身', 'えび', 'いか', 'たこ', 'あさり', 'しらす', 'さば', 'ぶり', 'たら']],
    ['豆腐・加工品', ['豆腐', '納豆', '油揚げ', 'こんにゃく', 'ちくわ', 'かまぼこ', 'キムチ', 'ツナ', '缶詰']],
    ['パン・主食', ['パン', '米', 'ごはん', 'パスタ', 'うどん', 'そば', 'ラーメン', '麺', 'シリアル', 'もち', 'オートミール']],
    ['調味料', ['醤油', 'しょうゆ', '味噌', 'みそ', '塩', '砂糖', '酢', '油', 'オイル', 'マヨネーズ', 'ケチャップ', 'ソース', 'だし', 'みりん', '料理酒', 'コンソメ', 'ドレッシング', '胡椒', 'こしょう', 'カレールー', 'ルー', 'スパイス']],
    ['飲み物', ['水', 'お茶', 'コーヒー', '紅茶', 'ジュース', 'ビール', '酒', 'ワイン', '炭酸', '麦茶', 'サイダー']],
    ['お菓子', ['お菓子', '菓子', 'チョコ', 'クッキー', 'ポテチ', 'アイス', 'グミ', 'せんべい', 'ガム', 'スナック']],
  ];
  function shopCategory(name) {
    const n = String(name || '');
    for (const [cat, words] of SHOP_WORDS) if (words.some(w => n.includes(w))) return cat;
    return 'その他';
  }

  // ---------- 家計簿のカテゴリ ----------
  const EXPENSE_CATS = [
    ['food', '食費'], ['eatout', '外食'], ['daily', '日用品'], ['home', '住まい・光熱'], ['comm', '通信・サブスク'],
    ['transport', '交通'], ['kids', '子ども'], ['medical', '医療'], ['fun', '娯楽・趣味'], ['other', 'その他'],
  ];
  const EXPENSE_WORDS = [
    ['home', ['家賃', '電気', 'ガス', '水道', '管理費', '火災保険']],
    ['comm', ['携帯', 'スマホ', 'ネット', '光回線', 'Netflix', 'Spotify', 'Prime', 'サブスク', 'NHK', 'Wi-Fi', 'ドコモ', 'au', 'ソフトバンク', '楽天モバイル']],
    ['transport', ['電車', 'バス', 'タクシー', 'ガソリン', '駐車', 'Suica', 'PASMO', '高速', 'JR']],
    ['medical', ['病院', 'クリニック', '薬局', '歯医者', '歯科', '医院']],
    ['kids', ['保育', '学校', 'おもちゃ', '習い事', '給食', '塾']],
    ['eatout', ['レストラン', 'カフェ', 'スタバ', 'スターバックス', 'マクドナルド', 'マック', 'ランチ', 'ディナー', '居酒屋', 'ラーメン', '寿司', '焼肉', 'ファミレス', 'サイゼリヤ', 'ガスト', '出前', 'Uber Eats', 'ウーバー']],
    ['daily', ['ドラッグ', 'マツキヨ', 'マツモトキヨシ', 'ウエルシア', 'ダイソー', 'セリア', 'ニトリ', '無印', '100均', 'ホームセンター', 'カインズ']],
    ['fun', ['映画', '旅行', 'ホテル', '本', '書店', 'ゲーム', 'チケット', 'ライブ', '美術館', 'レジャー']],
    ['food', ['スーパー', 'イオン', '西友', 'ライフ', 'マルエツ', '業務スーパー', 'コープ', '生協', 'オーケー', 'ヨーカドー', '成城石井', '八百屋', '肉屋', '魚屋', 'コンビニ', 'セブン', 'ローソン', 'ファミマ', '食材']],
  ];
  function expenseCategory(title) {
    const t = String(title || '').toLowerCase();
    for (const [cat, words] of EXPENSE_WORDS) if (words.some(w => t.includes(w.toLowerCase()))) return cat;
    return 'other';
  }

  // ---------- 毎月の固定費 ----------
  // 固定費ごとに、登録した月から今月までの記録を作る。ID は決まった形なので、ふたりの端末で作っても重ならない
  function recurringDue(recurring, existingIds, now = new Date()) {
    const out = [];
    const curYm = now.getFullYear() * 12 + now.getMonth();
    for (const r of alive(recurring)) {
      if (!/^\d{4}-\d{2}$/.test(r.startYm || '') || !(r.amount > 0)) continue;
      const [sy, sm] = r.startYm.split('-').map(Number);
      const day = Math.min(Math.max(Number(r.day) || 1, 1), 28);
      for (let ym = sy * 12 + (sm - 1); ym <= curYm; ym++) {
        if (ym === curYm && now.getDate() < day) break;
        const y = Math.floor(ym / 12), m = (ym % 12) + 1;
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const id = `rec-${r.id}-${key}`.slice(0, 64);
        if (existingIds.has(id)) continue;
        out.push({
          id, recurringId: r.id, title: r.title, amount: r.amount, date: `${key}-${String(day).padStart(2, '0')}`,
          paidBy: r.paidBy, split: r.split, category: r.category || expenseCategory(r.title), at: new Date(y, m - 1, day).getTime(),
        });
      }
    }
    return out;
  }

  // ---------- 晩ごはん ----------
  const DINNER_PRESETS = ['カレー', 'ハンバーグ', '鍋', '焼き魚', '生姜焼き', 'パスタ', 'うどん', '餃子', '親子丼', 'オムライス', '唐揚げ', 'お刺身', '麻婆豆腐', 'シチュー', '焼きそば', 'お好み焼き', '外食', 'テイクアウト'];
  // その日の候補（日によって入れかわる）
  function dinnerSuggestions(date, count = 8) {
    let seed = 0;
    for (const ch of date) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const list = [...DINNER_PRESETS];
    for (let i = list.length - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) >>> 0; const j = seed % (i + 1); [list[i], list[j]] = [list[j], list[i]]; }
    return list.slice(0, count);
  }
  // votes: [{ who, date, name }] → { a: Set, b: Set, match: [name] }
  function dinnerState(votes, date) {
    const st = { a: new Set(), b: new Set(), match: [] };
    alive(votes).filter(v => v.date === date && st[v.who]).forEach(v => st[v.who].add(v.name));
    st.match = [...st.a].filter(n => st.b.has(n));
    return st;
  }

  // 料理ごとのよく使う材料（晩ごはんが決まったら買い物リストへ）
  const DINNER_INGREDIENTS = {
    'カレー': ['カレールー', '玉ねぎ', 'にんじん', 'じゃがいも', '豚こま'],
    'ハンバーグ': ['ひき肉', '玉ねぎ', 'パン粉', '卵'],
    '鍋': ['白菜', 'ねぎ', 'しいたけ', '豆腐', '鶏もも肉', '鍋の素'],
    '焼き魚': ['鮭', '大根'],
    '生姜焼き': ['豚ロース', '生姜', '玉ねぎ', 'キャベツ'],
    'パスタ': ['パスタ', 'ベーコン', 'にんにく', 'トマト缶'],
    'うどん': ['うどん', 'ねぎ', '油揚げ'],
    '餃子': ['餃子の皮', 'ひき肉', 'キャベツ', 'にら'],
    '親子丼': ['鶏もも肉', '玉ねぎ', '卵', 'みつば'],
    'オムライス': ['卵', '鶏もも肉', '玉ねぎ', 'ケチャップ'],
    '唐揚げ': ['鶏もも肉', '片栗粉', '生姜', 'にんにく'],
    'お刺身': ['刺身', '大葉'],
    '麻婆豆腐': ['豆腐', 'ひき肉', 'ねぎ', '麻婆豆腐の素'],
    'シチュー': ['シチュールー', '鶏もも肉', 'じゃがいも', 'にんじん', '玉ねぎ', '牛乳'],
    '焼きそば': ['焼きそば麺', '豚こま', 'キャベツ', 'もやし'],
    'お好み焼き': ['お好み焼き粉', 'キャベツ', '豚バラ', '卵', 'ソース'],
  };

  // 名もなき家事（予定に入れるほどではない小さな家事）
  const SMALL_CHORES = [
    'トイレットペーパーの補充', 'ゴミ袋のセット', '排水口のゴミ取り', '郵便物の整理', '洗剤の詰め替え', 'ティッシュの補充',
    '靴をそろえる', '玄関のそうじ', 'シーツの交換', 'タオルの交換', '冷蔵庫の中の整理', '植物の水やり',
    '電池の交換', '宅配の受け取り', '書類の手続き', '献立を考える', 'レシートの整理', '子どもの持ち物準備',
  ];

  // 持ち物チェックリストのひな形
  const PACK_TEMPLATES = {
    '旅行': ['財布', 'スマホ', '充電器', 'モバイルバッテリー', '着替え', '下着', 'パジャマ', '歯ブラシ', 'スキンケア', '薬', '保険証', 'チケット・予約確認'],
    '帰省': ['財布', 'スマホ', '充電器', '着替え', '下着', 'おみやげ', '薬', '保険証', 'チケット'],
    'キャンプ': ['テント', '寝袋', 'マット', 'ランタン', 'チェア', 'テーブル', 'クーラーボックス', '調理道具', '食材', '虫よけ', 'ゴミ袋', '着替え'],
    '出張': ['財布', 'スマホ', '充電器', 'PC', '名刺', '着替え', 'シャツ', '歯ブラシ', 'チケット'],
  };

  // 期限・更新（車検・保険など）: 期限までの日数
  function deadlineDays(d, now = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) return null;
    const [y, m, day] = d.date.split('-').map(Number);
    return daysBetween(now, new Date(y, m - 1, day));
  }
  function upcomingDeadlines(list, now = new Date()) {
    return alive(list).filter(d => !d.done).map(d => ({ d, days: deadlineDays(d, now) }))
      .filter(x => x.days !== null).sort((x, y) => x.days - y.days);
  }

  // ひと月のまとめ（ふたり会議）: ym = 'YYYY-MM'
  function monthSummary(data, ym) {
    const inMonth = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === ym; };
    const s = { chores: { a: 0, b: 0 }, small: { a: 0, b: 0 }, thanks: { a: 0, b: 0 }, requestsDone: { a: 0, b: 0 }, spend: 0 };
    alive(data.log || []).filter(l => inMonth(l.at) && s.chores[l.by] !== undefined).forEach(l => { s.chores[l.by]++; if (l.small) s.small[l.by]++; });
    alive(data.thanks || []).filter(t => inMonth(t.at) && s.thanks[t.from] !== undefined).forEach(t => { s.thanks[t.from]++; });
    alive(data.requests || []).filter(r => r.status === 'done' && inMonth(r.doneAt || 0) && s.requestsDone[r.to] !== undefined).forEach(r => { s.requestsDone[r.to]++; });
    alive(data.expenses || []).filter(e => e.kind !== 'settle' && String(e.date || '').startsWith(ym)).forEach(e => { s.spend += Number(e.amount) || 0; });
    return s;
  }

  // 文字列から短い ID を作る（同じ名前 → 同じ ID）
  function hashId(s) {
    let h = 5381;
    for (const ch of String(s)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
    return h.toString(36);
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
    nextOccurrence, upcomingEvents, eventLabel, weekSummary, balance, badgeCount,
    SHOP_CATS, shopCategory, EXPENSE_CATS, expenseCategory, recurringDue, DINNER_PRESETS, dinnerSuggestions, dinnerState, hashId,
    DINNER_INGREDIENTS, SMALL_CHORES, PACK_TEMPLATES, deadlineDays, upcomingDeadlines, monthSummary,
  };
});
