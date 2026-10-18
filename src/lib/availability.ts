import type { Item } from "./types";

// 日本時間の今日（YYYY-MM-DD）
export const todayJst = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

// 販売期間内か。期限を過ぎた商品は表示しない。販売開始前の商品は「〇/〇から」と出して表示はする
export const isAvailable = (i: Item, today = todayJst()) => !i.available_until || i.available_until >= today;

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const NEW_DAYS = 30;

export function limitedLabels(i: Item, today = todayJst()) {
  const daysSinceStart = i.available_from ? (Date.parse(today) - Date.parse(i.available_from)) / 86400000 : Infinity;
  return {
    limited: Boolean(i.is_limited),
    until: i.available_until ? `〜${md(i.available_until)}まで` : null,
    upcoming: i.available_from && i.available_from > today ? `${md(i.available_from)}から販売` : null,
    isNew: daysSinceStart >= 0 && daysSinceStart <= NEW_DAYS,
  };
}
