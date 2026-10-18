"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ScanBarcode, Trash2, Gift, Loader2 } from "lucide-react";
import type { GiftLog, Item } from "@/lib/types";
import { yen } from "@/lib/constants";
import { newId } from "@/lib/storage";
import { Sheet, btnPrimary, inputCls } from "./ui";

export function LogTab({
  logs, items, onAdd, onDelete,
}: {
  logs: GiftLog[];
  items: Item[];
  onAdd: (l: GiftLog) => void;
  onDelete: (id: string) => void;
}) {
  const [scanOpen, setScanOpen] = useState(false);
  const [suggestFor, setSuggestFor] = useState<GiftLog | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const groups = useMemo(() => {
    const m = new Map<string, GiftLog[]>();
    for (const l of [...logs].sort((a, b) => b.date.localeCompare(a.date))) {
      m.set(l.recipient_name, [...(m.get(l.recipient_name) ?? []), l]);
    }
    return [...m.entries()];
  }, [logs]);

  return (
    <div className="space-y-4">
      <button onClick={() => setScanOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3 text-sm font-bold text-white">
        <ScanBarcode size={18} />いただいた手土産をスキャン登録
      </button>

      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-slate-500">
          まだ記録がありません。検索結果の「渡した記録」から追加できます。
        </p>
      )}

      {groups.map(([name, list]) => (
        <section key={name} className="rounded-2xl border border-line bg-white p-4">
          <h3 className="mb-2 font-bold">{name} <span className="text-sm font-normal text-slate-500 tabular-nums">(過去{list.length}回)</span></h3>
          <ol className="space-y-2 border-l-2 border-line pl-3">
            {list.map((l) => {
              const item = l.item_id ? byId.get(l.item_id) : null;
              return (
                <li key={l.log_id} className="text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-1 text-xs text-slate-500 tabular-nums">
                        {l.direction === "given" ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} className="text-accent" />}
                        {l.date.replaceAll("-", "/")} {l.direction === "given" ? "渡した" : "いただいた"}
                      </p>
                      <p>{item?.name ?? l.custom_item_name}{l.estimated_price != null && <span className="ml-1 tabular-nums text-slate-500">{yen(l.estimated_price)}</span>}</p>
                      {l.memo && <p className="text-xs text-slate-500">{l.memo}</p>}
                      {l.direction === "received" && l.estimated_price != null && (
                        <button onClick={() => setSuggestFor(l)} className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-accent">
                          <Gift size={14} />お返し候補を見る
                        </button>
                      )}
                    </div>
                    <button onClick={() => confirm("この記録を削除しますか?") && onDelete(l.log_id)} aria-label="削除" className="p-1 text-slate-400 hover:text-accent">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <ScanSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onSave={(l) => { onAdd(l); setScanOpen(false); setSuggestFor(l); }}
      />
      <Sheet open={!!suggestFor} onClose={() => setSuggestFor(null)} title="次回のお返し予算目安">
        {suggestFor && <ReturnSuggestions price={suggestFor.estimated_price ?? 0} items={items} />}
      </Sheet>
    </div>
  );
}

function ReturnSuggestions({ price, items }: { price: number; items: Item[] }) {
  const lo = price, hi = Math.round(price * 1.2);
  const picks = [...items]
    .sort((a, b) => {
      const d = (p: number) => (p >= lo && p <= hi ? 0 : Math.min(Math.abs(p - lo), Math.abs(p - hi)));
      return d(a.price_tax_in) - d(b.price_tax_in);
    })
    .slice(0, 3);
  return (
    <div className="space-y-3">
      <p className="text-sm">目安: <span className="font-bold tabular-nums">{yen(lo)} 〜 {yen(hi)}</span>(同額〜1.2倍)</p>
      {picks.map((i) => (
        <div key={i.id} className="flex justify-between gap-2 rounded-xl border border-line p-3 text-sm">
          <div><p className="text-xs text-slate-500">{i.brand_name}</p><p className="font-bold">{i.name}</p></div>
          <p className="shrink-0 font-bold tabular-nums">{yen(i.price_tax_in)}</p>
        </div>
      ))}
    </div>
  );
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

function ScanSheet({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (l: GiftLog) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [jan, setJan] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [from, setFrom] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setJan(""); setName(""); setPrice(""); setFrom(""); setStatus("");
    const BD = (window as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
    if (!BD || !navigator.mediaDevices?.getUserMedia) {
      setStatus("この端末はカメラ読取に未対応です。JANコードを手入力してください。");
      return;
    }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const detector = new BD({ formats: ["ean_13", "ean_8"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); }
        timer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          const codes = await detector.detect(videoRef.current).catch(() => []);
          if (codes[0]) { clearInterval(timer); setJan(codes[0].rawValue); lookup(codes[0].rawValue); }
        }, 400);
      })
      .catch(() => setStatus("カメラを起動できませんでした。JANコードを手入力してください。"));
    return () => { stopped = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [open]);

  async function lookup(code: string) {
    if (!/^\d{8,13}$/.test(code)) return;
    setLoading(true); setStatus("商品情報を検索中...");
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_ja,brands`);
      const data = await res.json();
      const p = data.product;
      const n = p ? [p.brands, p.product_name_ja || p.product_name].filter(Boolean).join(" ") : "";
      if (n) { setName(n); setStatus("商品名を取得しました。価格を確認してください。"); }
      else setStatus("商品が見つかりませんでした。商品名を入力してください。");
    } catch {
      setStatus("検索に失敗しました。商品名を入力してください。");
    } finally { setLoading(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="いただいた手土産を登録">
      <video ref={videoRef} playsInline muted className="mb-3 aspect-video w-full rounded-xl bg-slate-900 object-cover" />
      {status && <p className="mb-3 flex items-center gap-1 text-xs text-slate-600">{loading && <Loader2 size={14} className="animate-spin" />}{status}</p>}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            log_id: newId(), direction: "received", recipient_name: from.trim(), item_id: null,
            custom_item_name: name.trim(), estimated_price: price ? Number(price) : null,
            date: new Date().toLocaleDateString("sv-SE"), memo: jan ? `JAN ${jan}` : "",
          });
        }}
      >
        <label className="block text-xs font-bold">JANコード
          <div className="flex gap-2">
            <input inputMode="numeric" className={`${inputCls} tabular-nums`} value={jan} onChange={(e) => setJan(e.target.value)} placeholder="49..." />
            <button type="button" onClick={() => lookup(jan)} className="shrink-0 rounded-lg border border-line px-3 text-sm">検索</button>
          </div>
        </label>
        <label className="block text-xs font-bold">商品名<input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="block text-xs font-bold">価格(円・目安)<input inputMode="numeric" type="number" min={0} className={`${inputCls} tabular-nums`} value={price} onChange={(e) => setPrice(e.target.value)} required /></label>
        <label className="block text-xs font-bold">誰から貰ったか<input className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="例: 義実家" required /></label>
        <button className={btnPrimary}>保存してお返し候補を見る</button>
      </form>
    </Sheet>
  );
}
