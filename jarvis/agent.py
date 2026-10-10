"""ジャービスの頭脳：Claude API とツール実行ループ。"""

import os

import anthropic

from .tools import TOOLS, run_tool

MODEL = os.environ.get("JARVIS_MODEL", "claude-opus-5-5")
# 音声会話は速さが大事なので low。じっくり考えさせたいときは medium / high に。
EFFORT = os.environ.get("JARVIS_EFFORT", "low")
MAX_STEPS = 8

SYSTEM_PROMPT = """\
あなたは「J.A.R.V.I.S.（ジャービス）」。ユーザー専属の有能で冷静なAIアシスタントです。
ユーザーのことは「ボス」と呼び、丁寧だが少しウィットのある執事のような口調で話してください。

あなたの返答は音声合成で読み上げられます。そのため:
- 基本は1〜3文の短い話し言葉で答える。長い説明が必要なときも要点から話す。
- Markdown、箇条書き記号、表、絵文字、URLは使わない。
- 数字や単位は読み上げやすく書く。

時刻・計算・天気・メモ・最新情報の検索にはツールを使い、推測で答えないこと。
ツールでできないことを頼まれたら、できないと率直に伝え、代わりにできることを提案すること。
"""


class Jarvis:
    def __init__(self):
        self.client = anthropic.Anthropic()  # ANTHROPIC_API_KEY を環境変数から読む
        self.sessions: dict[str, list] = {}

    def reset(self, session_id: str) -> None:
        self.sessions.pop(session_id, None)

    def chat(self, session_id: str, user_text: str) -> dict:
        # 会話履歴は追記のみ（過去のメッセージは書き換えない）
        messages = self.sessions.setdefault(session_id, [])
        messages.append({"role": "user", "content": user_text})
        used_tools: list[str] = []

        for _ in range(MAX_STEPS):
            response = self.client.beta.messages.create(
                model=MODEL,
                max_tokens=16000,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=messages,
                output_config={"effort": EFFORT},
                # 安全分類器に断られたとき、サーバー側で別モデルに自動で切り替える
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )

            if response.stop_reason == "refusal":
                messages.pop()  # 断られたターンは履歴に残さない
                return {"reply": "申し訳ありません、ボス。そのご依頼にはお応えできません。", "tools": used_tools}

            messages.append({"role": "assistant", "content": response.content})

            for block in response.content:
                if block.type in ("tool_use", "server_tool_use"):
                    used_tools.append(block.name)

            if response.stop_reason == "pause_turn":
                continue  # サーバーツール（Web検索）が途中で一時停止 → そのまま続きを依頼

            if response.stop_reason != "tool_use":
                text = "".join(b.text for b in response.content if b.type == "text").strip()
                if response.stop_reason == "max_tokens":
                    text += "（話が長くなりすぎたので、ここで区切ります）"
                return {"reply": text or "……", "tools": used_tools}

            results = []
            for block in response.content:
                if block.type == "tool_use":
                    output, is_error = run_tool(block.name, block.input)
                    results.append(
                        {"type": "tool_result", "tool_use_id": block.id, "content": output, "is_error": is_error}
                    )
            messages.append({"role": "user", "content": results})

        return {"reply": "処理が長引いています、ボス。もう少し具体的にご指示いただけますか。", "tools": used_tools}
