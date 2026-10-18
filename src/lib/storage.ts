import type { GiftLog } from "./types";

const LOG_KEY = "temiyage.logs.v1";
const CLICK_KEY = "temiyage.clicks.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const loadLogs = () => read<GiftLog[]>(LOG_KEY, []);
export const saveLogs = (logs: GiftLog[]) => write(LOG_KEY, logs);

export type ClickStats = Record<string, number>; // key: `${area}|${itemId}|${store}`
export const loadClicks = () => read<ClickStats>(CLICK_KEY, {});

export function trackClick(area: string, itemId: string, store: string) {
  const stats = loadClicks();
  const key = `${area}|${itemId}|${store}`;
  stats[key] = (stats[key] ?? 0) + 1;
  write(CLICK_KEY, stats);
}

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
