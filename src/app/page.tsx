"use client";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, CircleHelp, Search, UserRound } from "lucide-react";
import rawItems from "@/data/items.json";
import type { Area, GiftLog, Item, PriceTier, Scene } from "@/lib/types";
import { AREAS, BUDGETS, MUSTS, SCENES, type Must } from "@/lib/constants";
import { loadLogs, saveLogs } from "@/lib/storage";
import { Pill } from "@/components/ui";
import { ItemCard } from "@/components/ItemCard";
import { LogSheet, OrderSheet, ShopSheet } from "@/components/Modals";
import { LogTab } from "@/components/LogTab";
import { HelpSheet } from "@/components/HelpSheet";

const HELP_SEEN_KEY = "temiyage.helpSeen.v1";

const ITEMS = rawItems as Item[];
const EVENING_SCORE = { high: 2, medium: 1, morning_only: 0 };

const MUST_TEST: Record<Must, (i: Item) => boolean> = {
  wrapped: (i) => i.is_individually_wrapped,
  ambient: (i) => i.temperature === "ambient",
  shelf7: (i) => i.shelf_life_days >= 7,
  evening: (i) => i.evening_availability !== "morning_only",
  savory: (i) => !i.is_sweet,
  compact: (i) => i.bag_size === "compact_a4",
};

export default function Home() {
  const [tab, setTab] = useState<"search" | "log">("search");
  const [scene, setScene] = useState<Scene | null>(null);
  const [area, setArea] = useState<Area | "online" | null>(null);
  const [budget, setBudget] = useState<PriceTier | null>(null);
  const [musts, setMusts] = useState<Set<Must>>(new Set());
  const [recipient, setRecipient] = useState("");
  const [logs, setLogs] = useState<GiftLog[]>([]);
  const [shopItem, setShopItem] = useState<Item | null>(null);
  const [orderItem, setOrderItem] = useState<Item | null>(null);
  const [logItem, setLogItem] = useState<Item | null>(null);

  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    setLogs(loadLogs());
    try {
      if (!localStorage.getItem(HELP_SEEN_KEY)) setHelpOpen(true);
    } catch {}
  }, []);
  const closeHelp = () => {
    setHelpOpen(false);
    try {
      localStorage.setItem(HELP_SEEN_KEY, "1");
    } catch {}
  };
  const updateLogs = (next: GiftLog[]) => { setLogs(next); saveLogs(next); };

  const recipients = useMemo(() => [...new Set(logs.map((l) => l.recipient_name))], [logs]);

  // 被りチェック: 選択中の相手へ渡した商品 → 最新日付
  const givenDates = useMemo(() => {
    const m = new Map<string, string>();
    if (!recipient) return m;
    for (const l of logs) {
      if (l.direction !== "given" || l.recipient_name !== recipient || !l.item_id) continue;
      if (!m.has(l.item_id) || m.get(l.item_id)! < l.date) m.set(l.item_id, l.date);
    }
    return m;
  }, [logs, recipient]);

  const results = useMemo(() => {
    const list = ITEMS.filter(
      (i) =>
        (!scene || i.target_scenes.includes(scene)) &&
        (!area || area === "online" || i.areas.includes(area)) &&
        (!budget || i.price_tier === budget) &&
        [...musts].every((m) => MUST_TEST[m](i)),
    );
    // おすすめ順: 夕方の買いやすさ × 汎用性(対応シーン数)
    return list.sort(
      (a, b) =>
        EVENING_SCORE[b.evening_availability] * 10 + b.target_scenes.length -
        (EVENING_SCORE[a.evening_availability] * 10 + a.target_scenes.length),
    );
  }, [scene, area, budget, musts]);

  const toggleMust = (m: Must) =>
    setMusts((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <header className="sticky top-0 z-30 -mx-4 border-b border-line bg-bg/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-black tracking-tight">TEMIYAGE <span className="text-accent">10s</span></h1>
          <button onClick={() => setHelpOpen(true)} aria-label="使い方" className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200">
            <CircleHelp size={18} />使い方
          </button>
        </div>
        <nav className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-slate-200 p-1 text-sm font-bold">
          <TabBtn active={tab === "search"} onClick={() => setTab("search")}><Search size={16} />10秒で手土産を探す</TabBtn>
          <TabBtn active={tab === "log"} onClick={() => setTab("log")}>
            <BookOpen size={16} />記録帳<span className="tabular-nums">({logs.length}件)</span>
          </TabBtn>
        </nav>
      </header>

      {tab === "search" ? (
        <>
          <section className="mt-4 space-y-3">
            <FilterRow label="渡す相手">
              <Pill active={!scene} onClick={() => setScene(null)}>すべて</Pill>
              {SCENES.map((s) => <Pill key={s.id} active={scene === s.id} onClick={() => setScene(s.id)}>{s.label}</Pill>)}
            </FilterRow>
            <FilterRow label="買う場所">
              <Pill active={!area} onClick={() => setArea(null)}>すべて</Pill>
              {AREAS.map((a) => <Pill key={a.id} active={area === a.id} onClick={() => setArea(a.id)}>{a.label}</Pill>)}
            </FilterRow>
            <FilterRow label="予算">
              <Pill active={!budget} onClick={() => setBudget(null)}>すべて</Pill>
              {BUDGETS.map((b) => <Pill key={b.id} active={budget === b.id} onClick={() => setBudget(b.id)}>{b.label}</Pill>)}
            </FilterRow>
            <FilterRow label="必須条件" wrap>
              {MUSTS.map((m) => <Pill key={m.id} active={musts.has(m.id)} onClick={() => toggleMust(m.id)}>{m.label}</Pill>)}
            </FilterRow>
            <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm">
              <UserRound size={16} className="shrink-0 text-slate-500" />
              <span className="shrink-0 text-xs font-bold">被りチェック</span>
              <select className="min-w-0 flex-1 bg-transparent outline-none" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                <option value="">渡す相手を選択(任意)</option>
                {recipients.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </section>

          <p className="mb-2 mt-5 text-sm text-slate-600"><span className="font-bold tabular-nums text-ink">{results.length}</span>件 おすすめ順</p>
          <div className="space-y-3">
            {results.map((i) => (
              <ItemCard
                key={i.id}
                item={i}
                area={area}
                duplicateDate={givenDates.get(i.id) ?? null}
                onShop={() => setShopItem(i)}
                onOrder={() => setOrderItem(i)}
                onLog={() => setLogItem(i)}
              />
            ))}
            {results.length === 0 && (
              <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-slate-500">条件に合う手土産がありません。条件を減らしてください。</p>
            )}
          </div>
          <p className="mt-6 text-xs text-slate-400">価格・販売店舗・日持ちは目安です。購入前に各店の公式情報をご確認ください。本ページはアフィリエイト広告(PR)を含みます。</p>
          <p className="mt-1 text-xs text-slate-400"><a href="https://developers.rakuten.com/" target="_blank" rel="noopener noreferrer" className="underline">Supported by Rakuten Developers</a></p>
        </>
      ) : (
        <div className="mt-4">
          <LogTab
            logs={logs}
            items={ITEMS}
            onAdd={(l) => updateLogs([...logs, l])}
            onDelete={(id) => updateLogs(logs.filter((l) => l.log_id !== id))}
          />
        </div>
      )}

      <HelpSheet open={helpOpen} onClose={closeHelp} />
      <ShopSheet item={shopItem} onClose={() => setShopItem(null)} />
      <OrderSheet item={orderItem} area={area ?? "all"} onClose={() => setOrderItem(null)} />
      <LogSheet
        open={!!logItem}
        item={logItem}
        recipients={recipients}
        defaultRecipient={recipient}
        onClose={() => setLogItem(null)}
        onSave={(l) => { updateLogs([...logs, l]); setLogItem(null); }}
      />
    </main>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center justify-center gap-1 rounded-lg py-2 ${active ? "bg-white shadow-sm" : "text-slate-600"}`}>
      {children}
    </button>
  );
}

function FilterRow({ label, wrap, children }: { label: string; wrap?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-slate-500">{label}</p>
      <div className={`-mx-4 flex gap-2 px-4 ${wrap ? "flex-wrap" : "overflow-x-auto pb-1 [scrollbar-width:none]"}`}>{children}</div>
    </div>
  );
}
