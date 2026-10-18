// items.json の集計・正規化に使う共通定義（src/lib/constants.ts と揃える）
export const AREAS = [
  ["tokyo_station_in", "東京駅(改札内)"], ["tokyo_station_out", "東京駅(改札外)"], ["shinagawa_in", "品川駅"],
  ["roppongi_akasaka", "六本木・赤坂"], ["shibuya_omotesando", "渋谷・表参道"], ["ginza", "銀座・日本橋"],
  ["shinjuku", "新宿"], ["ikebukuro", "池袋"], ["ueno", "上野"], ["asakusa", "浅草・押上"], ["ningyocho", "人形町"],
  ["kanda", "神田・秋葉原"], ["shimbashi", "新橋・浜松町"], ["kagurazaka", "神楽坂"], ["ebisu", "恵比寿"],
  ["jiyugaoka", "自由が丘"], ["futako", "二子玉川"], ["kiyosumi", "清澄白河"], ["ryogoku", "両国"],
  ["nippori", "日暮里・巣鴨"], ["shibamata", "柴又・北千住"], ["nakano", "中野"], ["haneda", "羽田空港"],
];
export const GENRES = [
  ["wagashi", "和菓子"], ["yogashi", "洋菓子"], ["savory", "甘くない系"], ["drink", "お酒・お茶"],
];
export const TIERS = [
  ["under_3000", "〜3千"], ["3000_5000", "3〜5千"], ["5000_10000", "5千〜1万"], ["over_10000", "1万〜"],
];
// 商店街・老舗中心のエリア。大型の百貨店・駅ナカがないため、洋菓子や高価格帯までは求めない
export const LOCAL_AREAS = new Set(["ningyocho", "kanda", "kagurazaka", "jiyugaoka", "kiyosumi", "ryogoku", "nippori", "shibamata", "nakano"]);

// 「主要なマス」= 2〜3品は欲しいマス
// - 共通: 1万円〜と、お酒・お茶の5千〜1万は需要が少ないので対象外
// - 地元エリア: 和菓子・甘くない系の5千円未満だけ
export const isMajorCell = (genre, tier, area) => {
  if (tier === "over_10000" || (genre === "drink" && tier === "5000_10000")) return false;
  if (area && LOCAL_AREAS.has(area)) return (genre === "wagashi" || genre === "savory") && (tier === "under_3000" || tier === "3000_5000");
  return true;
};
export const TARGET_PER_CELL = 2;

export const tierOf = (p) => (p < 3000 ? "under_3000" : p < 5000 ? "3000_5000" : p <= 10000 ? "5000_10000" : "over_10000");

// 表記ゆれを吸収した比較用文字列
export const normalize = (s) =>
  (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・･,、。「」『』【】\[\]()（）〈〉<>!！?？~〜\-ー_\/]/g, "");

export function countCells(items) {
  const grid = {};
  for (const [a] of AREAS) {
    grid[a] = {};
    for (const [g] of GENRES) {
      grid[a][g] = {};
      for (const [t] of TIERS) grid[a][g][t] = 0;
    }
  }
  for (const i of items) for (const a of i.areas) if (grid[a]) grid[a][i.category][i.price_tier]++;
  return grid;
}
