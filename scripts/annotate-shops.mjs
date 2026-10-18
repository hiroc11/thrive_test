// 「ブランド(エリア周辺)」のような曖昧な店舗データを、公式ショップ一覧（scripts/out/shop-directory.json）に
// ブランド名が載っている施設の店舗に置き換える。地図を拡大したときの施設ピンに使う
// 使い方: npm run annotate:shops   (先に npm run fetch:shops)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { normalize } from "./lib/catalog.mjs";

const DIR = "scripts/out/shop-directory.json";
if (!existsSync(DIR)) {
  console.error(`${DIR} がありません。先に npm run fetch:shops を実行してください`);
  process.exit(1);
}
const directory = JSON.parse(readFileSync(DIR, "utf8"));
const PATH = "src/data/items.json";
const items = JSON.parse(readFileSync(PATH, "utf8"));

let replaced = 0, added = 0;
for (const item of items) {
  const key = normalize(item.brand_name);
  if (key.length < 3) continue; // 短いブランド名は他の語に紛れて誤一致する
  const shops = [];
  for (const shop of item.shops) {
    const vague = /周辺/.test(shop.shop_name);
    const found = vague ? (directory[shop.area_id] ?? []).filter((s) => s.text.includes(key)) : [];
    if (!found.length) {
      shops.push(shop);
      continue;
    }
    replaced++;
    for (const src of found) {
      added++;
      shops.push({
        area_id: shop.area_id,
        shop_name: `${item.brand_name}（${src.name}）`,
        access_note: `${src.name}内（売場は公式サイトで確認）`,
        open_hours: "施設の営業時間に準じる",
        phone: null,
        google_maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.brand_name} ${src.name}`)}`,
      });
    }
  }
  item.shops = shops;
}
writeFileSync(PATH, JSON.stringify(items, null, 2) + "\n");
console.log(`曖昧な店舗 ${replaced} 件を、施設の店舗 ${added} 件に置き換えました`);
