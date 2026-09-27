# ぷくホロシール帳（第1段階：課金なし）

光るシールを集めて、友達と交換するアプリの本番向け第1段階です。
課金はまだありません。まず公開して、**30日後も使っている人の割合**を測るための版です。

## 動かし方

Node.js 22.13 以上が必要です（データベースは Node に組み込みの SQLite を使うので、追加のインストールはありません）。

```sh
cd server
npm start          # http://localhost:8787
npm test           # サーバーのテスト
```

| 環境変数 | 意味 | 初期値 |
|---|---|---|
| `PORT` | 待ち受けるポート | `8787` |
| `DB_FILE` | データベースのファイル | `server/data/puku.db` |
| `ADMIN_TOKEN` | 運営用の数字（`GET /api/admin/metrics`）を見るための合言葉。空なら使えない | 空 |
| `TRUST_PROXY` | ロードバランサーの後ろに置くときは `1`（回数制限にお客さんのIPを使う） | 空 |

`docker build -t puku-holo .` → `docker run -p 8787:8787 -v puku-data:/app/server/data puku-holo` でも動きます。
**サーバーは1台で動かし、`DB_FILE` は消えないディスクに置いてください**（リアルタイム通知と回数制限をメモリで持っているため）。

## Fly.io に公開する

設定は `fly.toml`（東京リージョン・常に1台・永続ディスクつき）に入っています。自分のパソコンのターミナルで：

```sh
# 1. flyctl を入れてログイン（Mac なら brew install flyctl）
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. アプリを作る。名前は世界で1つだけなので、空いている名前にして fly.toml の app も同じ名前に書き換える
fly apps create puku-holo

# 3. データベース用の永続ディスク（1GB）を東京に作る
fly volumes create puku_data --region nrt --size 1

# 4. 運営用の数字を見るための合言葉を登録（画面には出ないので、控えておく）
fly secrets set ADMIN_TOKEN=$(openssl rand -hex 24)

# 5. 公開（--ha=false で1台だけにする。SQLite とリアルタイム通知のため）
fly deploy --ha=false
```

公開後は `https://<アプリ名>.fly.dev` で開けます。運営用の数字は
`curl -H "x-admin-token: <合言葉>" https://<アプリ名>.fly.dev/api/admin/metrics` で見られます。

**GitHub から自動で公開する場合**：`fly tokens create deploy` で作ったトークンを、リポジトリの Settings → Secrets and variables → Actions に `FLY_API_TOKEN` という名前で登録します。以後 main に入るたびに、テストが通ったら `.github/workflows/fly-deploy.yml` が公開します。

**バックアップ**：Fly.io はボリュームのスナップショットを自動で取ります（保持日数は Fly.io の設定で確認）。大事な公開の前には `fly volumes snapshots create <ボリュームID>` で手動でも取っておくと安心です。

## できること

| 機能 | 中身 |
|---|---|
| アカウント | ニックネームと生まれた年で始める（利用規約への同意つき）。ログイン用トークンはハッシュだけ保存 |
| 引き継ぎ | 12文字の引き継ぎコード（7日間・1回だけ）。使うと前の端末はログアウト |
| シール | 抽選・通し番号・発行上限・天井はすべてサーバーで決める。通し番号はデザインごとに1から |
| 毎日 | 無料パック（日本時間0時に復活）、ログインスタンプ（7こで限定シール、休んでも消えない） |
| 図鑑 | 一度でも手に入れたデザインを記録。そろえても景品なし |
| 友達 | フレンドコードか招待リンク（`/?invite=コード`）で申請 → 承認。検索はできない |
| 交換 | 友達とだけ。ふつう交換（6枚まで・おねだり・スタンプ）とふせて交換（1枚ずつ・めくるまで相手に見えない）。2人が同じ内容で「せーの」したときだけ、サーバーが一度に入れ替える |
| 安全 | ブロック（申請・交換も止まる）、通報、自由入力のチャットなし、回数制限 |
| シェア | シール帳を画像にしてSNSに投稿・保存 |
| 運営用の数字 | 毎日の利用者数、1・7・30日後に戻ってきた人の割合、総数 |

## 作り

```
app/        画面（ビルド不要のES Modules）
  js/catalog.js   シールの一覧（サーバーとアプリで共通）
  js/stickers.js  シールの見た目
  js/feel.js      触ったときの動き・音
  js/main.js      ホーム・シール帳・図鑑・友達・設定
  js/trade.js     交換テーブル
  js/share.js     シェア画像
server/
  src/db.js       テーブル
  src/service.js  ルール（抽選・毎日・友達・交換）
  src/server.js   API・リアルタイム通知（SSE）・静的ファイル
  test/           テスト
```

## まだ入っていないもの（公開までに必要）

- Apple / Google / LINE でのログイン（各社の開発者登録が必要）
- iOS / Android アプリ化、プッシュ通知
- 運営用の管理画面（シール登録・お知らせ・通報の確認）
- 利用規約とプライバシーポリシーの正式版（`app/terms.html` `app/privacy.html` は下書き）、問い合わせ窓口、アカウント削除
- 公開用のシールの量産（今はコードで描いているので、イラスト画像を使える形にする）
- 利用者が増えたときの PostgreSQL への移行と、サーバーの複数台化
