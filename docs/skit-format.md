# スキット形式（skit.json）とキャラクター

縦型ショート1本 = `skits/<YYYY-MM-DD>-<slug>/skit.json`。
`python -m autovideo skit-new <slug> --series otoyaku|anime_vs_live --chars hana,kaito` でひな形ができる。

## シリーズ

| series | 内容 | 必須 |
|---|---|---|
| `otoyaku` | アニメの「お約束」を実写風でやる（現実だとこうなる、のオチ） | `trope` |
| `anime_vs_live` | オリジナルキャラのアニメ版と実写版を見せる | キャラ1人以上、アニメと実写の両カット（または `split`） |

## skit.json

```jsonc
{
  "series": "otoyaku",
  "trope": "食パンをくわえて遅刻ダッシュ",   // otoyaku のみ。skits/tropes.md から選ぶ
  "title": "投稿タイトル",
  "hook": "画面上部にずっと出す一言（\n で改行）",
  "review_status": "draft",                  // 人が確認したら "approved"
  "characters": ["hana", "kaito"],           // characters/<id>/character.json
  "cuts": [
    {
      "id": "c1",
      "style": "live | anime | split",        // split = 上アニメ・下実写の比較（still のみ）
      "shot": "still | video",                // video = 画像から5秒の動画を生成（キー無しは静止画＋ズーム）
      "scene": "場面の英語プロンプト（キャラの見た目は自動で足される）",
      "characters": ["hana"],                 // このカットに映るキャラ
      "motion": "動きの英語プロンプト（video のとき）",
      "telop": "画面中央の大きなテロップ（任意。オチに使う）",
      "min_sec": 2.0,                         // セリフが短くてもこの秒数は映す
      "lines": [{"who": "hana", "text": "セリフ"}, {"who": "narrator", "text": "ナレーション"}]
    }
  ],
  "caption": "投稿文",
  "hashtags": ["#Shorts", "#AIアニメ"]
}
```

- 合計 15〜45 秒が目安（60 秒超で警告、3 分超はエラー）
- 実写風カット（live / split）がある回は、`caption.txt` に「改変または合成されたコンテンツ＝はい」の投稿時チェックが自動で入る

## キャラクター（characters/<id>/character.json）

```jsonc
{
  "name": "ハナ",
  "profile": "設定・性格・口癖",
  "color": "#ec4899",                // セリフの名前札の色
  "anime_prompt": "アニメ版の見た目（英語）",
  "live_prompt": "実写版の見た目（英語。同じ特徴を実写で。実在の人物名は書かない）",
  "voice_id": "",                    // ElevenLabs の voice ID（直書き）か
  "voice_id_env": "VOICE_ID_HANA"    // 環境変数名で指定
}
```

- `python -m autovideo character-new <id> --name <表示名>` で作成
- `python -m autovideo character-refs <id>` で参照画像 `ref_anime.png` / `ref_live.png` を生成。
  **人が見て「このキャラはこの顔」と決めたら固定**し、以後の全カットはこの参照画像から作る（見た目のブレ防止）。
  気に入らなければ `--force` で作り直す
