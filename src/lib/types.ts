export type Scene = "business_exec" | "in_laws" | "female_office" | "casual_party";
export type Area =
  | "tokyo_station_in" | "tokyo_station_out" | "shinagawa_in" | "roppongi_akasaka"
  | "shibuya_omotesando" | "ginza" | "shinjuku";
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
  why_recommended: string;
  shops: Shop[];
  search_keyword: string;
  image_url: string | null;
  jan_code: string | null;
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
