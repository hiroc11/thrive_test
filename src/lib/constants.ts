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

// 地図を拡大したときに分けて表示する施設（駅ナカ・百貨店など）。match のどれかが店舗名に含まれたらこの施設とみなす
// 座標は建物のおおよその位置
export interface Facility {
  id: string;
  name: string;
  area: string;
  pos: [number, number];
  match: string[];
}
export const FACILITIES: Facility[] = [
  { id: "gransta", name: "グランスタ東京", area: "tokyo_station_in", pos: [35.6814, 139.7663], match: ["グランスタ"] },
  { id: "giftpalette", name: "東京ギフトパレット", area: "tokyo_station_in", pos: [35.6806, 139.7686], match: ["ギフトパレット"] },
  { id: "daimaru_tokyo", name: "大丸東京店", area: "tokyo_station_out", pos: [35.6795, 139.7691], match: ["大丸東京"] },
  { id: "ichibangai", name: "東京駅一番街", area: "tokyo_station_out", pos: [35.6803, 139.7681], match: ["一番街"] },
  { id: "ecute_shinagawa", name: "エキュート品川", area: "shinagawa_in", pos: [35.6287, 139.7393], match: ["エキュート品川"] },
  { id: "midtown", name: "東京ミッドタウン", area: "roppongi_akasaka", pos: [35.6656, 139.7310], match: ["ミッドタウン"] },
  { id: "roppongi_hills", name: "六本木ヒルズ", area: "roppongi_akasaka", pos: [35.6604, 139.7292], match: ["六本木ヒルズ"] },
  { id: "toraya_akasaka", name: "とらや 赤坂店", area: "roppongi_akasaka", pos: [35.6761, 139.7323], match: ["とらや 赤坂店"] },
  { id: "scramble", name: "渋谷スクランブルスクエア", area: "shibuya_omotesando", pos: [35.6584, 139.7022], match: ["スクランブルスクエア"] },
  { id: "hikarie", name: "渋谷ヒカリエ ShinQs", area: "shibuya_omotesando", pos: [35.6590, 139.7036], match: ["ヒカリエ"] },
  { id: "mitsukoshi_ginza", name: "銀座三越", area: "ginza", pos: [35.6713, 139.7656], match: ["銀座三越"] },
  { id: "matsuya_ginza", name: "松屋銀座", area: "ginza", pos: [35.6722, 139.7672], match: ["松屋銀座"] },
  { id: "mitsukoshi_nihombashi", name: "日本橋三越本店", area: "ginza", pos: [35.6857, 139.7735], match: ["日本橋三越"] },
  { id: "takashimaya_nihombashi", name: "日本橋髙島屋", area: "ginza", pos: [35.6810, 139.7727], match: ["日本橋髙島屋", "日本橋高島屋"] },
  { id: "isetan_shinjuku", name: "伊勢丹新宿店", area: "shinjuku", pos: [35.6918, 139.7046], match: ["伊勢丹"] },
  { id: "takashimaya_shinjuku", name: "新宿髙島屋", area: "shinjuku", pos: [35.6874, 139.7022], match: ["新宿髙島屋", "新宿高島屋"] },
  { id: "keio_shinjuku", name: "京王百貨店新宿店", area: "shinjuku", pos: [35.6904, 139.6990], match: ["京王百貨店"] },
  { id: "lumine_shinjuku", name: "ルミネ新宿", area: "shinjuku", pos: [35.6896, 139.7005], match: ["ルミネ新宿"] },
  { id: "nakamuraya", name: "新宿中村屋 本店", area: "shinjuku", pos: [35.6915, 139.7016], match: ["新宿中村屋 本店"] },
  { id: "tobu_ikebukuro", name: "東武百貨店池袋本店", area: "ikebukuro", pos: [35.7301, 139.7095], match: ["東武百貨店"] },
  { id: "seibu_ikebukuro", name: "西武池袋本店", area: "ikebukuro", pos: [35.7296, 139.7118], match: ["西武池袋"] },
  { id: "ecute_ueno", name: "エキュート上野", area: "ueno", pos: [35.7137, 139.7769], match: ["エキュート上野"] },
  { id: "matsuzakaya_ueno", name: "松坂屋上野店", area: "ueno", pos: [35.7077, 139.7735], match: ["松坂屋上野"] },
  { id: "solamachi", name: "東京ソラマチ", area: "asakusa", pos: [35.7101, 139.8107], match: ["ソラマチ"] },
  { id: "matsuya_asakusa", name: "松屋浅草", area: "asakusa", pos: [35.7105, 139.7975], match: ["松屋浅草"] },
  { id: "ecute_akihabara", name: "エキュート秋葉原", area: "kanda", pos: [35.6984, 139.7731], match: ["エキュート秋葉原"] },
  { id: "atre_hamamatsucho", name: "アトレ浜松町", area: "shimbashi", pos: [35.6553, 139.7570], match: ["アトレ浜松町"] },
  { id: "atre_ebisu", name: "アトレ恵比寿", area: "ebisu", pos: [35.6468, 139.7100], match: ["アトレ恵比寿"] },
  { id: "mitsukoshi_ebisu", name: "恵比寿三越", area: "ebisu", pos: [35.6421, 139.7136], match: ["恵比寿三越"] },
  { id: "takashimaya_tamagawa", name: "玉川髙島屋S・C", area: "futako", pos: [35.6115, 139.6268], match: ["玉川髙島屋", "玉川高島屋"] },
  { id: "marui_kitasenju", name: "北千住マルイ", area: "shibamata", pos: [35.7493, 139.8046], match: ["北千住マルイ"] },
  { id: "lumine_kitasenju", name: "ルミネ北千住", area: "shibamata", pos: [35.7488, 139.8049], match: ["ルミネ北千住"] },
];
