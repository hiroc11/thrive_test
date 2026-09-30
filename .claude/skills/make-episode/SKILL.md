---
name: make-episode
description: YouTube長尺1本分（リサーチ→台本→仮書き出し）を作る。「今週の動画を作って」「エピソードを作って」、定期実行ルーティンから呼ばれる。
---

# 1本作る（下書きまで）

ゴールは **人が15分で確認・承認できる状態の台本と下書き動画** を用意すること。公開・承認はしない。

## 1. フォーマットを決める

`content/` の既存フォルダを見て、直近で使った `format` を確認し、次の順で回す:
`news_top5` → `case_study` → `tool_compare` → `experiment` → 最初に戻る。
`reports/` に最新の週次レポートがあれば、その「来週の提案」を優先する。

## 2. リサーチ

- WebSearch / WebFetch で直近7日（事例・比較は直近3か月）の情報を集める
- 1トピックにつき一次情報を1つ以上。日付・数字・固有名詞は必ず出典で確認する
- 調べたことは `content/<日付>-<slug>/research.md` に「事実 / 出典URL / 自分用メモ」で残す
- 確認できなかった話題は使わない

## 3. 台本を書く

```bash
python -m autovideo new <slug> --format <format> --title "<タイトル>"
```

できた `script.json` を `docs/script-format.md` と CLAUDE.md のルールに従って埋める。

- 合計 3,900〜4,700 文字（10〜12分）。区間は 150〜400 文字
- 冒頭15秒で「この動画で分かること」と結論のチラ見せ
- 数字は `chart`（`source` 必須）、要点は `text`、雰囲気は `image`（英語プロンプト、実在人物・ロゴ禁止）
- `"opinion": true` の区間に意見の下書きを書き、先頭に `TODO(人): 自分の言葉に直す` を付ける
- ショートは視聴者が驚く数字・結論の区間を 30〜55 秒分で1〜2本
- `thumbnail.text` は14文字以内、`title` は数字か結論を含める
- `review_status` は `"draft"` のまま

## 4. 検証と下書き書き出し

```bash
python -m autovideo validate content/<dir>/script.json --draft
python -m autovideo build content/<dir>/script.json --draft
```

警告（尺不足など）は直してから書き出す。エラーが出たら直して再実行。

## 5. 引き継ぎ

- `content/<dir>/` の script.json と research.md をコミットしてプッシュする（`output/` はコミットしない）
- 最後に人向けに短くまとめる:
  - タイトル・フォーマット・推定尺
  - **人が確認すべき点**（出典の怪しい箇所、TODO(人) の場所、数字）
  - 承認手順: TODO を消す → `review_status` を `"approved"` → `python -m autovideo build <script>`
