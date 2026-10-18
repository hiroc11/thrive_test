"use client";
import { useState } from "react";
import { ExternalLink, MapPin, Phone, Clock } from "lucide-react";
import type { GiftLog, Item } from "@/lib/types";
import { areaLabel, yen } from "@/lib/constants";
import { storeLinks } from "@/lib/affiliate";
import { newId, trackClick } from "@/lib/storage";
import { Sheet, btnPrimary, inputCls } from "./ui";

export function ShopSheet({ item, onClose }: { item: Item | null; onClose: () => void }) {
  return (
    <Sheet open={!!item} onClose={onClose} title="売場マップ・電話">
      {item && (
        <ul className="space-y-3">
          {item.shops.map((s) => (
            <li key={s.shop_name} className="rounded-xl border border-line p-3 text-sm">
              <p className="text-xs text-slate-500">{areaLabel(s.area_id)}</p>
              <p className="font-bold">{s.shop_name}</p>
              <p className="mt-1 flex items-center gap-1 text-slate-600"><MapPin size={14} />{s.access_note}</p>
              <p className="flex items-center gap-1 text-slate-600 tabular-nums"><Clock size={14} />{s.open_hours}</p>
              <div className="mt-2 flex gap-2">
                <a href={s.google_maps_url} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-line py-2 font-bold">
                  <MapPin size={16} />Googleマップ
                </a>
                {s.phone && (
                  <a href={`tel:${s.phone}`} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-ink py-2 font-bold text-white">
                    <Phone size={16} />電話する
                  </a>
                )}
              </div>
            </li>
          ))}
          <li className="text-xs text-slate-500">営業時間・売場は変更される場合があります。来店前に公式情報をご確認ください。</li>
        </ul>
      )}
    </Sheet>
  );
}

export function OrderSheet({ item, area, onClose }: { item: Item | null; area: string; onClose: () => void }) {
  return (
    <Sheet open={!!item} onClose={onClose} title="ネットで注文する">
      {item && (
        <div className="space-y-2">
          <p className="mb-3 text-sm text-slate-600">{item.name}</p>
          {storeLinks(item).map((l) => (
            <a
              key={l.store}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer sponsored"
              onClick={() => trackClick(area, item.id, l.store)}
              className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-sm font-bold hover:bg-slate-50"
            >
              {l.label}<ExternalLink size={16} />
            </a>
          ))}
        </div>
      )}
    </Sheet>
  );
}

const today = () => new Date().toLocaleDateString("sv-SE");

export function LogSheet({
  open, item, recipients, defaultRecipient, onClose, onSave,
}: {
  open: boolean;
  item: Item | null;
  recipients: string[];
  defaultRecipient: string;
  onClose: () => void;
  onSave: (log: GiftLog) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="渡した記録に追加">
      {open && <LogForm key={item?.id ?? "custom"} item={item} recipients={recipients} defaultRecipient={defaultRecipient} onSave={onSave} />}
    </Sheet>
  );
}

function LogForm({ item, recipients, defaultRecipient, onSave }: { item: Item | null; recipients: string[]; defaultRecipient: string; onSave: (l: GiftLog) => void }) {
  const [name, setName] = useState(defaultRecipient);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!item || !name.trim()) return;
        onSave({
          log_id: newId(), direction: "given", recipient_name: name.trim(), item_id: item.id,
          custom_item_name: null, estimated_price: item.price_tax_in, date, memo,
        });
      }}
    >
      {item && <p className="text-sm"><span className="font-bold">{item.name}</span> <span className="tabular-nums">{yen(item.price_tax_in)}</span></p>}
      <label className="block text-xs font-bold">渡した相手
        <input list="recipients" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 株式会社〇〇 佐藤社長" required />
        <datalist id="recipients">{recipients.map((r) => <option key={r} value={r} />)}</datalist>
      </label>
      <label className="block text-xs font-bold">日付
        <input type="date" className={`${inputCls} tabular-nums`} value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label className="block text-xs font-bold">メモ(任意)
        <input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例: 奥様があんこ好き" />
      </label>
      <button className={btnPrimary} disabled={!name.trim()}>保存する</button>
    </form>
  );
}
