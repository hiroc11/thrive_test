"use client";
import { AlertTriangle, Circle, MapPin, MessageSquareQuote, Plus, ShoppingCart, ExternalLink } from "lucide-react";
import type { Area, Item } from "@/lib/types";
import { yen } from "@/lib/constants";

const tempLabel = { ambient: "常温", chilled: "要冷蔵" };
const bagLabel = { compact_a4: "A4バッグ収納可", standard: "標準紙袋", large: "大きめ" };

export function ItemCard({
  item, area, duplicateDate, onShop, onOrder, onLog,
}: {
  item: Item;
  area: Area | "online" | null;
  duplicateDate: string | null;
  onShop: () => void;
  onOrder: () => void;
  onLog: () => void;
}) {
  const shop = item.shops.find((s) => s.area_id === area) ?? item.shops[0];
  const specs = [
    item.is_individually_wrapped ? `個包装 ${item.piece_count}` : item.piece_count,
    tempLabel[item.temperature],
    item.shelf_life_days >= 365 ? "日持ち 1年" : `日持ち ${item.shelf_life_days}日`,
    bagLabel[item.bag_size],
  ];

  return (
    <article className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      {duplicateDate && (
        <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-accent">
          <AlertTriangle size={16} />
          <span className="tabular-nums">{duplicateDate.replaceAll("-", "/")}</span> に渡しています(被り注意)
        </div>
      )}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{item.brand_name}</p>
          <h3 className="font-bold leading-snug">{item.name}</h3>
        </div>
        <p className="shrink-0 text-right font-bold tabular-nums">{yen(item.price_tax_in)}</p>
      </header>

      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {item.evening_availability === "high" ? (
          <Badge><Circle size={10} className="fill-green-600 text-green-600" />18時以降も購入可</Badge>
        ) : item.evening_availability === "medium" ? (
          <Badge><Circle size={10} className="fill-amber-500 text-amber-500" />夕方品薄(電話取置可)</Badge>
        ) : (
          <Badge><Circle size={10} className="fill-accent text-accent" />午前完売注意</Badge>
        )}
        {specs.map((s) => <Badge key={s}>{s}</Badge>)}
      </div>

      <div className="mt-3 rounded-lg bg-slate-100 p-3">
        <p className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-600">
          <MessageSquareQuote size={14} />渡すときの一言カンペ
        </p>
        <p className="text-sm leading-relaxed">「{item.handoff_script}」</p>
      </div>
      <p className="mt-2 text-xs text-slate-500">{item.why_recommended}</p>

      {shop && (
        <p className="mt-3 flex items-start gap-1 text-xs text-slate-600">
          <MapPin size={14} className="mt-0.5 shrink-0" />
          <span>
            {shop.shop_name} / {shop.access_note} / <span className="tabular-nums">{shop.open_hours}</span>
          </span>
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-bold">
        <ActionBtn onClick={onShop}><MapPin size={16} />売場マップ・電話</ActionBtn>
        <ActionBtn onClick={onOrder}><ShoppingCart size={16} />ネット注文<ExternalLink size={12} /></ActionBtn>
        <ActionBtn onClick={onLog} primary><Plus size={16} />渡した記録</ActionBtn>
      </div>
    </article>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 tabular-nums">{children}</span>;
}

function ActionBtn({ onClick, primary, children }: { onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 sm:flex-row ${
        primary ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
