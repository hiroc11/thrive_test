# 縦型AIアニメ制作 Web UI（ローカル専用）

自分のPCだけで使う制作用の画面です。

## 起動

```
pip install -r webui/requirements.txt
python3 webui/app.py
```

ブラウザで http://127.0.0.1:8000 を開きます。このPC以外からは開けません。

## できること

1. **キャラクター**：名前、英語プロンプト、基準画像（PNG / JPEG / WebP、20MBまで）を登録・編集・削除
2. **エピソード**：1話6カット分の「話す人・日本語セリフ・英語の画像プロンプト・英語のカメラ／動きのプロンプト・出るキャラ」を入力して保存（Ctrl+S でも保存）

## 保存先

- キャラクター：`assets/characters/`（`characters.json` と画像）
- エピソード：`storyboards/epNN.json`（`tools/pipeline.py` でそのまま使える形式）
