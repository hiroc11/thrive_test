"""ジャービスが使えるツール（関数）群。

ツールを増やしたいときは、関数を書いて TOOLS と HANDLERS に1つずつ追加するだけでよい。
"""

import ast
import json
import operator
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

MEMO_FILE = Path(__file__).resolve().parent.parent / "data" / "memos.json"

# Anthropic 側で実行されるサーバーツール（実装不要）
WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 3}
# Anthropic のサンドボックスで Python を実行できる（numpy / scipy / sympy / pandas 入り）。
# 方程式・微積分・行列・統計・金融計算などの高度な計算に使う。
CODE_EXECUTION = {"type": "code_execution_20260521", "name": "code_execution"}

TOOLS = [
    {
        "name": "get_current_time",
        "description": "現在の日付と時刻を返す。時刻・日付・曜日を聞かれたときに使う。",
        "input_schema": {
            "type": "object",
            "properties": {
                "timezone": {
                    "type": "string",
                    "description": "IANAタイムゾーン名。省略時は Asia/Tokyo。",
                }
            },
            "required": [],
            "additionalProperties": False,
        },
    },
    {
        "name": "calculate",
        "description": (
            "四則演算・べき乗・剰余だけの簡単な数式を素早く計算する。例: '(12.5 + 3) * 4 ** 2'。"
            "関数・方程式・微積分・統計などが必要なら code_execution を使う。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {"expression": {"type": "string", "description": "計算する数式"}},
            "required": ["expression"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_weather",
        "description": "指定した都市の現在の天気と今日の最高・最低気温を取得する。",
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "都市名（例: 東京, Osaka）"}},
            "required": ["city"],
            "additionalProperties": False,
        },
    },
    {
        "name": "save_memo",
        "description": "ユーザーに頼まれた内容をメモとして保存する。「覚えておいて」「メモして」と言われたときに使う。",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string", "description": "保存する内容"}},
            "required": ["text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_memos",
        "description": "保存済みのメモを一覧で返す。",
        "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    },
    WEB_SEARCH,
    CODE_EXECUTION,
]


def get_current_time(timezone: str = "Asia/Tokyo") -> str:
    now = datetime.now(ZoneInfo(timezone))
    weekday = "月火水木金土日"[now.weekday()]
    return now.strftime(f"%Y年%m月%d日（{weekday}） %H時%M分 ({timezone})")


_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def _eval(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        left, right = _eval(node.left), _eval(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 1000:
            raise ValueError("指数が大きすぎます")
        return _OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval(node.operand))
    raise ValueError("使えない記号が含まれています")


def calculate(expression: str) -> str:
    # eval() は使わず、数値と演算子だけを許可して安全に計算する
    return str(_eval(ast.parse(expression, mode="eval").body))


_WEATHER_CODES = {
    0: "快晴", 1: "晴れ", 2: "一部曇り", 3: "曇り", 45: "霧", 48: "霧",
    51: "弱い霧雨", 53: "霧雨", 55: "強い霧雨", 61: "弱い雨", 63: "雨", 65: "強い雨",
    71: "弱い雪", 73: "雪", 75: "強い雪", 80: "にわか雨", 81: "にわか雨", 82: "激しいにわか雨",
    95: "雷雨", 96: "雹を伴う雷雨", 99: "雹を伴う雷雨",
}


def get_weather(city: str) -> str:
    # Open-Meteo は APIキー不要の無料天気API
    geo = httpx.get(
        "https://geocoding-api.open-meteo.com/v1/search",
        params={"name": city, "count": 1, "language": "ja"},
        timeout=10,
    ).json()
    if not geo.get("results"):
        raise ValueError(f"都市 '{city}' が見つかりません")
    place = geo["results"][0]
    data = httpx.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": place["latitude"],
            "longitude": place["longitude"],
            "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "timezone": "auto",
            "forecast_days": 1,
        },
        timeout=10,
    ).json()
    cur, daily = data["current"], data["daily"]
    return json.dumps(
        {
            "場所": place["name"],
            "天気": _WEATHER_CODES.get(cur["weather_code"], f"コード{cur['weather_code']}"),
            "気温": f"{cur['temperature_2m']}℃",
            "湿度": f"{cur['relative_humidity_2m']}%",
            "風速": f"{cur['wind_speed_10m']}km/h",
            "最高気温": f"{daily['temperature_2m_max'][0]}℃",
            "最低気温": f"{daily['temperature_2m_min'][0]}℃",
            "降水確率": f"{daily['precipitation_probability_max'][0]}%",
        },
        ensure_ascii=False,
    )


def _load_memos() -> list:
    if MEMO_FILE.exists():
        return json.loads(MEMO_FILE.read_text(encoding="utf-8"))
    return []


def save_memo(text: str) -> str:
    memos = _load_memos()
    memos.append({"text": text, "saved_at": datetime.now().isoformat(timespec="minutes")})
    MEMO_FILE.parent.mkdir(exist_ok=True)
    MEMO_FILE.write_text(json.dumps(memos, ensure_ascii=False, indent=2), encoding="utf-8")
    return f"保存しました（メモ{len(memos)}件目）"


def list_memos() -> str:
    memos = _load_memos()
    if not memos:
        return "メモはありません"
    return "\n".join(f"{i}. {m['text']} ({m['saved_at']})" for i, m in enumerate(memos, 1))


HANDLERS = {
    "get_current_time": get_current_time,
    "calculate": calculate,
    "get_weather": get_weather,
    "save_memo": save_memo,
    "list_memos": list_memos,
}


def run_tool(name: str, args: dict) -> tuple[str, bool]:
    """ツールを実行して (結果文字列, エラーかどうか) を返す。"""
    handler = HANDLERS.get(name)
    if handler is None:
        return f"不明なツール: {name}", True
    try:
        return handler(**args), False
    except Exception as e:  # ツールの失敗はClaudeに伝えて言い直させる
        return f"エラー: {e}", True
