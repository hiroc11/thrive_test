// 楽天市場 商品検索API で items.json に画像URL・楽天アフィリエイトURLを書き込む
// 使い方: npm run fetch:rakuten   (.env.local に RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY が必要)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import dns from "node:dns";

// 楽天の許可IPはIPv4で登録するため、IPv6経由にならないようIPv4を優先
dns.setDefaultResultOrder("ipv4first");

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

const only = process.argv.find((a) => a.startsWith("--limit="));
const targets = only ? items.slice(0, Number(only.split("=")[1])) : items;
// accessKey の渡し方は記事により異なるため3通りを用意（--probe で自動判定）
const MODES = {
  query: (params, headers) => params.set("accessKey", ACCESS_KEY),
  header: (params, headers) => (headers.accessKey = ACCESS_KEY),
  bearer: (params, headers) => (headers.Authorization = `Bearer ${ACCESS_KEY}`),
};

// Referer なしだと "API Configuration not found" になるため既定で送る
let withReferer = (process.env.RAKUTEN_SEND_REFERER ?? env.RAKUTEN_SEND_REFERER ?? "true") !== "false";

async function search(keyword, mode) {
  const params = new URLSearchParams({
    format: "json",
    formatVersion: "2",
    applicationId: APP_ID,
    keyword,
    hits: "1",
    imageFlag: "1",
    sort: "standard",
  });
  if (AFF_ID) params.set("affiliateId", AFF_ID);
  const headers = withReferer ? { Referer: REFERER, Origin: new URL(REFERER).origin } : {};
  MODES[mode](params, headers);
  const res = await fetch(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?${params}`, { headers });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

let mode = process.env.RAKUTEN_AUTH_MODE ?? env.RAKUTEN_AUTH_MODE ?? "header";
if (process.argv.includes("--probe")) {
  for (const ref of [false, true]) {
    withReferer = ref;
    for (const m of ["query", "header"]) {
      const label = `${m} / Referer${ref ? "あり" : "なし"}`;
      try {
        await search("とらや 羊羹", m);
        console.log(`OK  ${label} で接続できました → .env.local に RAKUTEN_AUTH_MODE=${m} と RAKUTEN_SEND_REFERER=${ref} を追加してください`);
      } catch (e) {
        console.log(`NG  ${label}: ${e.message}`);
      }
      await sleep(1100);
    }
  }
  process.exit(0);
}

for (const item of targets) {
  if (item.image_url && !force) continue;
  try {
    const data = await search(item.search_keyword, mode);
    const hit = data.Items?.[0];
    if (hit) {
      const img = hit.mediumImageUrls?.[0];
      item.image_url = typeof img === "string" ? img.replace(/\?_ex=\d+x\d+/, "?_ex=300x300") : null;
      item.rakuten_item_url = hit.affiliateUrl || hit.itemUrl;
      // 未確認データは楽天の実売価格で補正（検索ミス対策で推定値の0.5〜2倍の範囲のみ）
      const p = Number(hit.itemPrice);
      if (item.data_status === "draft" && p >= item.price_tax_in * 0.5 && p <= item.price_tax_in * 2) {
        item.price_tax_in = p;
        item.price_tier = p < 3000 ? "under_3000" : p < 5000 ? "3000_5000" : p <= 10000 ? "5000_10000" : "over_10000";
      }
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
