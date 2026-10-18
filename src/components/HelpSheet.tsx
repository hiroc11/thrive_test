"use client";
import { AlertTriangle, BookOpen, MousePointerClick, ScanBarcode, ShoppingCart, Smartphone } from "lucide-react";
import { Sheet, btnPrimary } from "./ui";

const STEPS = [
  { icon: MousePointerClick, title: "タップで絞り込む", body: "「渡す相手」「買う場所」「予算」「必須条件」を押すだけで、候補がすぐ絞り込まれます。文字入力はいりません。" },
  { icon: ShoppingCart, title: "買い方を選ぶ", body: "カードの「売場マップ・電話」で店舗の場所を確認できます。「ネット注文」では楽天・Amazon・Yahoo!から選べます。渡すときは、グレー枠の「一言カンペ」をそのまま言えばOKです。" },
  { icon: BookOpen, title: "渡したら記録する", body: "「渡した記録」から相手の名前を入れて保存します。記録は端末の中だけに保存されるので、ログインはいりません。" },
  { icon: AlertTriangle, title: "被りを防ぐ", body: "「被りチェック」で相手を選ぶと、前に渡した商品に赤い「被り注意」ラベルが付きます。" },
  { icon: ScanBarcode, title: "いただいた物も記録", body: "記録帳タブの「スキャン登録」で、いただいた手土産のバーコードを読み取れます。価格を入れると、お返しの候補を3品出します。" },
  { icon: Smartphone, title: "ホーム画面に追加", body: "スマホのブラウザで「共有」→「ホーム画面に追加」を選ぶと、アプリのように使えます。" },
];

export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="TEMIYAGE 10s の使い方">
      <ol className="space-y-4">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100">
              <Icon size={18} />
            </div>
            <div>
              <p className="text-sm font-bold"><span className="tabular-nums text-accent">{i + 1}.</span> {title}</p>
              <p className="text-sm leading-relaxed text-slate-600">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <button onClick={onClose} className={`${btnPrimary} mt-5`}>はじめる</button>
    </Sheet>
  );
}
