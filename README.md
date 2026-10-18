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
                            # 一覧を後から読み込むサイトは -- --browser（初回のみ npm i -D playwright && npx playwright install chromium）
npm run fetch:gaps          # 足りないマスを既存ブランドの公式店で検索 → scripts/out/gap-search.json
npm run import:candidates -- --dry-run   # 追加される商品を確認だけ
npm run import:candidates   # items.json に追加して coverage を更新
npm run fetch:rakuten       # 追加分の画像・リンクを補完（任意）
npm run annotate:shops      # 「〇〇周辺」の店舗を、公式ショップ一覧に載っている施設の店舗に置き換え（地図の施設ピン用）
```

追加の条件は「楽天で販売中」かつ「収録済みブランドの公式店の商品」であることです。エリアはそのブランドの既存エリアと、公式ショップ一覧に名前が載っているエリアです。追加分はすべて `data_status: "draft"` になります。商店街・老舗中心のエリア（人形町・神田・神楽坂・自由が丘・清澄白河・両国・日暮里/巣鴨・柴又/北千住・中野）は、主要マスを「和菓子・甘くない系の5千円未満」に絞っています（`scripts/lib/catalog.mjs` の `LOCAL_AREAS`）。この仕組みでは埋まらないので、地元の店を手で追加します。

## 期間限定・新商品

商品データには任意で次の項目を持たせられます。

| 項目 | 内容 |
|---|---|
| `is_limited` | 期間限定なら `true`。カードに「期間限定」バッジが出る |
| `available_from` | 販売開始日（YYYY-MM-DD）。開始前は「〇/〇から販売」、開始から30日は「新商品」バッジ |
| `available_until` | 販売終了日（YYYY-MM-DD）。カードに「〜MM/DDまで」。**この日を過ぎると自動で非表示**（表示する端末の日本時間で判定するので、ビルドし直す必要はない） |

### 候補の収集と追加（Macで手動実行）

```bash
npm run collect:limited                 # 主要ブランド × 期間限定/季節限定/新発売 を楽天で検索 → data/candidates.json
npm run list:limited                    # 確認待ちの候補を番号付きで表示（日付の読み取り根拠も表示）
npm run approve:limited -- 1 3 5        # OKな候補だけ items.json に追加（draft）
npm run approve:limited -- --reject 2   # 却下（次回の収集でも確認待ちに戻らない）
npm run approve:limited -- 4 --until=2026-12-25   # 販売終了日を手で指定して追加
```

- `collect:limited` は items.json を変更しません。候補は `data/candidates.json` に貯まり、前回の判断（追加済み・却下）は引き継がれます。
- 対象は「楽天に公式店があり、収録済みのブランド」の公式店の商品だけです。検索語に引っかかっても、商品名・説明に「期間限定」「新発売」などがないものは除きます。
- 販売期間は商品名・説明文に書かれていたものだけを読み取ります（「12/20までのご注文で年内お届け」のような配送の締め切りは除外）。読み取れない場合は空欄なので、必要なら `--until` で指定してください。
- 追加した商品の店舗・エリアは、同じブランドの収録済み商品から引き継ぎます。
- 公式サイトの情報を機械的に集める処理は入れていません（各サイトの利用規約の確認が必要なため）。

### GitHub Actions で週1回自動化する場合

設定例は `docs/collect-limited.workflow.example.yml` にあります。変える必要があるのは次の点です。

1. **実行場所（いちばん大きな問題）**: 楽天APIのアプリは許可IP（自宅のIP）からしか呼べません。GitHubのクラウド実行環境はIPが毎回変わるので使えません。次のどちらかが必要です。
   - 自宅のMacを **セルフホストランナー** として登録し、`runs-on: self-hosted` で動かす（Macが起動している必要がある。設定例はこの方式）
   - 固定IPのサーバー（またはプロキシ）を用意し、そのIPを楽天アプリの許可IPに登録する
2. **秘密情報**: `.env.local` の代わりに、リポジトリの Settings → Secrets に `RAKUTEN_APP_ID` / `RAKUTEN_ACCESS_KEY` / `RAKUTEN_REFERER` / `NEXT_PUBLIC_RAKUTEN_AFFILIATE_ID` を登録する（スクリプトは環境変数を優先して読むので、コードの変更は不要）。
3. **結果の受け取り方**: 自動で items.json に入れず、`data/candidates.json` の差分をプルリクエストにする（設定例は `peter-evans/create-pull-request` を使用）。PRを見て、Macで `list:limited` → `approve:limited` を実行する流れは手動のまま。
4. **期限切れの掃除**: 期限切れの商品はアプリ側で自動的に非表示になるので、定期実行での削除は不要。データを軽くしたくなったら、別途削除スクリプトを追加する。
