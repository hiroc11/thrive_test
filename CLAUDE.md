# AIビジネス10分解説 — 動画制作パイプライン

顔出しなしの YouTube チャンネル（AI×ビジネスの解説、長尺10〜12分＋切り抜きショート）を
半自動で制作するリポジトリ。広告収益が目的なので、YouTube の収益化ポリシーを最優先で守る。

## 構成

- `autovideo/` — script.json から動画を書き出す Python パッケージ（`python -m autovideo --help`）
- `content/<日付>-<slug>/script.json` — 1本分の台本。形式は `docs/script-format.md`
- `output/` — 書き出し結果（git 管理外）
- `data/analytics/` — YouTube Studio から書き出した CSV
- `reports/` — 週次の分析レポート
- `.claude/skills/make-episode` — 1本作る手順 / `.claude/skills/weekly-review` — 週次分析

## チャンネルのルール（台本を書くときに必ず守る）

1. **事実には出典**。ニュース・数字・企業の事例は一次情報（公式発表・論文・決算資料）を優先し、`sources` に URL を書く。確認できないことは言い切らない。
2. **自分の見解を入れる**。`"opinion": true` の区間を必ず1つ以上。AI は下書きまでで、最終的な意見は人が書き直す前提で `TODO(人):` を残してよい。
3. **使い回し・量産に見せない**。4つのフォーマットを順番に回し、同じ構成・同じ言い回しを続けない。他人の動画・記事の文章をそのまま読まない（要約＋自分の分析にする）。
4. **権利**。実在の人物・ロゴ・キャラクターを画像生成プロンプトに入れない。数字は `chart`（出典つき）で見せる。
5. **AIの開示**。概要欄に開示文が自動で入る。リアルな人物・出来事に見える生成映像を使う回は、アップロード時に「改変または合成されたコンテンツ」を「はい」にするようメモを残す。
6. **公開は人が行う**。`review_status` を `"approved"` にするのは人だけ。Claude は `"draft"` のまま渡す。

## 開発

- テスト: `python -m unittest discover -s tests`
- 依存: `pip install -r requirements.txt`（ffmpeg は imageio-ffmpeg 同梱のものを使う）
- APIキーは環境変数（`FAL_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`）。無ければ仮素材で書き出す
