// 楽天ウェブサービス(openapi.rakuten.co.jp)の共通呼び出し。fetch-rakuten.mjs と同じ認証方式
import { readFileSync, existsSync } from "node:fs";
import dns from "node:dns";

dns.setDefaultResultOrder("ipv4first"); // 許可IPはIPv4で登録しているため

const fileEnv = existsSync(".env.local")
  ? Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2]]),
    )
  : {};
export const env = (k, d) => process.env[k] ?? fileEnv[k] ?? d;

const APP_ID = env("RAKUTEN_APP_ID");
const ACCESS_KEY = env("RAKUTEN_ACCESS_KEY");
const REFERER = env("RAKUTEN_REFERER", "http://localhost:3000");
export const AFF_ID = env("NEXT_PUBLIC_RAKUTEN_AFFILIATE_ID");

export function requireKeys() {
  if (!APP_ID || !ACCESS_KEY) {
    console.error(".env.local に RAKUTEN_APP_ID と RAKUTEN_ACCESS_KEY を設定してください");
    process.exit(1);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1秒1リクエストの制限を守る
let last = 0;
async function throttle() {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
}

export class RakutenError extends Error {
  constructor(status, body) {
    super(`${status} ${body.slice(0, 200)}`);
    this.status = status;
    this.notConfigured = body.includes("API Configuration not found");
  }
}

export async function rakutenGet(url, params) {
  await throttle();
  const q = new URLSearchParams({ format: "json", formatVersion: "2", applicationId: APP_ID, ...params });
  const origin = new URL(REFERER).origin;
  const res = await fetch(`${url}?${q}`, { headers: { accessKey: ACCESS_KEY, Referer: `${origin}/`, Origin: origin } });
  const text = await res.text();
  if (!res.ok) throw new RakutenError(res.status, text);
  return JSON.parse(text);
}

// 版が廃止されると "API Configuration not found" になるので、候補を順に試して最初に通ったURLを使う
export async function firstWorking(label, urls, params) {
  for (const url of urls) {
    try {
      const data = await rakutenGet(url, params);
      console.log(`[${label}] ${url}`);
      return { url, data };
    } catch (e) {
      if (!(e instanceof RakutenError && (e.notConfigured || e.status === 404))) throw e;
    }
  }
  throw new Error(`[${label}] 使えるURLが見つかりません。楽天ウェブサービスのドキュメントで最新の版を確認し、.env.local に RAKUTEN_${label.toUpperCase()}_URL=... を設定してください`);
}
