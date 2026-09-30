# 台本フォーマット（script.json）

`content/<YYYY-MM-DD>-<slug>/script.json` に1本1ファイル。`python -m autovideo new <slug> --format <format>` でひな形ができる。

```jsonc
{
  "title": "動画タイトル（32〜45文字目安。数字と結論を入れる）",
  "format": "news_top5 | case_study | tool_compare | experiment",
  "review_status": "draft",          // 人が事実確認したら "approved" に変える
  "description": "概要欄の導入文（2〜3行）",
  "tags": ["AI", "..."],              // 先頭5つが概要欄のハッシュタグになる
  "sources": [{"title": "記事名", "url": "https://..."}],  // news_top5 / case_study は必須
  "thumbnail": {
    "text": "14文字以内の強い一言",   // \n で改行位置を指定できる
    "sub": "補足（任意）",
    "image_prompt": "背景画像のプロンプト（英語）"
  },
  "segments": [
    {
      "id": "s1",                      // 一意
      "chapter": "オープニング",       // 概要欄のチャプター名。連続する同名はまとめる
      "narration": "読み上げる文章。1区間 150〜400 文字目安",
      "opinion": false,                // 自分の見解の区間は true（承認時に1つ以上必須）
      "visual": { ... }                // 下記
    }
  ],
  "shorts": [
    {
      "title": "ショートの投稿タイトル",
      "hook": "画面上部に出す一言（\\n で改行可）",
      "segments": ["s3", "s4"],        // 長尺から切り出す区間（合計60秒以内推奨）
      "hashtags": ["#AI", "#Shorts"]
    }
  ]
}
```

## visual の種類

| type | 項目 | 用途 |
|---|---|---|
| `title` | `text`, `sub` | オープニング・まとめ |
| `text` | `heading`, `bullets[]` | 要点の箇条書き |
| `chart` | `chart: {kind: bar/barh/line, title, labels[], values[], unit, highlight, source}` | 数字。**source 必須** |
| `image` | `prompt`（英語） | 画像生成AIで背景を作る（ゆっくりズーム） |
| `file` | `path`（script.json からの相対パス） | 自分で撮ったスクショ等 |

## 尺の目安

- 日本語ナレーションは約 6.5 文字/秒（390 文字/分）
- 長尺 10〜12 分 ≒ 3,900〜4,700 文字。8 分未満はミッドロール広告が入らないので警告が出る
- チャプターは3つ以上・各10秒以上（YouTube の条件）

## 承認ゲート

`review_status` が `"approved"` でない、`TODO` が残っている、`opinion` 区間が無い、
ニュース・事例フォーマットで出典が無い — のいずれかなら本番書き出しは失敗する。
試し書き出しは `--draft`（ファイル名に `_DRAFT` が付く）。
