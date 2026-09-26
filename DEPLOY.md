# デプロイ手順（Fly.io）

「ふたりの暮らし」を Fly.io の東京リージョンに公開する手順です。所要時間は15分ほどです。

## 費用の目安

- 小さなマシン（shared-cpu-1x / 256MB）と 1GB のディスクで、**月数百円程度**です
- アプリを使っていないときはマシンが自動で止まり、そのぶん安くなります
- 登録にはクレジットカードが必要です。料金は Fly.io の料金ページで最新の情報を確認してください

## 方法A: ブラウザだけでデプロイ（GitHub Actions）

PC でのコマンド操作は不要です。GitHub がかわりにデプロイします。

1. **Fly.io のアカウントを作る**: https://fly.io で登録し、クレジットカードを登録します
2. **トークンを作る**: Fly.io のダッシュボード左メニューの **Tokens** を開き、**Organization** の種類でトークンを作ります（組織は `personal`）。表示された文字列をコピーします
   - アプリ単位の「Deploy token」ではなく、組織（Organization）のトークンにしてください。最初のデプロイでアプリを作るためです
3. **GitHub に登録する**: GitHub のリポジトリページで **Settings → Secrets and variables → Actions → New repository secret** を開きます
   - Name: `FLY_API_TOKEN`
   - Secret: コピーしたトークン
4. **デプロイを動かす**: リポジトリの **Actions** タブ → **Deploy to Fly.io** → 最新の実行の **Re-run all jobs** を押します
   - 以後は、このブランチに push するたびに自動でデプロイされます
5. 数分で完了します。実行結果の画面（Summary）に `https://futari-<GitHubユーザー名>.fly.dev` が表示されます

アプリ名（URL）を変えたいときは、同じ画面の **Variables** タブで `FLY_APP_NAME` を追加してください（英小文字・数字・ハイフンのみ）。
最初のデプロイでは、アプリとデータ用ディスクが自動で作られます。

そのあとは、下の「4. スマホで使う」へ進んでください。

---

## 方法B: PC からデプロイ（flyctl）

## 1. 準備（最初の1回だけ）

1. https://fly.io でアカウントを作ります
2. PC に flyctl（Fly.io のコマンド）を入れます

   ```sh
   # macOS
   brew install flyctl
   # Windows (PowerShell)
   iwr https://fly.io/install.ps1 -useb | iex
   # Linux
   curl -L https://fly.io/install.sh | sh
   ```

3. ログインします

   ```sh
   fly auth login
   ```

## 2. アプリを作る（最初の1回だけ）

このリポジトリを PC に clone して、そのフォルダで実行します。

```sh
git clone https://github.com/hiroc11/thrive_test.git
cd thrive_test
git checkout claude/fervent-albattani-sw182i

# アプリを登録します（まだデプロイはしません）
fly launch --no-deploy --copy-config
```

- アプリ名を聞かれたら、好きな名前を入れます（例: `futari-hiro`）。これが URL になります: `https://futari-hiro.fly.dev`
- 「設定を調整するか（tweak settings）」と聞かれたら **No** を選びます
- データベース（Postgres / Redis）の追加を聞かれたら、どれも **No** を選びます

次に、データを保存するディスクを作ります。

```sh
fly volumes create futari_data --region nrt --size 1
```

「1台だけだと冗長性がない」という警告が出たら、**y** で進めて大丈夫です（ふたりで使う分には1台で十分です）。

## 3. デプロイ

```sh
fly deploy --ha=false
```

`--ha=false` を付けて、マシンを1台だけにします。データはそのマシンのディスクに保存されるので、2台に増やさないでください。

完了すると URL が表示されます。確認するには:

```sh
fly open            # ブラウザで開く
curl https://<アプリ名>.fly.dev/api/health   # {"ok":true} と出れば OK
```

## 4. スマホで使う

1. ふたりのスマホで `https://<アプリ名>.fly.dev` を開きます
2. ホーム画面に追加します
   - iPhone: Safari の共有ボタン → 「ホーム画面に追加」
   - Android: Chrome のメニュー → 「ホーム画面に追加」
3. 1人目: **設定 → はじめる（コードを作る）**
4. 2人目: **設定 → コードで参加** に、表示されたコードを入力します

## アプリを更新するとき

```sh
git pull
fly deploy --ha=false
```

データはディスクに残ります。

## バックアップ

アプリの **設定 → 書き出す** で、いつでも JSON ファイルに保存できます。
あわせて、Fly.io のディスクは毎日自動でスナップショットが取られています（`fly volumes snapshots list <ボリュームID>` で確認できます）。

## うまくいかないとき

```sh
fly logs     # サーバーのログを見る
fly status   # マシンの状態を見る
```

- `fly deploy` で「volume が見つからない」と出る → 手順2の `fly volumes create` を、同じリージョン（nrt）で実行したか確認してください
- 同期の丸が赤いまま → `fly status` でマシンが動いているか確認してください。止まっていても、アクセスすれば数秒で起動します
