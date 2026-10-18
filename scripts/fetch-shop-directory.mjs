// 駅ナカ・百貨店の公式ショップ一覧（scripts/shop-sources.json）を取得し、本文テキストを scripts/out/shop-directory.json に保存する
// import-candidates.mjs はここにブランド名が載っているかで「そのエリアで買える」と判定する
// 使い方: npm run fetch:shops
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { normalize } from "./lib/catalog.mjs";

const sources = JSON.parse(readFileSync("scripts/shop-sources.json", "utf8"));
const MAX_SUBPAGES = 25; // 1サイトあたり、一覧から辿るページ数の上限
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&#\d+;|&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TEMIYAGE coverage check)" }, redirect: "follow" });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

const out = {};
for (const [area, list] of Object.entries(sources)) {
  if (area.startsWith("_")) continue;
  out[area] = [];
  for (const src of list) {
    const pages = [];
    try {
      const html = await get(src.url);
      pages.push(toText(html));
      // ショップ一覧が複数ページ・フロア別に分かれている場合に備え、同じサイト内のショップ系リンクを辿る
      const base = new URL(src.url);
      const links = [...html.matchAll(/href="([^"#]+)"/g)]
        .map((m) => { try { return new URL(m[1], base); } catch { return null; } })
        .filter((u) => u && u.host === base.host && /shop|floor|brand|store|gourmet|sweets|food/i.test(u.pathname))
        .map((u) => u.href);
      for (const link of [...new Set(links)].slice(0, MAX_SUBPAGES)) {
        await sleep(800);
        try { pages.push(toText(await get(link))); } catch {}
      }
      const text = pages.join(" ");
      out[area].push({ name: src.name, url: src.url, pages: pages.length, text: normalize(text) });
      console.log(`OK  ${area} ${src.name}: ${pages.length}ページ / ${text.length}文字`);
    } catch (e) {
      out[area].push({ name: src.name, url: src.url, pages: 0, text: "", error: e.message });
      console.log(`NG  ${area} ${src.name}: ${e.message}（scripts/shop-sources.json のURLを確認してください）`);
    }
    await sleep(800);
  }
}

mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/shop-directory.json", JSON.stringify(out) + "\n");
console.log("scripts/out/shop-directory.json を保存しました");
