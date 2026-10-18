@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 縦型AIアニメ制作

where python > nul 2>&1
if errorlevel 1 (
  echo [エラー] Python が見つかりません。
  echo python.org から Python をインストールし、最初の画面で「Add python.exe to PATH」にチェックを入れてください。
  pause
  exit /b 1
)
where ffmpeg > nul 2>&1
if errorlevel 1 (
  echo [注意] FFmpeg が見つかりません。書き出し機能を使うにはインストールが必要です。
  echo   コマンドプロンプトで次を実行してください: winget install Gyan.FFmpeg
  echo.
)
if not exist keys.env (
  copy keys.env.example keys.env > nul
  echo [お知らせ] webui フォルダに keys.env を作りました。メモ帳で開いて API キーを書き込んでください。
  echo.
)

echo 必要なライブラリを確認しています（初回は数分かかります）...
python -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo [エラー] ライブラリのインストールに失敗しました。
  pause
  exit /b 1
)

echo.
echo 起動します。ブラウザで http://127.0.0.1:8000 が開きます。
echo 終わるときは、この黒い画面を閉じてください。
start "" http://127.0.0.1:8000
python app.py
pause
