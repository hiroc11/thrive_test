// エリア × ジャンル × 予算 の網羅状況を docs/coverage.md に書き出す
// 使い方: npm run coverage            (比較の基準は docs/coverage-baseline.json)
//         npm run coverage -- --baseline   (今の状態を基準として保存し直す)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { AREAS, GENRES, TIERS, TARGET_PER_CELL, LOCAL_AREAS, countCells, isMajorCell } from "./lib/catalog.mjs";

const items = JSON.parse(readFileSync("src/data/items.json", "utf8"));
const grid = countCells(items);
const BASE = "docs/coverage-baseline.json";
mkdirSync("docs", { recursive: true });
if (process.argv.includes("--baseline") || !existsSync(BASE)) {
  writeFileSync(BASE, JSON.stringify({ created: new Date().toISOString().slice(0, 10), total: items.length, grid }, null, 2) + "\n");
}
const base = JSON.parse(readFileSync(BASE, "utf8"));

const cell = (n, b, major) => {
  const diff = n - b > 0 ? ` (+${n - b})` : "";
  const mark = n === 0 ? (major ? "**0**" : "0") : n === 1 ? (major ? "*1*" : "1") : String(n);
  return mark + diff;
};

const majorCells = (g) => AREAS.flatMap(([a]) => GENRES.flatMap(([ge]) => TIERS.filter(([t]) => isMajorCell(ge, t, a)).map(([t]) => g[a][ge][t])));
const summarize = (g) => {
  const m = majorCells(g);
  return { empty: m.filter((n) => n === 0).length, one: m.filter((n) => n === 1).length, ok: m.filter((n) => n >= TARGET_PER_CELL).length, total: m.length };
};
const now = summarize(grid), before = summarize(base.grid);

const lines = [];
lines.push("# 手土産データの網羅状況", "");
lines.push(`自動生成: \`npm run coverage\`（${new Date().toISOString().slice(0, 10)}）。手で編集しないでください。`, "");
lines.push("## サマリー", "");
lines.push("| | 基準時点（" + base.created + "） | 現在 |", "|---|---:|---:|");
lines.push(`| 商品数 | ${base.total} | ${items.length} |`);
lines.push(`| 主要マス数 | ${before.total} | ${now.total} |`);
lines.push(`| 目標（${TARGET_PER_CELL}品以上）を満たすマス | ${before.ok} | ${now.ok} |`);
lines.push(`| 1品しかないマス | ${before.one} | ${now.one} |`);
lines.push(`| 空のマス | ${before.empty} | ${now.empty} |`, "");
lines.push("主要マス = 予算1万円未満のマス（お酒・お茶の5千〜1万を除く）。ただし商店街・老舗中心のエリア（" + AREAS.filter(([a]) => LOCAL_AREAS.has(a)).map(([, l]) => l).join("・") + "）は和菓子・甘くない系の5千円未満のみ。基準時点の数字も同じ定義で数え直しています。", "");
lines.push("## 表の見方", "");
lines.push("- 数字はそのマスに入る商品数（1商品が複数エリアで買える場合は各エリアで数える）");
lines.push("- **0** = 主要マスで空、*1* = 主要マスで1品のみ、(+n) = 基準時点からの増加");
lines.push("");

// エリアごとの不足一覧
lines.push("## 不足している主要マス（エリア別）", "");
for (const [a, label] of AREAS) {
  const gaps = GENRES.flatMap(([g, gl]) => TIERS.filter(([t]) => isMajorCell(g, t, a) && grid[a][g][t] < TARGET_PER_CELL).map(([t, tl]) => `${gl} ${tl}(${grid[a][g][t]})`));
  lines.push(`- **${label}**${LOCAL_AREAS.has(a) ? "（地元エリア）" : ""}: ${gaps.length ? gaps.join(" / ") : "不足なし"}`);
}
lines.push("");

lines.push("## エリア × ジャンル × 予算", "");
lines.push("| エリア | ジャンル | " + TIERS.map(([, l]) => l).join(" | ") + " |");
lines.push("|---|---|" + TIERS.map(() => "---:").join("|") + "|");
for (const [a, label] of AREAS) {
  GENRES.forEach(([g, gl], idx) => {
    const cells = TIERS.map(([t]) => cell(grid[a][g][t], base.grid[a]?.[g]?.[t] ?? 0, isMajorCell(g, t, a)));
    lines.push(`| ${idx === 0 ? `**${label}**` : ""} | ${gl} | ${cells.join(" | ")} |`);
  });
}
lines.push("");
writeFileSync("docs/coverage.md", lines.join("\n"));
console.log(`docs/coverage.md を更新: 主要マス ${now.total} 中、目標達成 ${now.ok} / 1品 ${now.one} / 空 ${now.empty}`);
