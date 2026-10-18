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

// 地図表示用のエリア中心座標（駅・街の中心のおおよその位置）
export const AREA_COORDS: Record<string, [number, number]> = {
  tokyo_station_in: [35.6812, 139.7671],
  tokyo_station_out: [35.6797, 139.7702],
  shinagawa_in: [35.6285, 139.7387],
  roppongi_akasaka: [35.6697, 139.7339],
  shibuya_omotesando: [35.6618, 139.7041],
  ginza: [35.6717, 139.7649],
  shinjuku: [35.6909, 139.7003],
  ikebukuro: [35.7295, 139.7109],
  ueno: [35.7138, 139.7773],
  asakusa: [35.7111, 139.7966],
  ningyocho: [35.6863, 139.7826],
  kanda: [35.6955, 139.7708],
  shimbashi: [35.6662, 139.7583],
  kagurazaka: [35.7020, 139.7385],
  ebisu: [35.6467, 139.7101],
  jiyugaoka: [35.6077, 139.6690],
  futako: [35.6116, 139.6264],
  kiyosumi: [35.6820, 139.7990],
  ryogoku: [35.6960, 139.7930],
  nippori: [35.7281, 139.7710],
  shibamata: [35.7580, 139.8775],
  nakano: [35.7058, 139.6657],
  haneda: [35.5494, 139.7798],
};
