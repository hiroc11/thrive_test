import type { Area, PriceTier, Scene } from "./types";

export const SCENES: { id: Scene; label: string }[] = [
  { id: "business_exec", label: "取引先・会食" },
  { id: "in_laws", label: "義実家・親族" },
  { id: "female_office", label: "女性が多い職場" },
  { id: "casual_party", label: "友人・ホムパ" },
];

export const AREAS: { id: Area | "online"; label: string }[] = [
  { id: "tokyo_station_in", label: "東京駅(改札内)" },
  { id: "tokyo_station_out", label: "東京駅(改札外)" },
  { id: "shinagawa_in", label: "品川駅" },
  { id: "roppongi_akasaka", label: "六本木・赤坂" },
  { id: "shibuya_omotesando", label: "渋谷・表参道" },
  { id: "ginza", label: "銀座・日本橋" },
  { id: "shinjuku", label: "新宿" },
  { id: "ikebukuro", label: "池袋" },
  { id: "ueno", label: "上野" },
  { id: "asakusa", label: "浅草・押上" },
  { id: "ningyocho", label: "人形町" },
  { id: "kanda", label: "神田・秋葉原" },
  { id: "shimbashi", label: "新橋・浜松町" },
  { id: "kagurazaka", label: "神楽坂" },
  { id: "ebisu", label: "恵比寿" },
  { id: "jiyugaoka", label: "自由が丘" },
  { id: "futako", label: "二子玉川" },
  { id: "kiyosumi", label: "清澄白河" },
  { id: "ryogoku", label: "両国" },
  { id: "nippori", label: "日暮里・巣鴨" },
  { id: "shibamata", label: "柴又・北千住" },
  { id: "nakano", label: "中野" },
  { id: "haneda", label: "羽田空港" },
  { id: "online", label: "ネット注文のみ" },
];

export const BUDGETS: { id: PriceTier; label: string }[] = [
  { id: "under_3000", label: "〜3,000円" },
  { id: "3000_5000", label: "3,000〜5,000円" },
  { id: "5000_10000", label: "5,000〜10,000円" },
  { id: "over_10000", label: "10,000円〜" },
];

export type Must = "wrapped" | "ambient" | "shelf7" | "evening" | "savory" | "compact";
export const MUSTS: { id: Must; label: string }[] = [
  { id: "wrapped", label: "個包装" },
  { id: "ambient", label: "常温OK" },
  { id: "shelf7", label: "日持ち7日以上" },
  { id: "evening", label: "夕方17時以降も買える" },
  { id: "savory", label: "甘くない(おつまみ系)" },
  { id: "compact", label: "カバンに入る薄型" },
];

export const areaLabel = (id: string) => AREAS.find((a) => a.id === id)?.label ?? id;
export const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
