# AIビジネス10分解説 — 動画制作パイプライン

台本（`script.json`）から、YouTube の **長尺動画・切り抜きショート・サムネ3案・概要欄（チャプター・出典つき）** を自動で書き出します。
リサーチと台本の下書きは Claude Code が担当し、人は **事実確認・自分の意見・公開** だけを行います。

```
[Claude Code /make-episode]  リサーチ → 台本の下書き → 仮書き出し → コミット
            ↓
[人 15分]  出典と数字を確認 → 意見を自分の言葉に → review_status を "approved"
            ↓
[python -m autovideo build]  音声(ElevenLabs) + 画像(fal.ai) + 図表 + 字幕 → mp4
            ↓
[人 5分]   サムネを選ぶ → YouTube に予約投稿（AIの開示を確認）
            ↓
[Claude Code /weekly-review]  YouTube Studio の CSV を分析 → 翌週の提案 → 次の台本に反映
```

## セットアップ

```bash
pip install -r requirements.txt
python -m unittest discover -s tests   # 動作確認
```

APIキーは環境変数で渡します（Claude Code on the web では環境設定の API credentials / 環境変数に登録）。
**キーが無い場合は自動で仮素材（無音＋仮画像）になる**ので、キー無しでも流れ全体を試せます。

| 変数 | 用途 |
|---|---|
| `ELEVENLABS_API_KEY` | ナレーション音声 |
| `ELEVENLABS_VOICE_ID` | 使う声の ID（ElevenLabs の Voice Library で選ぶ） |
| `FAL_KEY` | 背景画像・サムネ画像の生成（既定モデル: `fal-ai/flux/schnell`） |

ネットワーク制限のある環境では `api.elevenlabs.io`, `fal.run`, `*.fal.media` への通信許可が必要です。

画像生成の既定モデル: 通常 `fal-ai/flux/schnell`、キャラ参照つき `fal-ai/flux-pro/kontext`、動画 `fal-ai/kling-video/v2.1/standard/image-to-video`（`config.json` で変更可）。

## 使い方

```bash
# サンプルを仮素材で書き出す（未承認なので --draft）
python -m autovideo build content/sample-ai-video-workflow/script.json --draft

# 新しい台本のひな形
python -m autovideo new ai-news-1005 --format news_top5 --title "今週のAIニュースTOP5"

# チェック（承認前は --draft）
python -m autovideo validate content/2026-10-05-ai-news-1005/script.json

# 本番書き出し（approved の台本のみ）
python -m autovideo build content/2026-10-05-ai-news-1005/script.json
# 一部だけ: --only long / --only shorts,thumbs    仮素材を強制: --tts dummy --images dummy
```

出力（`output/<slug>/`）:

| ファイル | 内容 |
|---|---|
| `long.mp4` | 1920x1080 の長尺（ゆっくりズーム＋字幕＋BGM） |
| `shorts/short_N.mp4`, `short_N.txt` | 1080x1920 のショートと投稿キャプション |
| `thumbs/thumb_1〜3.png` | サムネ3案（1280x720） |
| `description.txt` | 概要欄（チャプター・出典・AI開示文・タグ） |

生成した音声・画像はキャッシュされるので、台本の一部を直して再実行しても変わった区間だけ作り直します（API代の節約）。

台本の書き方は [docs/script-format.md](docs/script-format.md)、チャンネルのルールは [CLAUDE.md](CLAUDE.md)。

## Claude Code での自動化

| スキル | 内容 | おすすめの定期実行 |
|---|---|---|
| `/make-episode` | ニュース回（TOP5）と深掘り回を交互に、リサーチ→台本→仮書き出し→コミット | 毎週月曜（ニュース）・木曜（深掘り） |
| `/weekly-review` | `data/analytics/` の CSV を分析して `reports/` に改善案 | 毎週日曜 |

Claude Code のルーティン（定期実行）に「`/make-episode` を実行して」と登録すれば、週2本の下書き（ニュース回＋そのニュースの深掘り回）が自動で上がってきます。
ショートはニュース回の驚く数字・結論の区間から切り出します。

## アニメ・実写ショート（別チャンネル）

オリジナルキャラで縦型ショートを作ります。2シリーズを交互に投稿します。

- **お約束を実写でやってみた**（`otoyaku`）: 「食パンをくわえて遅刻ダッシュ」などアニメの定番を実写風で再現し、「現実だとこうなる」で落とす
- **アニメ⇄実写**（`anime_vs_live`）: オリジナルキャラのアニメ版と実写版を見せる（上下比較レイアウトあり）

```bash
# キャラを作る → 参照画像（アニメ版・実写版）を作って人が採用を決める
python -m autovideo character-new hana --name ハナ
python -m autovideo character-refs hana

# スキットを作る → チェック → 書き出し
python -m autovideo skit-new toast-dash --series otoyaku --chars hana,kaito
python -m autovideo skit-validate skits/<dir>/skit.json --draft
python -m autovideo skit-build skits/<dir>/skit.json --draft   # 承認後は --draft なし
```

出力は `output/skits/<slug>/short.mp4` と `caption.txt`（投稿文＋投稿時チェック）。
カットごとに静止画（ゆっくりズーム）か、画像から生成した5秒動画（`shot: video`、fal.ai の Kling）を使います。
キャラ別の声は `character.json` の `voice_id_env`（例: `VOICE_ID_HANA`）で ElevenLabs の voice ID を指定します。
Claude Code では `/make-skit` で、ネタ選び → 脚本 → 下書き書き出しまで行います。
サンプル: `skits/sample-otoyaku-toast/`、`skits/sample-hana-live/`、キャラ `characters/hana`・`characters/kaito`。

## 収益化ポリシーのために組み込んでいる仕組み

- `review_status: "approved"` でないと本番書き出しできない（人の確認を必須に）
- 自分の見解の区間（`opinion`）が無い・`TODO` が残っている・ニュース系で出典が無い台本はエラー
- 図表には出典必須、概要欄に出典と AI 利用の開示文を自動で記載
- 8分未満（ミッドロール不可）・チャプター条件未達は警告

## 次の拡張候補

- YouTube Data API で「非公開で予約アップロード」まで自動化
- 冒頭数秒だけ動画生成AI（Kling / Veo）のクリップを使う
- ElevenLabs のタイムスタンプ API で字幕タイミングを正確に
