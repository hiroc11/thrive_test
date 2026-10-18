// 楽天ランキング(scripts/out/ranking.json) × 公式ショップ一覧(scripts/out/shop-directory.json) から、
// 不足しているマスを埋める商品を src/data/items.json に draft として追加する
// 採用条件: 楽天で販売中（＝実在）かつ、ブランド名がそのエリアの公式ショップ一覧に載っていること
// 使い方: npm run import:candidates   (--dry-run で追加せず候補だけ表示)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { AREAS, TARGET_PER_CELL, countCells, isMajorCell, normalize, tierOf } from "./lib/catalog.mjs";

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

// ---- 正規化 ----
const NOISE_NAME = /タンブラー|マグカップ|マグ$|ドリッパー|キャニスター|グラス|食器|器具|ポーチ単品|トートバッグ|エコバッグ|ギフト券|カタログギフト|訳あり|わけあり|お試し|業務用|大容量|アウトレット|福袋|ふるさと納税|定期便|まとめ買い|\d+箱セット|ケース販売|ポイント\d+倍|クーポン/;
// 手土産にならない飲料ジャンル（ランキング取得時に大ジャンル配下として混ざる）
const OFF_GENRE = /^(水・炭酸水|炭酸飲料|スポーツドリンク|野菜・果実飲料|スムージー|お酢飲料|牛乳|植物性ミルク|フルーツ入り乳飲料|乳性・乳酸菌飲料|ゼリー飲料|希釈用ドリンク|氷|ノンアルコール|ココア・チョコレートドリンク|その他|水・ソフトドリンク)$/;
const PROMO = /^(?:保存食|惣菜|そうざい|小袋|小分け|お弁当|帰省土産|食品|時短|オフィス|ご家庭料理|おつまみ|七五三|老舗|健康|敬老|グルメ|土産|新生活|祝い|国内生産|定番|ご飯のお供|毎日の食卓|食べ比べセット|単品|贈答用|保存料\S*|日本産|20\d\d|[A-Z]{1,3}-?\d{1,4}|送料込み?|帰省|お年賀|御年賀|贈答品?|お見舞い?|数量|限定|お菓子|洋菓子|和菓子|焼き菓子|東京|銀座|日本橋|誕生日|退職|お世話になりました|お礼|御礼|産休|お供え|御供|供物|菓子折り?|高級|詰め合わせ|お取り寄せ|ハロウィン|クリスマス|新年|年末年始|春|夏|秋|冬|出産|結婚|新築|快気|法事|香典返し|買い回り|買いまわり|酒蔵直送|直送|地酒|人気|おしゃれ|かわいい|プチギフト|ばらまき|個包装|小袋サイズ|※\S*|≪|≫|＜|＞|<|>|\.|\/)$/; // 単語単位で一致したら除く（「銀座あけぼの」の「銀座」は消さない）
const PROMO_IN = /お年賀|御年賀|お歳暮|御歳暮|お中元|敬老|七五三|ハロウィン|新生活/g;
const cleanName = (s) =>
  s
    .replace(/[＜＞<>『』]/g, " ")
    .replace(/(^|\s)[.．・]+/g, " ")
    .replace(PROMO_IN, "")
    .split(/[\s　]+/)
    .map((w) => w.replace(/[｜|].*$/, "").replace(/[（(][^）)]*[）)]?|^[^（(]*[）)]/g, ""))
    .filter((w, i, arr) => w && !PROMO.test(w) && arr.indexOf(w) === i)
    .join(" ")
    .replace(/【[^】]*】|［[^］]*］|\[[^\]]*\]|《[^》]*》|★[^★]*★|◆[^◆]*◆/g, " ")
    .replace(/送料無料|楽天ランキング\S*|ランキング\d*位?|あす楽|公式|ギフト|プレゼント|お祝い|内祝い?|お返し|お中元|お歳暮|御中元|御歳暮|母の日|父の日|敬老の日|ホワイトデー|バレンタイン|手土産|お土産|贈り物|スイーツ|お菓子|のし|熨斗|対応|可能|個包装|個装|常温便?|日持ち\S*|賞味期限\S*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .reduce((acc, w) => ((acc + " " + w).trim().length <= 36 ? (acc + " " + w).trim() : acc), "");
const shopToBrand = (shop) =>
  shop
    .replace(/楽天市場店|楽天市場|楽天店|公式オンラインショップ|オンラインショップ|公式ショップ|公式通販|オンラインストア|通販|本店|ショップ|SHOP|Online|ONLINE|公式/g, "")
    .replace(/[【】\[\]（）()]/g, " ")
    .trim();

// 精度優先: 既に収録しているブランドの商品だけを採用する（ショップ一覧の本文に偶然含まれる語で誤判定するのを防ぐ）
// 「空也」のような2文字のブランドは他の語に紛れて誤一致するため対象外
const knownBrands = [...new Set(items.map((i) => i.brand_name))]
  .filter((b) => normalize(b).length >= 3)
  .sort((a, b) => b.length - a.length);
const brandAreas = {};
for (const i of items) for (const a of i.areas) (brandAreas[i.brand_name] ??= new Set()).add(a);
function brandOf(r) {
  const name = normalize(r.itemName), shop = normalize(r.shopName);
  // 商品名にブランド名があり、かつ公式店（店名にもブランド名）であること
  return knownBrands.find((b) => name.includes(normalize(b)) && shop.includes(normalize(b).slice(0, 4))) ?? null;
}

function categoryOf(r, name) {
  if (/せんべい|煎餅|おかき|あられ|佃煮|つくだ煮|海苔|のり|おつまみ|珍味|かつお節|鰹節|だし|カレー|スープ|和牛|牛肉|すき焼|しゃぶしゃぶ/.test(name)) return "savory";
  if (/羊羹|ようかん|最中|もなか|どら焼|どらやき|大福|団子|だんご|饅頭|まんじゅう|甘納豆|わらび|きんつば|金鍔/.test(name)) return "wagashi";
  if (/日本茶|緑茶|煎茶|ほうじ茶|抹茶ティー|コーヒー|珈琲|紅茶|日本酒|純米|吟醸|焼酎|梅酒/.test(name)) return "drink";
  return r.category;
}

function attributesOf(r, name) {
  const t = `${r.itemName} ${r.itemCaption}`;
  const shelf = Number(t.match(/(?:賞味期限|日持ち|消費期限)[^\d]{0,12}(\d{1,3})\s*日/)?.[1] ?? t.match(/製造日?(?:から|より)[^\d]{0,5}(\d{1,3})\s*日/)?.[1] ?? 0);
  const chilled = /要冷蔵|冷蔵便|冷凍便|要冷凍|クール便|和牛|牛肉|生菓子/.test(t);
  const pieces = name.match(/\d+\s*(個|枚|本|袋|粒|切|缶|箱)(入り?)?/)?.[0] ?? "詰合せ";
  return {
    is_individually_wrapped: /個包装|個装|個別包装/.test(t),
    piece_count: pieces,
    temperature: chilled ? "chilled" : "ambient",
    shelf_life_days: shelf || (chilled ? 3 : 14),
    shelf_life_known: Boolean(shelf),
  };
}

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

const scenesFor = (price) =>
  price < 3000 ? ["female_office", "casual_party", "in_laws"] : price < 5000 ? ["business_exec", "in_laws", "female_office"] : ["business_exec", "in_laws"];

// ---- 重複判定 ----
const bigrams = (s) => new Set([...Array(Math.max(0, s.length - 1))].map((_, i) => s.slice(i, i + 2)));
const similar = (a, b) => {
  const A = bigrams(a), B = bigrams(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(1, Math.min(A.size, B.size));
};
// ブランド名を除いた商品名で比べる。入数が違えば別商品（価格帯が変わるため）
const core = (brand, name) => normalize(name.replace(brand, ""));
const countOf = (name) => name.normalize("NFKC").match(/\d+\s*(個|枚|本|袋|粒|切|缶|箱|棹)/)?.[0] ?? "";
const existing = items.map((i) => ({ brand: normalize(i.brand_name), core: core(i.brand_name, i.name), count: countOf(i.name) }));
const isDuplicate = (brand, name) =>
  existing.some((e) => e.brand === normalize(brand) && e.count === countOf(name) && similar(e.core, core(brand, name)) > 0.6);

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
  const cat = categoryOf(r, name);
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
  existing.push({ brand: normalize(brand), core: core(brand, item.name), count: countOf(item.name) });
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
