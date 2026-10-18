#!/bin/bash
# ダブルクリックで起動する（Mac用）
cd "$(dirname "$0")"

if ! command -v python3 > /dev/null; then
  echo "[エラー] Python が見つかりません。python.org から Python をインストールしてください。"
  read -p "Enterキーで閉じます"
  exit 1
fi
if ! command -v ffmpeg > /dev/null; then
  echo "[注意] FFmpeg が見つかりません。書き出し機能を使うにはインストールが必要です。"
  echo "  ターミナルで次を実行してください: brew install ffmpeg"
  echo
fi
if [ ! -f keys.env ]; then
  cp keys.env.example keys.env
  echo "[お知らせ] webui フォルダに keys.env を作りました。テキストエディットで開いて API キーを書き込んでください。"
  echo
fi

echo "必要なライブラリを確認しています（初回は数分かかります）..."
python3 -m pip install -q -r requirements.txt || { echo "[エラー] ライブラリのインストールに失敗しました。"; read -p "Enterキーで閉じます"; exit 1; }

echo
echo "起動します。ブラウザで http://127.0.0.1:8000 が開きます。"
echo "終わるときは、このウィンドウで Control + C を押してください。"
(sleep 2; open http://127.0.0.1:8000) &
python3 app.py
