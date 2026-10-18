# 縦型AIアニメ制作 Web UI（ローカル専用）

自分のPCだけで使う、縦型ショートアニメの制作画面です。

## かんたん起動（ダブルクリック）

1. python.org から Python をインストールする（最初の1回だけ）
   - Windows：最初の画面で「Add python.exe to PATH」にチェックを入れる
   - FFmpeg は自分で入れなくてよい。見つからなければ、初回起動時に自動でダウンロードする（Intel Mac でも可）
2. `webui` フォルダの起動ファイルをダブルクリックする
   - Windows：`start_windows.bat`
   - Mac：`start_mac.command`（初回は右クリック →「開く」）
3. 初回は `webui/keys.env` が自動で作られるので、メモ帳などで開いて API キーを書き込み、起動し直す

`keys.env` はこのPCだけに置かれ、GitHub には上がりません。

## 手動で準備する場合

1. Python 3.10 以上と FFmpeg をインストールする（`ffmpeg` と `ffprobe` にPATHを通す）
2. ライブラリを入れる
   ```
   pip install -r webui/requirements.txt
   ```
3. API キーを `webui/keys.env` に書く（`keys.env.example` をコピーして作る）か、環境変数に設定する
   - `FAL_KEY`：fal.ai のキー
   - `AIVIS_API_KEY`：Aivis Cloud API のキー（Aivis を使う場合）
   - `FISH_API_KEY`：Fish Audio のキー（Fish Audio を使う場合）

   制作画面の「設定」タブからキーを入力して保存することもできます。

## 起動

```
python3 webui/app.py
```

ブラウザで http://127.0.0.1:8000 を開きます。このPC以外からは開けません。

APIを使わずに画面の動きだけ試したいときは、`WEBUI_FAKE=1` を付けて起動すると、仮の画像・動画・音声を手元で作ります（料金はかかりません）。

```
WEBUI_FAKE=1 python3 webui/app.py
```

## できること

1. **キャラクター**：名前、英語プロンプト、声のID（Aivis／Fish Audio）、基準画像（PNG / JPEG / WebP、20MBまで）を登録・編集・削除
2. **エピソード**：1話6カット分の「話す人・日本語セリフ・英語の画像プロンプト・英語のカメラ／動きのプロンプト・出るキャラ」を、**SNS版**と**完全版**の2パターンで入力・保存（Ctrl+S でも保存。「もう一方の版にコピー」で丸ごと複製）
3. **カットごとの生成**（ボタンを押すと、入力中の内容を保存してから生成）
   - ① 静止画：出るキャラの基準画像を参考にして生成する。初期設定では fal.ai の Seedream 4.0 Edit に参考画像を1枚ずつそのまま渡す（服装や顔が崩れにくい）。設定で従来の FLUX.1 Kontext [dev]（基準画像を縦型の1枚にまとめる）に切り替えられる。参考画像がないカットは FLUX.1 [dev] で文章から生成
   - 「前のカットの静止画を参考にする」にチェックすると、1つ前のカットの静止画も参考画像に加え、場所・背景・色をそろえる（前のカットの静止画を先に作っておく）
   - ② 5秒動画：静止画を fal.ai の Wan 2.1 I2V で動かす
   - ③ 音声：設定画面で選んだ音声サービス（Aivis Cloud API または Fish Audio）でセリフを読み上げる。話す人の声、ナレーション・心の声は設定画面の声を使う
4. **書き出し**：「SNS版書き出し」「完全版書き出し」で、全カットの動画・音声・セリフ字幕を結合して 1080×1920 の MP4 を出力
   - 各カットの長さは5秒（セリフが長いときは音声に合わせて延びる）
   - 動画がないカットは静止画にゆっくり寄る動きを付け、何もないカットは黒画面

## 設定画面

- 音声サービスの切り替え（Aivis Cloud API／Fish Audio）、ナレーション・心の声に使う声、Fish Audio のモデル
- 静止画の作り方（複数参照／Kontext）
- fal.ai のセーフティチェッカー（`enable_safety_checker`、初期値はオフ）
- 動画の解像度（720p / 480p）
- 使うモデル名（新しいモデルに変えるとき用）
- 字幕の日本語フォント（空なら Windows / Mac / Linux の標準フォントを自動で探す）

## 保存先

| 内容 | 場所 |
| --- | --- |
| キャラクター | `assets/characters/`（`characters.json` と画像） |
| エピソード | `storyboards/epNN_sns.json`、`storyboards/epNN_full.json`（`tools/pipeline.py` と同じ形式） |
| 生成した素材 | `assets/episodes/epNN/<sns|full>/Cxx/`（生成のたびに新しいファイルで残る） |
| 書き出した動画 | `exports/epNN_sns.mp4`、`exports/epNN_full.mp4` |
| 設定 | `webui/settings.local.json` |

生成した素材・書き出した動画・設定は容量が大きい／個人用なので、Git の管理対象から外しています。
