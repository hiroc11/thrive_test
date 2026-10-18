// 足りない主要マス（エリア × ジャンル × 予算）ごとに、そのエリアで既に扱っているブランドの公式店から
// 該当価格帯の商品を楽天市場の商品検索APIで探し、scripts/out/gap-search.json に保存する
// import-candidates.mjs がランキングと同じ条件（既存ブランド・公式店・重複除外）で取り込む
// 使い方: npm run fetch:gaps
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { AREAS, GENRES, TIERS, TARGET_PER_CELL, countCells, isMajorCell, normalize } from "./lib/catalog.mjs";
import { env, requireKeys, rakutenGet, AFF_ID } from "./lib/rakuten.mjs";

requireKeys();
const SEARCH_URL = env("RAKUTEN_SEARCH_URL", `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/${env("RAKUTEN_API_VERSION", "20260701")}`);
const BRANDS_PER_CELL = 3;
const PRICE = { under_3000: [1000, 2999], "3000_5000": [3000, 4999], "5000_10000": [5000, 10000] };
const HINT = { wagashi: "和菓子", yogashi: "", savory: "", drink: "" };

const items = JSON.parse(readFileSync("src/data/items.json", "utf8"));
const grid = countCells(items);

// エリア × ジャンルごとに、そこで扱いのあるブランド（店舗数が多い順）
const brandsIn = {};
for (const i of items) for (const a of i.areas) {
  const k = `${a}|${i.category}`;
  (brandsIn[k] ??= {})[i.brand_name] = (brandsIn[k][i.brand_name] ?? 0) + i.areas.length;
}

const queries = new Map(); // brand|tier → {brand, category, tier}
for (const [a] of AREAS) for (const [g] of GENRES) for (const [t] of TIERS) {
  if (!isMajorCell(g, t) || grid[a][g][t] >= TARGET_PER_CELL) continue;
  const brands = Object.entries(brandsIn[`${a}|${g}`] ?? {}).sort((x, y) => y[1] - x[1]).map(([b]) => b);
  for (const b of brands.filter((b) => normalize(b).length >= 3).slice(0, BRANDS_PER_CELL)) queries.set(`${b}|${t}`, { brand: b, category: g, tier: t });
}
console.log(`検索 ${queries.size} 件（約${Math.ceil(queries.size * 1.1 / 60)}分）`);

const out = [];
let n = 0;
for (const { brand, category, tier } of queries.values()) {
  n++;
  const [min, max] = PRICE[tier];
  try {
    const data = await rakutenGet(SEARCH_URL, {
      keyword: `${brand} ${HINT[category]}`.trim(), minPrice: String(min), maxPrice: String(max),
      hits: "10", imageFlag: "1", availability: "1", ...(AFF_ID ? { affiliateId: AFF_ID } : {}),
    });
    const hits = (data.Items ?? []).map((x) => x.Item ?? x);
    for (const [rank, i] of hits.entries()) {
      out.push({
        genre_name: `検索:${brand}`, category, rank: rank + 1,
        itemName: i.itemName, itemPrice: Number(i.itemPrice), itemCaption: (i.itemCaption ?? "").slice(0, 600),
        shopName: i.shopName, shopCode: i.shopCode, itemCode: i.itemCode,
        image: i.mediumImageUrls?.[0]?.imageUrl ?? i.mediumImageUrls?.[0] ?? null,
        url: i.affiliateUrl || i.itemUrl,
      });
    }
    console.log(`OK  [${n}/${queries.size}] ${brand} ${tier}: ${hits.length}件`);
  } catch (e) {
    console.log(`NG  [${n}/${queries.size}] ${brand} ${tier}: ${e.message}`);
  }
}

mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/gap-search.json", JSON.stringify(out, null, 2) + "\n");
console.log(`scripts/out/gap-search.json に ${out.length} 件保存しました`);
