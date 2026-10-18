"""縦型AIアニメ制作 Web UI（ローカル専用）。

起動:
  pip install -r webui/requirements.txt
  python3 webui/app.py            # → http://127.0.0.1:8000

保存先:
  キャラクター  assets/characters/characters.json と画像
  エピソード    storyboards/epNN.json（tools/pipeline.py と同じ形式）
"""
import json
import re
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
STATIC = Path(__file__).resolve().parent / "static"
CHAR_DIR = ROOT / "assets" / "characters"
CHAR_DB = CHAR_DIR / "characters.json"
BOARD_DIR = ROOT / "storyboards"

CUTS_PER_EPISODE = 6
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
MAX_IMAGE_BYTES = 20 * 1024 * 1024

app = FastAPI(title="縦型AIアニメ制作")


# ---------- キャラクター ----------

def load_chars():
    if CHAR_DB.exists():
        return json.loads(CHAR_DB.read_text(encoding="utf-8"))
    return []


def save_chars(chars):
    CHAR_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CHAR_DB.with_suffix(".tmp")
    tmp.write_text(json.dumps(chars, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(CHAR_DB)  # 書き込み途中で壊れないよう、置き換えで保存する


def find_char(chars, char_id):
    for c in chars:
        if c["id"] == char_id:
            return c
    raise HTTPException(404, "キャラクターが見つかりません")


async def store_image(upload: UploadFile, char_id: str) -> str:
    ext = IMAGE_TYPES.get(upload.content_type or "")
    if ext is None:
        raise HTTPException(400, "画像は PNG / JPEG / WebP のみ登録できます")
    data = await upload.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "画像が大きすぎます（20MBまで）")
    name = f"{char_id}_{uuid.uuid4().hex[:8]}{ext}"
    (CHAR_DIR / name).write_bytes(data)
    return name


@app.get("/api/characters")
def list_characters():
    return load_chars()


@app.post("/api/characters")
async def create_character(name: str = Form(...), prompt: str = Form(""), image: UploadFile = File(...)):
    name = name.strip()
    if not name:
        raise HTTPException(400, "名前を入力してください")
    CHAR_DIR.mkdir(parents=True, exist_ok=True)
    char_id = uuid.uuid4().hex[:10]
    char = {"id": char_id, "name": name, "prompt": prompt.strip(), "image": await store_image(image, char_id)}
    chars = load_chars()
    chars.append(char)
    save_chars(chars)
    return char


@app.put("/api/characters/{char_id}")
async def update_character(char_id: str, name: str = Form(...), prompt: str = Form(""),
                           image: UploadFile | None = File(None)):
    chars = load_chars()
    char = find_char(chars, char_id)
    if not name.strip():
        raise HTTPException(400, "名前を入力してください")
    char["name"], char["prompt"] = name.strip(), prompt.strip()
    if image is not None and image.filename:
        old = CHAR_DIR / char["image"]
        char["image"] = await store_image(image, char_id)
        old.unlink(missing_ok=True)
    save_chars(chars)
    return char


@app.delete("/api/characters/{char_id}")
def delete_character(char_id: str):
    chars = load_chars()
    char = find_char(chars, char_id)
    (CHAR_DIR / char["image"]).unlink(missing_ok=True)
    save_chars([c for c in chars if c["id"] != char_id])
    return {"ok": True}


@app.get("/files/characters/{name}")
def character_image(name: str):
    path = (CHAR_DIR / name).resolve()
    if path.parent != CHAR_DIR.resolve() or not path.is_file():  # フォルダの外は読ませない
        raise HTTPException(404)
    return FileResponse(path)


# ---------- エピソード（6カット） ----------

class Cut(BaseModel):
    dialogue: str = ""          # 日本語セリフ
    speaker: str = ""           # 話すキャラクターのID（空ならナレーションなど）
    image_prompt: str = ""      # 英語の画像プロンプト
    motion_prompt: str = ""     # 英語のカメラ・動きのプロンプト
    characters: list[str] = Field(default_factory=list)  # このカットに出るキャラクターのID


class Episode(BaseModel):
    title: str = ""
    cuts: list[Cut]


def board_path(ep: int) -> Path:
    if not 1 <= ep <= 999:
        raise HTTPException(400, "話数は1〜999で指定してください")
    return BOARD_DIR / f"ep{ep:02d}.json"


@app.get("/api/episodes")
def list_episodes():
    out = []
    for p in sorted(BOARD_DIR.glob("ep*.json")):
        m = re.fullmatch(r"ep(\d+)", p.stem)
        if m:
            data = json.loads(p.read_text(encoding="utf-8"))
            out.append({"episode": int(m.group(1)), "title": data.get("title", "")})
    return out


@app.get("/api/episodes/{ep}")
def get_episode(ep: int):
    path = board_path(ep)
    if not path.exists():
        return {"episode": ep, "title": "", "cuts": [Cut().model_dump() for _ in range(CUTS_PER_EPISODE)]}
    data = json.loads(path.read_text(encoding="utf-8"))
    cuts = []
    for c in data.get("cuts", [])[:CUTS_PER_EPISODE]:
        line = (c.get("lines") or [{}])[0]
        cuts.append(Cut(dialogue=line.get("text", ""), speaker=line.get("speaker", ""),
                        image_prompt=c.get("image_prompt") or "", motion_prompt=c.get("motion_prompt") or "",
                        characters=c.get("characters", [])).model_dump())
    cuts += [Cut().model_dump() for _ in range(CUTS_PER_EPISODE - len(cuts))]
    return {"episode": ep, "title": data.get("title", ""), "cuts": cuts}


@app.put("/api/episodes/{ep}")
def save_episode(ep: int, body: Episode):
    if len(body.cuts) != CUTS_PER_EPISODE:
        raise HTTPException(400, f"カットは{CUTS_PER_EPISODE}つ必要です")
    path = board_path(ep)
    chars = {c["id"]: c for c in load_chars()}
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    old_cuts = old.get("cuts", [])
    # tools/pipeline.py が読める形式で保存する（既存の設定項目は残す）
    data = {
        **old,
        "episode": ep,
        "title": body.title.strip(),
        "aspect_ratio": "9:16",
        "out_dir": old.get("out_dir", f"assets/stills/ep{ep:02d}"),
        "characters": {cid: {"name": c["name"], "prompt": c["prompt"],
                             "ref": f"assets/characters/{c['image']}"}
                       for cid, c in chars.items()},
        "cuts": [
            {
                **(old_cuts[i] if i < len(old_cuts) else {}),
                "id": f"C{i + 1:02d}",
                "duration": 5,
                "characters": [k for k in cut.characters if k in chars],
                "image_prompt": cut.image_prompt.strip(),
                "motion_prompt": cut.motion_prompt.strip(),
                "lines": ([{"speaker": cut.speaker, "text": cut.dialogue.strip()}]
                          if cut.dialogue.strip() else []),
            }
            for i, cut in enumerate(body.cuts)
        ],
    }
    BOARD_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return {"ok": True, "path": str(path.relative_to(ROOT))}


# ---------- 画面 ----------

@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")


if __name__ == "__main__":
    import uvicorn

    # 自分専用なので、このPCからしか開けないよう 127.0.0.1 で待ち受ける
    uvicorn.run(app, host="127.0.0.1", port=8000)
