---
name: make-skit
description: アニメ・実写ショート（お約束の実写化 / オリジナルキャラのアニメ⇄実写）を1本作る。「スキットを作って」「ショートアニメを作って」、定期実行から呼ばれる。
---

# ショートスキットを1本作る（下書きまで）

ゴールは **人が5分で確認・承認できる skit.json と下書き動画**。公開・承認はしない。
形式は `docs/skit-format.md`、チャンネルのルールは CLAUDE.md の「アニメ・実写ショートのルール」。

## 1. シリーズを決める

`skits/` の一番新しいフォルダ（sample- で始まるものは除く）の `series` を見て、`otoyaku` と `anime_vs_live` を交互にする。
`reports/` の最新レポートに提案があれば優先する。

## 2. ネタを決める

- **otoyaku**: `skits/tropes.md` の未使用 `[ ]` から1つ（「視聴者リクエスト」があれば優先）。
  オチは「現実だとこうなる」のギャップ。キャラは `characters/` の既存キャラを使い回す（IP を育てる）
- **anime_vs_live**: 既存キャラのうち最近出ていないキャラを主役に。
  新キャラが必要なら `python -m autovideo character-new <id> --name <名前>` で作り、
  `profile` と見た目（anime_prompt / live_prompt）を具体的に書く。参照画像は人が確認して決めるので、
  `character-refs` を実行したら「参照画像の確認が必要」と引き継ぎに書く

## 3. 書く

```bash
python -m autovideo skit-new <slug> --series <series> --chars <id,id>
```

- 4〜6 カット、合計 15〜45 秒。最初の 2 秒で状況が分かり、最後のカットにオチ（`telop` で強調）
- セリフは短く（1 行 20 文字以内目安）。キャラの口癖・性格は `profile` に合わせる
- 動きが大事なカットだけ `shot: video`（API 代がかかるので 1 本あたり 1〜2 カット）
- `scene` / `motion` は英語。**既存作品名・既存キャラ名・有名なセリフ・特定の作家や作品の絵柄・実在の人物名を書かない**
- `hook` は「何をやる動画か」が一瞬で分かる一言。`caption` の最後に「次にやってほしいお約束はコメントで」などの呼びかけ
- `review_status` は `"draft"` のまま

## 4. 検証と下書き書き出し

```bash
python -m autovideo skit-validate skits/<dir>/skit.json --draft
python -m autovideo skit-build skits/<dir>/skit.json --draft
```

## 5. 引き継ぎ

- otoyaku なら `skits/tropes.md` の使ったお約束を `[x]` にしてフォルダ名を書く
- skit.json（と新キャラの character.json）をコミットしてプッシュ（`output/` はコミットしない）
- 人向けに短く: タイトル・あらすじ（カットごと1行）・推定秒数・
  **人が確認すべき点**（既存作品や実在人物に似ていないか、参照画像の確認が必要なキャラ）・
  承認手順（`review_status` を `"approved"` → `python -m autovideo skit-build <path>`）
