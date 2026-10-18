// 楽天市場 商品検索API で items.json に画像URL・楽天アフィリエイトURLを書き込む
// 使い方: npm run fetch:rakuten   (.env.local に RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY が必要)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const env = existsSync(".env.local")
  ? Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2]]),
    )
  : {};
const APP_ID = process.env.RAKUTEN_APP_ID ?? env.RAKUTEN_APP_ID;
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY ?? env.RAKUTEN_ACCESS_KEY;
const REFERER = process.env.RAKUTEN_REFERER ?? env.RAKUTEN_REFERER ?? "http://localhost:3000";
const AFF_ID = process.env.NEXT_PUBLIC_RAKUTEN_AFFILIATE_ID ?? env.NEXT_PUBLIC_RAKUTEN_AFFILIATE_ID;
if (!APP_ID || !ACCESS_KEY) {
  console.error(".env.local に RAKUTEN_APP_ID と RAKUTEN_ACCESS_KEY を設定してください");
  process.exit(1);
}

const PATH = "src/data/items.json";
const items = JSON.parse(readFileSync(PATH, "utf8"));
const force = process.argv.includes("--force");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const item of items) {
  if (item.image_url && !force) continue;
  const params = new URLSearchParams({
    format: "json",
    formatVersion: "2",
    applicationId: APP_ID,
    accessKey: ACCESS_KEY,
    keyword: item.search_keyword,
    hits: "1",
    imageFlag: "1",
    sort: "standard",
  });
  if (AFF_ID) params.set("affiliateId", AFF_ID);
  try {
    const res = await fetch(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?${params}`, {
      headers: { Referer: REFERER, Origin: new URL(REFERER).origin },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description ?? data.error ?? res.status);
    const hit = data.Items?.[0];
    if (hit) {
      const img = hit.mediumImageUrls?.[0];
      item.image_url = typeof img === "string" ? img.replace(/\?_ex=\d+x\d+/, "?_ex=300x300") : null;
      item.rakuten_item_url = hit.affiliateUrl || hit.itemUrl;
      console.log(`OK  ${item.id} ${item.name}`);
    } else {
      console.log(`--  ${item.id} ${item.name} (該当なし)`);
    }
  } catch (e) {
    console.log(`NG  ${item.id} ${item.name}: ${e.message}`);
  }
  await sleep(1100); // 楽天APIは1秒1リクエストまで
}

writeFileSync(PATH, JSON.stringify(items, null, 2) + "\n");
console.log("items.json を更新しました");
