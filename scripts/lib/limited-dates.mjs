// 商品名・説明文から販売期間を読み取る。読み取れたものだけ返し、推測はしない
const z = (n) => String(n).padStart(2, "0");

// 年が書かれていない日付は、今日に近い方の年を当てる（10月に「1月31日まで」なら翌年）
function withYear(m, d, today) {
  const y = Number(today.slice(0, 4)), cm = Number(today.slice(5, 7));
  const year = m < cm - 3 ? y + 1 : y;
  return `${year}-${z(m)}-${z(d)}`;
}

const DATE = String.raw`(?:(\d{4})\s*[年/.\-]\s*)?(\d{1,2})\s*[月/.]\s*(\d{1,2})\s*日?(?:\s*[（(][^）)]{1,3}[）)])?`;
// [年, 月, 日]（年は無いこともある）→ YYYY-MM-DD
const toIso = ([y, m, d], today) => (y ? `${y}-${z(m)}-${z(d)}` : withYear(Number(m), Number(d), today));
const valid = (iso) => !Number.isNaN(Date.parse(iso)) && Number(iso.slice(5, 7)) <= 12 && Number(iso.slice(8, 10)) <= 31;

// 「12/20までのご注文で年内お届け」のような配送・注文の締め切りは販売期間ではないので除く
const SHIPPING = /お届け|配送|発送|出荷|到着|注文|受付|予約|決済|入金|ポイント|クーポン|セール/;
const notShipping = (t, m) => m && !SHIPPING.test(t.slice(Math.max(0, m.index - 10), m.index + m[0].length + 15));

export function detectDates(text, today) {
  const t = (text ?? "").normalize("NFKC");
  let from = null, until = null, evidence = null;

  // 「販売期間 10月1日〜12月25日」
  const range = t.match(new RegExp(`(?:販売期間|期間)[^\\d]{0,6}${DATE}\\s*[〜~～\\-ー]\\s*${DATE}`));
  if (notShipping(t, range)) {
    from = toIso(range.slice(1, 4), today);
    until = toIso(range.slice(4, 7), today);
    evidence = range[0];
  }
  // 「12月25日まで」「12/25迄」
  if (!until) {
    const m = t.match(new RegExp(`${DATE}\\s*(?:まで|迄|頃まで|までの)`));
    if (notShipping(t, m)) { until = toIso(m.slice(1, 4), today); evidence = m[0]; }
  }
  // 「10月1日より発売」「10/1から販売」
  if (!from) {
    const m = t.match(new RegExp(`${DATE}\\s*(?:より|から|〜)?\\s*(?:発売|販売開始|販売|新発売)`));
    if (notShipping(t, m)) { from = toIso(m.slice(1, 4), today); evidence ??= m[0]; }
  }
  return {
    available_from: from && valid(from) ? from : null,
    available_until: until && valid(until) ? until : null,
    evidence,
  };
}

export const LIMITED_WORDS = /期間限定|季節限定|数量限定|冬季限定|夏季限定|秋限定|冬限定|春限定|夏限定|限定発売|シーズン限定/;
export const NEW_WORDS = /新発売|新商品|NEW|ニュー/;
