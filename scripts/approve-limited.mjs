// data/candidates.json の候補を確認して、OKしたものだけ items.json に追加する
// 使い方:
//   npm run list:limited                       確認待ちの候補を番号付きで表示
//   npm run approve:limited -- 1 3 5           番号（または候補ID）を指定して追加
//   npm run approve:limited -- --approved      candidates.json で status を "approved" にしたものを追加
//   npm run approve:limited -- --reject 2 4    却下（次回の収集でも表示しない）
//   日付の上書き: npm run approve:limited -- 1 --until=2026-12-25 --from=2026-10-01
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { AREAS, tierOf } from "./lib/catalog.mjs";
import { attributesOf, scenesFor } from "./lib/candidate-utils.mjs";

const OUT = "data/candidates.json";
if (!existsSync(OUT)) {
  console.error(`${OUT} がありません。先に npm run collect:limited を実行してください`);
  process.exit(1);
}
const file = JSON.parse(readFileSync(OUT, "utf8"));
const pending = file.candidates.filter((c) => c.status === "pending");
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const areaLabel = Object.fromEntries(AREAS);

// ---- 一覧 ----
if (args.includes("--list") || args.length === 0) {
  if (!pending.length) {
    console.log("確認待ちの候補はありません");
    process.exit(0);
  }
  console.log(`確認待ち ${pending.length} 件（${file.updated} 時点）\n`);
  pending.forEach((c, i) => {
    const period = c.available_from || c.available_until ? `${c.available_from ?? ""}〜${c.available_until ?? ""}` : "期間不明";
    const tags = [c.is_limited && "限定", c.is_new && "新"].filter(Boolean).join("/");
    console.log(`${String(i + 1).padStart(3)}. [${tags}] ${c.name}  ¥${c.price.toLocaleString("ja-JP")}  ${period}`);
    if (c.date_evidence) console.log(`      根拠: 「${c.date_evidence}」`);
    console.log(`      ${c.url}`);
  });
  console.log("\n追加: npm run approve:limited -- 1 3 5   却下: npm run approve:limited -- --reject 2 4");
  process.exit(0);
}

// 番号または候補IDで指定
const pick = (tokens) =>
  tokens
    .filter((t) => !t.startsWith("--"))
    .map((t) => (/^\d+$/.test(t) ? pending[Number(t) - 1] : file.candidates.find((c) => c.id === t)))
    .filter(Boolean);

// ---- 却下 ----
if (args.includes("--reject")) {
  const targets = pick(args);
  for (const c of targets) c.status = "rejected";
  writeFileSync(OUT, JSON.stringify(file, null, 2) + "\n");
  console.log(`${targets.length} 件を却下しました`);
  process.exit(0);
}

// ---- 追加 ----
const targets = args.includes("--approved") ? file.candidates.filter((c) => c.status === "approved") : pick(args);
if (!targets.length) {
  console.error("追加する候補がありません。npm run list:limited で番号を確認してください");
  process.exit(1);
}

const ITEMS = "src/data/items.json";
const items = JSON.parse(readFileSync(ITEMS, "utf8"));
let nextId = Math.max(...items.map((i) => Number(i.id.split("-")[1]))) + 1;

for (const c of targets) {
  // 店舗とエリアは、同じブランドの収録済み商品から引き継ぐ（期間限定品は通常品と同じ店で売られるため）
  const sameBrand = items.filter((i) => i.brand_name === c.brand);
  const shops = [...new Map(sameBrand.flatMap((i) => i.shops).map((s) => [`${s.area_id}|${s.shop_name}`, s])).values()];
  const areas = [...new Set(sameBrand.flatMap((i) => i.areas))];
  if (!areas.length) {
    console.log(`SKIP ${c.name}: 同じブランドの収録商品がないため、売っている場所が分かりません`);
    continue;
  }
  const attr = attributesOf({ itemName: c.raw_name ?? c.name, itemCaption: "" }, c.name);
  const until = flag("until") ?? c.available_until ?? undefined;
  const from = flag("from") ?? c.available_from ?? undefined;
  const short = c.name.replaceAll(c.brand, "").trim() || c.name;
  const item = {
    id: `tokyo-${String(nextId++).padStart(3, "0")}`,
    name: c.name,
    brand_name: c.brand,
    category: c.category,
    price_tax_in: c.price,
    price_tier: tierOf(c.price),
    target_scenes: scenesFor(c.price),
    areas,
    is_individually_wrapped: attr.is_individually_wrapped,
    piece_count: attr.piece_count,
    temperature: attr.temperature,
    shelf_life_days: attr.shelf_life_days,
    is_sweet: c.category === "wagashi" || c.category === "yogashi",
    evening_availability: "medium",
    bag_size: c.price < 3000 ? "compact_a4" : "standard",
    handoff_script: c.is_limited
      ? `${c.brand}の${short}です。今の時期だけのものなので、ぜひ召し上がってください。`
      : `${c.brand}の新しい${short}です。出たばかりのものなので選んでみました。`,
    why_recommended: `${c.is_limited ? "期間限定" : "新商品"}（楽天市場「${c.keyword}」で収集）。店舗での取扱いと販売期間は公式で確認を。`,
    shops,
    search_keyword: `${c.brand} ${short}`.slice(0, 60),
    image_url: c.image ? String(c.image).replace(/\?_ex=\d+x\d+/, "?_ex=300x300") : null,
    rakuten_item_url: c.url,
    jan_code: null,
    data_status: "draft",
    is_limited: Boolean(c.is_limited),
    ...(from ? { available_from: from } : {}),
    ...(until ? { available_until: until } : {}),
  };
  items.push(item);
  c.status = "added";
  c.item_id = item.id;
  console.log(`ADD ${item.id} ${item.name} ¥${item.price_tax_in} ${until ? `〜${until}` : "（期限なし）"} → ${areas.map((a) => areaLabel[a]).join(",")}`);
}

writeFileSync(ITEMS, JSON.stringify(items, null, 2) + "\n");
writeFileSync(OUT, JSON.stringify(file, null, 2) + "\n");
execFileSync(process.execPath, ["scripts/coverage.mjs"], { stdio: "inherit" });
