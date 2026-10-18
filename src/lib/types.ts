export type Scene = "business_exec" | "in_laws" | "female_office" | "casual_party";
export type Area =
  | "tokyo_station_in" | "tokyo_station_out" | "shinagawa_in" | "roppongi_akasaka"
  | "shibuya_omotesando" | "ginza" | "shinjuku" | "ikebukuro" | "ueno" | "asakusa"
  | "ningyocho" | "kanda" | "shimbashi" | "kagurazaka" | "ebisu" | "jiyugaoka" | "futako"
  | "haneda" | "kiyosumi" | "shibamata" | "nippori" | "nakano" | "ryogoku";
export type PriceTier = "under_3000" | "3000_5000" | "5000_10000" | "over_10000";

export interface Shop {
  area_id: Area;
  shop_name: string;
  access_note: string;
  open_hours: string;
  phone: string | null;
  google_maps_url: string;
}

export interface Item {
  id: string;
  name: string;
  brand_name: string;
  category: "wagashi" | "yogashi" | "savory" | "drink";
  price_tax_in: number;
  price_tier: PriceTier;
  target_scenes: Scene[];
  areas: Area[];
  is_individually_wrapped: boolean;
  piece_count: string;
  temperature: "ambient" | "chilled";
  shelf_life_days: number;
  is_sweet: boolean;
  evening_availability: "high" | "medium" | "morning_only";
  bag_size: "compact_a4" | "standard" | "large";
  handoff_script: string;
  talk_topic?: string; // 渡したあとの話のネタ（確かな話がある商品のみ）
  why_recommended: string;
  shops: Shop[];
  search_keyword: string;
  image_url: string | null;
  rakuten_item_url?: string;
  jan_code: string | null;
  data_status: "curated" | "draft"; // draft = 店舗・日持ち等が未確認
  // 期間限定・新商品（任意）。日付は YYYY-MM-DD（日本時間）
  available_from?: string;
  available_until?: string; // この日を過ぎたら自動で非表示
  is_limited?: boolean;
}

export interface GiftLog {
  log_id: string;
  direction: "given" | "received";
  recipient_name: string;
  item_id: string | null;
  custom_item_name: string | null;
  estimated_price: number | null;
  date: string;
  memo: string;
}
