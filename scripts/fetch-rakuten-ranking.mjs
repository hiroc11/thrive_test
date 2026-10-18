// 楽天市場ランキングAPIで、手土産ジャンルの売れ筋を scripts/out/ranking.json に保存する
// 使い方: npm run fetch:ranking   (楽天APIは許可IPのMacから実行)
import { writeFileSync, mkdirSync } from "node:fs";
import { env, requireKeys, firstWorking, rakutenGet, AFF_ID } from "./lib/rakuten.mjs";

requireKeys();
const PAGES = Number(env("RANKING_PAGES", "3")); // 1ページ30件

const BASE = "https://openapi.rakuten.co.jp";
const RANKING_URLS = [env("RAKUTEN_RANKING_URL"), ...["20260701", "20220601"].map((v) => `${BASE}/ichibaranking/api/IchibaItem/Ranking/${v}`)].filter(Boolean);
const GENRE_URLS = [env("RAKUTEN_GENRE_URL"), ...["20260701", "20220601", "20140222"].flatMap((v) => [`${BASE}/ichibagt/api/IchibaGenre/Search/${v}`, `${BASE}/ichibams/api/IchibaGenre/Search/${v}`])].filter(Boolean);

// 大ジャンル（楽天市場の公開ジャンルID）。子ジャンルはジャンル検索APIで名前から選ぶ
const ROOTS = [
  { id: 551167, category: null }, // スイーツ・お菓子（子ジャンル名で和菓子/洋菓子/甘くない系に振り分け）
  { id: 510901, category: "drink" }, // 日本酒・焼酎
  { id: 100316, category: "drink" }, // 水・ソフトドリンク（お茶・コーヒー）
];
const CHILD_RULES = [
  [/和菓子|羊羹|どら焼|最中|饅頭|まんじゅう|団子|甘納豆/, "wagashi"],
  [/せんべい|煎餅|おかき|あられ|米菓|珍味|おつまみ|佃煮/, "savory"],
  [/洋菓子|焼き菓子|クッキー|ケーキ|チョコ|バウム|フィナンシェ|ラスク|ゼリー|プリン/, "yogashi"],
  [/日本茶|緑茶|コーヒー|紅茶|日本酒|焼酎|梅酒/, "drink"],
];
const classify = (name, fallback) => CHILD_RULES.find(([re]) => re.test(name))?.[1] ?? fallback;

async function genreTargets() {
  const targets = [];
  let genreUrl = null;
  for (const root of ROOTS) {
    try {
      const { url, data } = genreUrl
        ? { url: genreUrl, data: await rakutenGet(genreUrl, { genreId: String(root.id) }) }
        : await firstWorking("genre", GENRE_URLS, { genreId: String(root.id) });
      genreUrl = url;
      mkdirSync("scripts/out", { recursive: true });
      writeFileSync(`scripts/out/genre-${root.id}.json`, JSON.stringify(data, null, 2)); // 応答の形の確認用
      // 版によって children の形が違うので、名前とIDを持つオブジェクトを探して読む
      const pick = (o) => {
        if (!o || typeof o !== "object") return null;
        const id = o.genreId ?? o.id;
        const name = o.genreName ?? o.name;
        if (id && name) return { id, name };
        for (const v of Object.values(o)) {
          const r = pick(v);
          if (r) return r;
        }
        return null;
      };
      const children = (data.children ?? data.Children ?? []).map(pick).filter(Boolean);
      // 大ジャンル自体も対象に含める（子ジャンルを分類できなくても売れ筋を拾うため）
      targets.push({ id: root.id, name: pick(data.current ?? data.parents?.[0])?.name ?? `genre ${root.id}`, category: root.category ?? "yogashi" });
      for (const c of children) {
        const category = classify(c.name, root.category);
        if (category) targets.push({ id: c.id, name: c.name, category });
      }
    } catch (e) {
      console.log(`ジャンル検索APIが使えないため大ジャンル ${root.id} のランキングだけ使います (${e.message.slice(0, 80)})`);
      targets.push({ id: root.id, name: `genre ${root.id}`, category: root.category ?? "yogashi" });
    }
  }
  return targets;
}

const targets = await genreTargets();
console.log(`対象ジャンル: ${targets.map((t) => `${t.name}(${t.category})`).join(", ")}`);

const out = [];
let rankingUrl = null;
for (const t of targets) {
  for (let page = 1; page <= PAGES; page++) {
    try {
      const params = { genreId: String(t.id), page: String(page), ...(AFF_ID ? { affiliateId: AFF_ID } : {}) };
      const data = rankingUrl
        ? await rakutenGet(rankingUrl, params)
        : await firstWorking("ranking", RANKING_URLS, params).then((r) => ((rankingUrl = r.url), r.data));
      const items = data.Items ?? [];
      for (const it of items) {
        const i = it.Item ?? it;
        out.push({
          genre_id: t.id, genre_name: t.name, category: t.category, rank: Number(i.rank),
          itemName: i.itemName, itemPrice: Number(i.itemPrice), itemCaption: (i.itemCaption ?? "").slice(0, 600),
          shopName: i.shopName, shopCode: i.shopCode, itemCode: i.itemCode,
          image: (i.mediumImageUrls?.[0]?.imageUrl ?? i.mediumImageUrls?.[0] ?? null),
          url: i.affiliateUrl || i.itemUrl,
        });
      }
      console.log(`OK  ${t.name} p${page}: ${items.length}件`);
      if (items.length < 30) break;
    } catch (e) {
      console.log(`NG  ${t.name} p${page}: ${e.message}`);
      break;
    }
  }
}

mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/ranking.json", JSON.stringify(out, null, 2) + "\n");
console.log(`scripts/out/ranking.json に ${out.length} 件保存しました`);
