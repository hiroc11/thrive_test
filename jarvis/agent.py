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

計算について:
- 簡単な四則演算は calculate を使う。
- 方程式、微分・積分、極限、行列、統計、確率、数列、ローン・複利などの金融計算、単位換算、グラフにしたい値の計算など
  高度な計算は code_execution で Python（sympy / numpy / scipy / pandas）を書いて正確に求める。暗算で済ませない。
- 計算に使ったコードと出力は画面に表示されるので、声では結論と大事なポイントだけを話す。
  数式は「エックスの二乗」「ルート2」のように読み上げられる言葉で言う。
- 小数は意味のある桁で丸めて話し、厳密な値（分数・ルートなど）があれば添える。
- 同じ会話の中では前の計算結果や変数を引き継げるので、「さっきの答えを2倍して」のような続きの依頼にも応じる。
ツールでできないことを頼まれたら、できないと率直に伝え、代わりにできることを提案すること。
"""


class Jarvis:
    def __init__(self):
        self.client = anthropic.Anthropic()  # ANTHROPIC_API_KEY を環境変数から読む
        # セッションごとに会話履歴と、コード実行用コンテナのIDを持つ
        self.sessions: dict[str, dict] = {}

    def reset(self, session_id: str) -> None:
        self.sessions.pop(session_id, None)

    def chat(self, session_id: str, user_text: str) -> dict:
        session = self.sessions.setdefault(session_id, {"messages": [], "container": None})
        messages = session["messages"]
        # 会話履歴は追記のみ（過去のメッセージは書き換えない）
        turn_start = len(messages)
        messages.append({"role": "user", "content": user_text})
        used_tools: list[str] = []
        details: list[dict] = []  # 画面に表示する計算の中身（コードと出力）

        for _ in range(MAX_STEPS):
            extra = {"container": session["container"]} if session["container"] else {}
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
                **extra,
            )

            if response.stop_reason == "refusal":
                del messages[turn_start:]  # 断られたターンは履歴に残さない
                return {"reply": "申し訳ありません、ボス。そのご依頼にはお応えできません。", "tools": used_tools, "details": details}

            # 同じコンテナを使い続けると、前の計算の変数やファイルを引き継げる
            if response.container:
                session["container"] = response.container.id

            messages.append({"role": "assistant", "content": response.content})
            _collect(response.content, used_tools, details)

            if response.stop_reason == "pause_turn":
                continue  # サーバーツール（Web検索・コード実行）が途中で一時停止 → そのまま続きを依頼

            if response.stop_reason != "tool_use":
                text = "".join(b.text for b in response.content if b.type == "text").strip()
                if response.stop_reason == "max_tokens":
                    text += "（話が長くなりすぎたので、ここで区切ります）"
                return {"reply": text or "……", "tools": used_tools, "details": details}

            results = []
            for block in response.content:
                if block.type == "tool_use":
                    output, is_error = run_tool(block.name, block.input)
                    results.append(
                        {"type": "tool_result", "tool_use_id": block.id, "content": output, "is_error": is_error}
                    )
            messages.append({"role": "user", "content": results})

        return {
            "reply": "処理が長引いています、ボス。もう少し具体的にご指示いただけますか。",
            "tools": used_tools,
            "details": details,
        }


def _collect(content, used_tools: list[str], details: list[dict]) -> None:
    """応答から、使ったツール名と、コード実行の中身（コード・出力）を拾い出す。"""
    pending = {}  # server_tool_use の id → details の要素
    for block in content:
        if block.type in ("tool_use", "server_tool_use"):
            name = "code_execution" if "code_execution" in block.name else block.name
            used_tools.append(name)
            if block.type == "server_tool_use" and name == "code_execution":
                code = block.input.get("command") or block.input.get("file_text") or ""
                if code:
                    pending[block.id] = {"code": code, "output": ""}
                    details.append(pending[block.id])
        elif block.type == "bash_code_execution_tool_result" and block.tool_use_id in pending:
            result = block.content
            if result.type == "bash_code_execution_result":
                pending[block.tool_use_id]["output"] = (result.stdout or "") + (result.stderr or "")
            else:
                pending[block.tool_use_id]["output"] = f"エラー: {result.error_code}"
