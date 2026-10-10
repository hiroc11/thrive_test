"""ジャービスのWebサーバー。 起動: uvicorn jarvis.server:app --reload"""

from pathlib import Path

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .agent import Jarvis

STATIC = Path(__file__).resolve().parent / "static"

app = FastAPI(title="J.A.R.V.I.S.")
jarvis = Jarvis()


class ChatRequest(BaseModel):
    session_id: str
    message: str


class ResetRequest(BaseModel):
    session_id: str


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.post("/api/chat")
async def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(400, "メッセージが空です")
    try:
        return await run_in_threadpool(jarvis.chat, req.session_id, req.message)
    except anthropic.AuthenticationError:
        raise HTTPException(401, "APIキーが無効です。ANTHROPIC_API_KEY を確認してください。")
    except anthropic.RateLimitError:
        raise HTTPException(429, "混み合っています。少し待ってからもう一度どうぞ。")
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"Claude API エラー ({e.status_code}): {e.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(503, "Claude API に接続できません。ネットワークを確認してください。")


@app.post("/api/reset")
def reset(req: ResetRequest):
    jarvis.reset(req.session_id)
    return {"ok": True}
