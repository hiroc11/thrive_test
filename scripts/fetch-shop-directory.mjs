// 駅ナカ・百貨店の公式ショップ一覧（scripts/shop-sources.json）を取得し、本文テキストを scripts/out/shop-directory.json に保存する
// import-candidates.mjs はここにブランド名が載っているかで「そのエリアで買える」と判定する
// 使い方: npm run fetch:shops
//         npm run fetch:shops -- --browser   (一覧を後から読み込むサイト用。初回のみ npx playwright install chromium が必要)
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

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en;q=0.8",
};

// --browser: 本物のブラウザで開き、JavaScriptで後から描画される一覧まで読む
let browser = null;
if (process.argv.includes("--browser")) {
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
  } catch {
    console.error("Playwright が使えません。npm i -D playwright && npx playwright install chromium を実行してください");
    process.exit(1);
  }
}

async function get(url) {
  if (browser) {
    const page = await browser.newPage({ userAgent: HEADERS["User-Agent"], locale: "ja-JP" });
    try {
      const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      if (res && !res.ok()) throw new Error(String(res.status()));
      await page.waitForTimeout(1500);
      return await page.content();
    } finally {
      await page.close();
    }
  }
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

// url は1つでも候補の配列でもよい（最初に取得できたものを使う）
async function getFirst(urls) {
  let lastErr;
  for (const u of [].concat(urls)) {
    try {
      return { url: u, html: await get(u) };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const out = {};
for (const [area, list] of Object.entries(sources)) {
  if (area.startsWith("_")) continue;
  out[area] = [];
  for (const src of list) {
    const pages = [];
    try {
      const { url, html } = await getFirst(src.url);
      pages.push(toText(html));
      // ショップ一覧が複数ページ・フロア別に分かれている場合に備え、同じサイト内のショップ系リンクを辿る
      const base = new URL(url);
      const links = [...html.matchAll(/href="([^"#]+)"/g)]
        .map((m) => { try { return new URL(m[1], base); } catch { return null; } })
        .filter((u) => u && u.host === base.host && /shop|floor|brand|store|gourmet|sweets|food/i.test(u.pathname))
        .map((u) => u.href);
      for (const link of [...new Set(links)].slice(0, MAX_SUBPAGES)) {
        await sleep(800);
        try { pages.push(toText(await get(link))); } catch {}
      }
      const text = pages.join(" ");
      out[area].push({ name: src.name, url, pages: pages.length, text: normalize(text) });
      console.log(`OK  ${area} ${src.name}: ${pages.length}ページ / ${text.length}文字`);
    } catch (e) {
      out[area].push({ name: src.name, url: [].concat(src.url)[0], pages: 0, text: "", error: e.message });
      console.log(`NG  ${area} ${src.name}: ${e.message}（scripts/shop-sources.json のURLを確認してください）`);
    }
    await sleep(800);
  }
}

await browser?.close();
mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/shop-directory.json", JSON.stringify(out) + "\n");
console.log("scripts/out/shop-directory.json を保存しました");
