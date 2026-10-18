# TEMIYAGE 10s

東京のビジネス・会食・帰省向けの手土産を10秒で逆引きし、誰に何を渡したかを記録できるスマホ向けWebアプリ。

- Next.js 15 (App Router) + Tailwind CSS + TypeScript + lucide-react
- ログイン不要。記録は端末内 (`localStorage`) に保存
- 初期データ: `src/data/items.json`（30品）

## 起動

```bash
npm install
npm run dev   # http://localhost:3000
```

## 機能

- **10秒逆引き**: 渡す相手 / 買う場所 / 予算 / 必須条件（個包装・常温・日持ち7日以上・17時以降・甘くない・薄型）をタップで即時絞り込み
- **被りチェック**: 相手を選ぶと、過去に渡した商品に「被り注意」バッジを表示
- **カード**: 夕方在庫・スペック・渡すときの一言カンペ・店舗アクセス・売場マップ/ネット注文/記録ボタン
- **記録帳**: 相手別タイムライン。いただいた手土産をバーコード（JAN）で登録すると Open Food Facts で商品名を検索し、お返し候補（同額〜1.2倍）を3品表示
- **収益化**: `.env.example` を `.env.local` にコピーして楽天/Amazon/バリューコマースのIDを設定すると、注文リンクが自動でアフィリエイトリンクになる。注文クリックはエリア×商品×ストア別に `localStorage` に記録

## データについて

価格・店舗・営業時間・日持ちは目安です。公開前に各店舗の公式情報で確認・更新してください。店舗電話番号は未設定（`phone: null`）のため、確認したものから追記してください。

## 商品データの網羅チェックと補充

エリア（23）× ジャンル（4）× 予算（4）の網羅状況を `docs/coverage.md` に出し、足りないマスを楽天市場ランキングと公式ショップ一覧から補充します。楽天APIは許可IPのMacからだけ実行できます。

```bash
npm run coverage            # docs/coverage.md を作り直す（比較の基準は docs/coverage-baseline.json）
npm run fetch:ranking       # 楽天ランキングAPI → scripts/out/ranking.json
npm run fetch:shops         # 公式ショップ一覧（scripts/shop-sources.json）→ scripts/out/shop-directory.json
npm run import:candidates -- --dry-run   # 追加される商品を確認だけ
npm run import:candidates   # items.json に追加して coverage を更新
npm run fetch:rakuten       # 追加分の画像・リンクを補完（任意）
```

追加の条件は「楽天で販売中」かつ「ブランド名がそのエリアの公式ショップ一覧に載っている」ことです。追加分はすべて `data_status: "draft"` になります。公式の一覧がない商店街中心のエリア（人形町・神楽坂・自由が丘・清澄白河・両国・日暮里/巣鴨・中野）は、この仕組みでは埋まりません。
