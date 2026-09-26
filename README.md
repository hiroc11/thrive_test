# 不動産情報管理アプリ

不動産物件の情報を登録・検索・管理するWebアプリです。
Node.js の標準機能（`node:http` / `node:sqlite`）だけで動くため、`npm install` は不要です。

## 主な機能

- 物件の登録・編集・削除（物件名、種別、売買／賃貸、価格・賃料、管理費、所在地、最寄駅・徒歩分数、面積、間取り、築年、構造、所有者・連絡先、備考）
- ステータス管理（募集中／商談中／成約済／非公開）
- キーワード検索、取引種別・物件種別・ステータス・価格帯・駅徒歩での絞り込み、並び替え
- ダッシュボード（登録件数、ステータス別件数、売買の平均価格、賃貸の平均賃料）
- CSV出力（Excelで開けるBOM付きUTF-8、現在の絞り込み条件を反映）
- 面積の坪換算、築年数の自動表示、スマートフォン表示・ダークモード対応

## 必要環境

- Node.js 22.13 以上

## 使い方

```bash
npm start          # http://localhost:3000 で起動
npm run seed       # サンプル物件を5件登録（任意）
npm test           # テストを実行
```

環境変数:

| 変数 | 説明 | 既定値 |
| --- | --- | --- |
| `PORT` | 待ち受けポート | `3000` |
| `DB_PATH` | SQLiteデータベースファイルのパス | `data/real-estate.db` |

## API

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/properties` | 一覧・検索（`q`, `property_type`, `transaction_type`, `status`, `min_price`, `max_price`, `min_area`, `max_walk`, `sort`, `limit`, `offset`） |
| POST | `/api/properties` | 物件を登録 |
| GET | `/api/properties/:id` | 物件の詳細 |
| PUT | `/api/properties/:id` | 物件を更新（全項目） |
| PATCH | `/api/properties/:id` | 物件を部分更新 |
| DELETE | `/api/properties/:id` | 物件を削除 |
| GET | `/api/properties/export.csv` | CSV出力（一覧と同じ絞り込み条件を指定可） |
| GET | `/api/stats` | 集計情報 |
| GET | `/api/meta` | 項目定義・選択肢 |

`sort` に指定できる値: `updated_desc`（既定）, `created_desc`, `price_asc`, `price_desc`, `area_desc`, `walk_asc`, `built_desc`, `name_asc`

## ディレクトリ構成

```
src/
  server.js   HTTPサーバー・APIルーティング・静的ファイル配信
  db.js       SQLiteによるデータ保存・検索・集計
  schema.js   項目定義・入力バリデーション
  seed.js     サンプルデータ投入
public/       画面（HTML / CSS / JavaScript）
test/         APIテスト（node:test）
```

## 注意事項

- 認証機能はまだありません。社内ネットワークなど信頼できる環境で使用してください。
