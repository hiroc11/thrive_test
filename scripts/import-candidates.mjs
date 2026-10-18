// 楽天ランキング(scripts/out/ranking.json) × 公式ショップ一覧(scripts/out/shop-directory.json) から、
// 不足しているマスを埋める商品を src/data/items.json に draft として追加する
// 採用条件: 楽天で販売中（＝実在）かつ、ブランド名がそのエリアの公式ショップ一覧に載っていること
// 使い方: npm run import:candidates   (--dry-run で追加せず候補だけ表示)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { AREAS, TARGET_PER_CELL, countCells, isMajorCell, normalize, tierOf } from "./lib/catalog.mjs";
import { NOISE_NAME, OFF_GENRE, attributesOf, cleanName, createCatalogTools, scenesFor } from "./lib/candidate-utils.mjs";

const DRY = process.argv.includes("--dry-run");
const FILL_UP_TO = TARGET_PER_CELL + 1; // 不足マスを3品まで埋める
const MAX_NEW_PER_BRAND = 3;

for (const f of ["scripts/out/ranking.json", "scripts/out/shop-directory.json"]) {
  if (!existsSync(f)) {
    console.error(`${f} がありません。先に npm run fetch:ranking と npm run fetch:shops を実行してください`);
    process.exit(1);
  }
}
const ranking = JSON.parse(readFileSync("scripts/out/ranking.json", "utf8"));
// npm run fetch:gaps の結果（足りないマスを狙った検索）があれば候補に加える
if (existsSync("scripts/out/gap-search.json")) ranking.push(...JSON.parse(readFileSync("scripts/out/gap-search.json", "utf8")));
const directory = JSON.parse(readFileSync("scripts/out/shop-directory.json", "utf8"));
const ITEMS_PATH = "src/data/items.json";
const items = JSON.parse(readFileSync(ITEMS_PATH, "utf8"));
const areaLabel = Object.fromEntries(AREAS);

// エリア判定: ブランド名がそのエリアの公式ショップ一覧の本文に出てくるか
function areasFor(brand) {
  const key = normalize(brand);
  if (key.length < 3) return [];
  const hits = [];
  for (const [area, srcs] of Object.entries(directory)) {
    const found = srcs.filter((s) => s.text.includes(key)).map((s) => s.name);
    if (found.length) hits.push({ area, sources: found });
  }
  return hits;
}

const { brandAreas, brandOf, categoryOf, isDuplicate, addExisting } = createCatalogTools(items);

// ---- 追加 ----
const grid = countCells(items);
const needs = (cat, tier, areas) => areas.some((a) => isMajorCell(cat, tier, a) && grid[a][cat][tier] < FILL_UP_TO);
const seenCodes = new Set();
const perBrand = {};
let nextId = Math.max(...items.map((i) => Number(i.id.split("-")[1]))) + 1;
const added = [];
const skipped = { noise: 0, noArea: 0, duplicate: 0, cellFull: 0, brandCap: 0 };

for (const r of [...ranking].sort((a, b) => a.rank - b.rank)) {
  if (!r.itemName || !r.itemPrice || seenCodes.has(r.itemCode)) continue;
  seenCodes.add(r.itemCode);
  if (OFF_GENRE.test(r.genre_name)) { skipped.noise++; continue; }
  if (NOISE_NAME.test(r.itemName) || r.itemPrice < 800 || r.itemPrice > 30000) { skipped.noise++; continue; }
  const brand = brandOf(r);
  const name = cleanName(r.itemName);
  if (!brand || name.length < 4) { skipped.noise++; continue; }
  if (normalize(name.replace(brand, "")).replace(/オリジナル|詰合せ|セット/g, "").length < 3) { skipped.noise++; continue; }
  const dirHits = areasFor(brand);
  // 公式ショップ一覧にない地元の店は同名の別店と区別できないため、店名・商品名に地名があるときだけ採用
  if (!dirHits.length) {
    const places = [...(brandAreas[brand] ?? [])].flatMap((a) => areaLabel[a].replace(/\(.*\)/, "").split("・"));
    if (!places.some((p) => `${r.shopName}${r.itemName}`.includes(p))) { skipped.noArea++; continue; }
  }
  const known = [...(brandAreas[brand] ?? [])].filter((a) => !dirHits.some((h) => h.area === a)).map((a) => ({ area: a, sources: [] }));
  const hits = [...dirHits, ...known];
  if (!hits.length) { skipped.noArea++; continue; }
  if (isDuplicate(brand, name)) { skipped.duplicate++; continue; }
  const cat = categoryOf(r, name, brand);
  const tier = tierOf(r.itemPrice);
  const areas = hits.map((h) => h.area);
  if (!needs(cat, tier, areas)) { skipped.cellFull++; continue; }
  if ((perBrand[brand] ?? 0) >= MAX_NEW_PER_BRAND) { skipped.brandCap++; continue; }

  const attr = attributesOf(r, name);
  const short = name.replaceAll(brand, "").replaceAll(brand.replace(/\s/g, ""), "").replace(/\s+/g, " ").trim() || name;
  const sources = [...new Set(hits.flatMap((h) => h.sources))];
  const item = {
    id: `tokyo-${String(nextId++).padStart(3, "0")}`,
    name: `${brand} ${short}`,
    brand_name: brand,
    category: cat,
    price_tax_in: r.itemPrice,
    price_tier: tier,
    target_scenes: scenesFor(r.itemPrice),
    areas,
    is_individually_wrapped: attr.is_individually_wrapped,
    piece_count: attr.piece_count,
    temperature: attr.temperature,
    shelf_life_days: attr.shelf_life_days,
    is_sweet: cat === "wagashi" || cat === "yogashi",
    evening_availability: "medium",
    bag_size: r.itemPrice < 3000 ? "compact_a4" : "standard",
    handoff_script: `${brand}の${short}です。${attr.is_individually_wrapped ? "個包装なので、皆さんで分けていただけたらと思います。" : attr.temperature === "chilled" ? "冷蔵庫でお早めにお召し上がりください。" : "よろしければ皆さんで召し上がってください。"}`,
    why_recommended: `楽天市場ランキング「${r.genre_name}」${r.rank}位。${sources.length ? `${sources.join("・")}に店舗あり。` : ""}${attr.shelf_life_known ? "" : "日持ちは未確認。"}`,
    shops: hits.flatMap((h) =>
      (h.sources.length ? h.sources : [`${areaLabel[h.area]}周辺の店舗`]).map((s) => ({
        area_id: h.area,
        shop_name: `${brand}（${s}）`,
        access_note: `${s}内（売場は公式サイトで確認）`,
        open_hours: "施設の営業時間に準じる",
        phone: null,
        google_maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${brand} ${s}`)}`,
      })),
    ),
    search_keyword: `${brand} ${short}`.slice(0, 60),
    image_url: r.image ? String(r.image).replace(/\?_ex=\d+x\d+/, "?_ex=300x300") : null,
    rakuten_item_url: r.url,
    jan_code: null,
    data_status: "draft",
  };
  items.push(item);
  addExisting(brand, item.name);
  for (const a of areas) grid[a][cat][tier]++;
  perBrand[brand] = (perBrand[brand] ?? 0) + 1;
  added.push(item);
  console.log(`ADD ${item.id} [${cat}/${tier}] ${item.name} ¥${item.price_tax_in} → ${areas.map((a) => areaLabel[a]).join(",")}`);
}

console.log(`\n追加 ${added.length}件 / 除外: ノイズ${skipped.noise} 店舗確認不可${skipped.noArea} 重複${skipped.duplicate} マス充足${skipped.cellFull} ブランド上限${skipped.brandCap}`);
if (DRY) {
  console.log("--dry-run のため items.json は変更していません");
} else {
  writeFileSync(ITEMS_PATH, JSON.stringify(items, null, 2) + "\n");
  execFileSync(process.execPath, ["scripts/coverage.mjs"], { stdio: "inherit" });
}
