// 主要ブランド × 「期間限定 / 季節限定 / 新発売」を楽天市場で検索し、items.json にまだない商品を
// data/candidates.json に候補として書き出す。items.json には追加しない（npm run approve:limited で追加）
// 使い方: npm run collect:limited                (楽天APIは許可IPのMacから実行)
//         npm run collect:limited -- --brands=30  (検索するブランド数。既定 60)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { env, requireKeys, rakutenGet, AFF_ID } from "./lib/rakuten.mjs";
import { NOISE_NAME, cleanName, createCatalogTools } from "./lib/candidate-utils.mjs";
import { normalize } from "./lib/catalog.mjs";
import { detectDates, LIMITED_WORDS, NEW_WORDS } from "./lib/limited-dates.mjs";

requireKeys();
const SEARCH_URL = env("RAKUTEN_SEARCH_URL", `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/${env("RAKUTEN_API_VERSION", "20260701")}`);
const KEYWORDS = ["期間限定", "季節限定", "新発売"];
const BRANDS = Number(process.argv.find((a) => a.startsWith("--brands="))?.split("=")[1] ?? 60);
const OUT = "data/candidates.json";
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

const items = JSON.parse(readFileSync("src/data/items.json", "utf8"));
const { brandOf, categoryOf, isDuplicate } = createCatalogTools(items);
const knownUrls = new Set(items.map((i) => i.rakuten_item_url).filter(Boolean));

// 楽天に公式店がありそうなブランド（画像が取れた商品があるブランド）を、収録商品数の多い順に
const counts = {};
for (const i of items) if (i.image_url && normalize(i.brand_name).length >= 3) counts[i.brand_name] = (counts[i.brand_name] ?? 0) + 1;
const brands = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, BRANDS).map(([b]) => b);

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { candidates: [] };
const byId = new Map(previous.candidates.map((c) => [c.id, c]));
let found = 0, fresh = 0, n = 0;
const total = brands.length * KEYWORDS.length;
console.log(`検索 ${total} 件（約${Math.ceil((total * 1.1) / 60)}分）`);

for (const brand of brands) {
  for (const kw of KEYWORDS) {
    n++;
    try {
      const data = await rakutenGet(SEARCH_URL, {
        keyword: `${brand} ${kw}`, hits: "10", imageFlag: "1", availability: "1",
        sort: kw === "新発売" ? "-updateTimestamp" : "standard",
        ...(AFF_ID ? { affiliateId: AFF_ID } : {}),
      });
      let kept = 0;
      for (const raw of data.Items ?? []) {
        const r = raw.Item ?? raw;
        const text = `${r.itemName} ${r.itemCaption ?? ""}`;
        if (NOISE_NAME.test(r.itemName) || r.itemPrice < 800 || r.itemPrice > 30000) continue;
        if (brandOf(r) !== brand) continue; // 公式店の商品だけ
        const isLimited = LIMITED_WORDS.test(text);
        const isNew = NEW_WORDS.test(r.itemName);
        if (!isLimited && !isNew) continue; // 検索語が商品にかかっていないもの（通常品）は除く
        const name = cleanName(r.itemName);
        const url = r.affiliateUrl || r.itemUrl;
        if (knownUrls.has(url) || isDuplicate(brand, name)) continue;
        const dates = detectDates(text, today);
        const prev = byId.get(r.itemCode);
        byId.set(r.itemCode, {
          id: r.itemCode,
          status: prev?.status ?? "pending", // pending / approved / rejected / added
          brand,
          name: name.includes(brand) ? name : `${brand} ${name.replaceAll(brand, "").trim()}`,
          raw_name: r.itemName,
          category: categoryOf({ ...r, genre_name: "検索:" }, name, brand),
          price: Number(r.itemPrice),
          is_limited: isLimited,
          is_new: isNew,
          available_from: dates.available_from,
          available_until: dates.available_until,
          date_evidence: dates.evidence,
          keyword: kw,
          shop: r.shopName,
          image: r.mediumImageUrls?.[0]?.imageUrl ?? r.mediumImageUrls?.[0] ?? null,
          url,
          first_seen: prev?.first_seen ?? today,
          last_seen: today,
        });
        kept++;
        if (!prev) fresh++;
      }
      found += kept;
      console.log(`OK  [${n}/${total}] ${brand} ${kw}: ${kept}件`);
    } catch (e) {
      console.log(`NG  [${n}/${total}] ${brand} ${kw}: ${e.message}`);
    }
  }
}

// 期限切れの候補は残しても使えないので落とす（追加済み・却下済みは記録として残す）
const candidates = [...byId.values()]
  .filter((c) => !(c.status === "pending" && c.available_until && c.available_until < today))
  .sort((a, b) => (a.status === b.status ? a.brand.localeCompare(b.brand, "ja") : a.status === "pending" ? -1 : 1));
mkdirSync("data", { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: today, candidates }, null, 2) + "\n");
const pending = candidates.filter((c) => c.status === "pending").length;
console.log(`\n${OUT} を更新: 今回 ${found} 件（新規 ${fresh} 件）、確認待ち ${pending} 件`);
console.log("確認: npm run list:limited / 追加: npm run approve:limited -- 1 3 5");
