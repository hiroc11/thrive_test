# J.A.R.V.I.S. — ブラウザ音声アシスタント

アイアンマンのジャービス風AIアシスタントです。ブラウザに話しかけると、Claudeが考え、必要ならツールを使い、声で答えます。

- 🎙 **音声入力**: ブラウザの Web Speech API（Chrome / Edge 推奨）
- 🔊 **音声出力**: ブラウザの音声合成（日本語ボイス）
- 🧠 **頭脳**: Claude API（`claude-opus-5-5`）
- 🛠 **ツール**: 現在時刻 / 計算 / 天気（Open-Meteo、キー不要）/ メモ保存・一覧 / Web検索
- 👂 **ウェイクワード**: ONにすると「ジャービス、今日の天気は？」のように呼びかけで反応
- 💠 アークリアクター風のHUD画面（待機・聞き取り・思考・発話で動きが変わる）

## 構成

```
jarvis/
  server.py        FastAPI サーバー（画面と /api/chat を提供）
  agent.py         Claude との会話とツール実行ループ、ジャービスの人格（システムプロンプト）
  tools.py         ジャービスが使えるツール
  static/index.html  HUD画面・音声認識・音声合成
data/memos.json    メモの保存先（自動作成）
```

## 動かし方

1. Python 3.10 以上を用意して、依存をインストール

   ```bash
   python -m venv .venv
   source .venv/bin/activate        # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. Anthropic の APIキーを設定（https://console.anthropic.com で発行）

   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...   # Windows (PowerShell): $env:ANTHROPIC_API_KEY="sk-ant-..."
   ```

3. 起動

   ```bash
   uvicorn jarvis.server:app --reload
   ```

4. Chrome で http://localhost:8000 を開き、🎙 ボタン（または中央のリアクター）を押して話しかける。
   初回はマイクの許可を求められます。

> スマホから使う場合、マイクは HTTPS か localhost でしか使えません。
> 同じWi-Fi内のスマホで試すなら `ngrok http 8000` などでHTTPSのURLを作るのが簡単です。

## 話しかけ方の例

- 「今何時？」
- 「東京の天気を教えて」
- 「1280円の3割引きはいくら？」
- 「明日の10時に歯医者って覚えておいて」→「メモを読み上げて」
- 「最新のiPhoneについて調べて」（Web検索）

## カスタマイズ

| やりたいこと | 場所 |
|---|---|
| 性格・口調を変える | `jarvis/agent.py` の `SYSTEM_PROMPT` |
| もっと賢く（遅く・高く）する | 環境変数 `JARVIS_EFFORT=medium` または `high`（既定は応答速度重視の `low`） |
| モデルを変える | 環境変数 `JARVIS_MODEL`（例: `claude-sonnet-5-5` で安く・速く） |
| ツールを増やす | `jarvis/tools.py` に関数を書き、`TOOLS`（説明）と `HANDLERS`（関数）に追加 |
| 声を変える | `index.html` の `pickVoice()`、`u.rate` / `u.pitch` |
| ウェイクワードを変える | `index.html` の `WAKE_WORDS` |

## 次のステップのアイデア

- より自然な声: ElevenLabs や VOICEVOX などのTTSに差し替え
- スマートホーム連携: SwitchBot / Home Assistant のAPIをツールとして追加（「ジャービス、電気を消して」）
- カレンダー・メール連携: Google Calendar API をツール化
- 返答のストリーミング再生で応答をさらに速く
- 会話履歴の永続化（今はサーバーを再起動すると会話を忘れます。メモは残ります）
