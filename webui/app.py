"""縦型AIアニメ制作 Web UI（ローカル専用）。

起動:
  pip install -r webui/requirements.txt
  python3 webui/app.py            # → http://127.0.0.1:8000

保存先:
  キャラクター      assets/characters/characters.json と画像
  エピソード        storyboards/epNN_sns.json / epNN_full.json（tools/pipeline.py と同じ形式）
  生成した素材      assets/episodes/epNN/<sns|full>/Cxx/
  書き出した動画    exports/epNN_<sns|full>.mp4
  設定              webui/settings.local.json
"""
import json
import re
import shutil
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import services as sv

ROOT = Path(__file__).resolve().parent.parent


def load_keys_file():
    """webui/keys.env（このPCだけに置くAPIキーのファイル）があれば、環境変数として読み込む。"""
    import os
    path = Path(__file__).resolve().parent / "keys.env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if value and not os.environ.get(key):  # すでに環境変数があれば、そちらを優先する
            os.environ[key] = value


load_keys_file()
STATIC = Path(__file__).resolve().parent / "static"
CHAR_DIR = ROOT / "assets" / "characters"
CHAR_DB = CHAR_DIR / "characters.json"
BOARD_DIR = ROOT / "storyboards"
MEDIA_DIR = ROOT / "assets" / "episodes"
EXPORT_DIR = ROOT / "exports"
SETTINGS = Path(__file__).resolve().parent / "settings.local.json"

CUTS_PER_EPISODE = 6
VARIANTS = {"sns": "SNS版", "full": "完全版"}
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
MAX_IMAGE_BYTES = 20 * 1024 * 1024
DEFAULT_SETTINGS = {
    "narrator_voice_actor_id": "",
    "voice_speed": 1.0,
    "enable_safety_checker": False,
    "video_resolution": "720p",
    "font_path": "",
    "models": {
        "image": "fal-ai/flux-kontext/dev",
        "image_t2i": "fal-ai/flux/dev",
        "video": "fal-ai/wan-i2v",
    },
}

app = FastAPI(title="縦型AIアニメ制作")
_lock = threading.Lock()  # JSONファイルの読み書きを同時に行わないためのロック


def read_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)  # 書き込み途中で壊れないよう、置き換えで保存する


# ---------- 設定 ----------

def load_settings():
    s = read_json(SETTINGS, {})
    merged = {**DEFAULT_SETTINGS, **s}
    merged["models"] = {**DEFAULT_SETTINGS["models"], **s.get("models", {})}
    return merged


@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.put("/api/settings")
def put_settings(body: dict):
    s = load_settings()
    for key in ("narrator_voice_actor_id", "font_path", "video_resolution"):
        if key in body:
            s[key] = str(body[key]).strip()
    if "voice_speed" in body:
        s["voice_speed"] = min(3.0, max(0.4, float(body["voice_speed"])))
    if "enable_safety_checker" in body:
        s["enable_safety_checker"] = bool(body["enable_safety_checker"])
    for key in ("image", "image_t2i", "video"):
        if body.get("models", {}).get(key):
            s["models"][key] = str(body["models"][key]).strip()
    write_json(SETTINGS, s)
    return s


@app.get("/api/status")
def status():
    import os
    s = load_settings()
    return {
        "fake_mode": sv.fake_mode(),
        "fal_key": bool(os.environ.get("FAL_KEY")),
        "nijivoice_key": bool(os.environ.get("NIJIVOICE_API_KEY")),
        "ffmpeg": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
        "font": sv.find_font(s.get("font_path", "")),
    }


@app.get("/api/voice-actors")
def get_voice_actors():
    try:
        return sv.voice_actors()
    except Exception as e:  # noqa: BLE001 キーなし・通信エラーは画面に伝える
        raise HTTPException(502, f"声優一覧を取得できませんでした: {e}") from e


# ---------- キャラクター ----------

def load_chars():
    return read_json(CHAR_DB, [])


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
    CHAR_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{char_id}_{uuid.uuid4().hex[:8]}{ext}"
    (CHAR_DIR / name).write_bytes(data)
    return name


@app.get("/api/characters")
def list_characters():
    return load_chars()


@app.post("/api/characters")
async def create_character(name: str = Form(...), prompt: str = Form(""), voice_actor_id: str = Form(""),
                           image: UploadFile = File(...)):
    if not name.strip():
        raise HTTPException(400, "名前を入力してください")
    char_id = uuid.uuid4().hex[:10]
    char = {"id": char_id, "name": name.strip(), "prompt": prompt.strip(),
            "voice_actor_id": voice_actor_id.strip(), "image": await store_image(image, char_id)}
    with _lock:
        chars = load_chars()
        chars.append(char)
        write_json(CHAR_DB, chars)
    return char


@app.put("/api/characters/{char_id}")
async def update_character(char_id: str, name: str = Form(...), prompt: str = Form(""),
                           voice_actor_id: str = Form(""), image: UploadFile | None = File(None)):
    if not name.strip():
        raise HTTPException(400, "名前を入力してください")
    new_image = await store_image(image, char_id) if image is not None and image.filename else None
    with _lock:
        chars = load_chars()
        char = find_char(chars, char_id)
        char.update(name=name.strip(), prompt=prompt.strip(), voice_actor_id=voice_actor_id.strip())
        if new_image:
            (CHAR_DIR / char["image"]).unlink(missing_ok=True)
            char["image"] = new_image
        write_json(CHAR_DB, chars)
    return char


@app.delete("/api/characters/{char_id}")
def delete_character(char_id: str):
    with _lock:
        chars = load_chars()
        char = find_char(chars, char_id)
        (CHAR_DIR / char["image"]).unlink(missing_ok=True)
        write_json(CHAR_DB, [c for c in chars if c["id"] != char_id])
    return {"ok": True}


# ---------- エピソード（SNS版／完全版 × 6カット） ----------

class Cut(BaseModel):
    dialogue: str = ""          # 日本語セリフ
    speaker: str = ""           # 話すキャラクターのID（空ならナレーション・心の声）
    image_prompt: str = ""      # 英語の画像プロンプト
    motion_prompt: str = ""     # 英語のカメラ・動きのプロンプト
    characters: list[str] = Field(default_factory=list)


class Episode(BaseModel):
    title: str = ""
    cuts: list[Cut]


def check_ep(ep: int, variant: str):
    if not 1 <= ep <= 999:
        raise HTTPException(400, "話数は1〜999で指定してください")
    if variant not in VARIANTS:
        raise HTTPException(400, "版は sns か full を指定してください")


def board_path(ep: int, variant: str) -> Path:
    check_ep(ep, variant)
    return BOARD_DIR / f"ep{ep:02d}_{variant}.json"


def cut_dir(ep: int, variant: str, n: int) -> Path:
    check_ep(ep, variant)
    if not 1 <= n <= CUTS_PER_EPISODE:
        raise HTTPException(400, "カット番号が範囲外です")
    return MEDIA_DIR / f"ep{ep:02d}" / variant / f"C{n:02d}"


def read_episode(ep: int, variant: str) -> dict:
    data = read_json(board_path(ep, variant), {})
    cuts = []
    for c in data.get("cuts", [])[:CUTS_PER_EPISODE]:
        line = (c.get("lines") or [{}])[0]
        cuts.append(Cut(dialogue=line.get("text", ""), speaker=line.get("speaker", ""),
                        image_prompt=c.get("image_prompt") or "", motion_prompt=c.get("motion_prompt") or "",
                        characters=c.get("characters", [])).model_dump())
    cuts += [Cut().model_dump() for _ in range(CUTS_PER_EPISODE - len(cuts))]
    return {"episode": ep, "variant": variant, "title": data.get("title", ""), "cuts": cuts}


def write_episode(ep: int, variant: str, body: Episode) -> Path:
    if len(body.cuts) != CUTS_PER_EPISODE:
        raise HTTPException(400, f"カットは{CUTS_PER_EPISODE}つ必要です")
    path = board_path(ep, variant)
    chars = {c["id"]: c for c in load_chars()}
    with _lock:
        old = read_json(path, {})
        old_cuts = old.get("cuts", [])
        data = {
            **old,
            "episode": ep,
            "variant": variant,
            "title": body.title.strip(),
            "aspect_ratio": "9:16",
            "out_dir": f"assets/episodes/ep{ep:02d}/{variant}",
            "characters": {cid: {"name": c["name"], "prompt": c["prompt"],
                                 "ref": f"assets/characters/{c['image']}",
                                 "voice_actor_id": c.get("voice_actor_id") or None}
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
        write_json(path, data)
    return path


@app.get("/api/episodes")
def list_episodes():
    found = {}
    for p in sorted(BOARD_DIR.glob("ep*_*.json")):
        m = re.fullmatch(r"ep(\d+)_(sns|full)", p.stem)
        if m:
            found.setdefault(int(m.group(1)), {})[m.group(2)] = read_json(p, {}).get("title", "")
    return [{"episode": ep, "variants": v} for ep, v in sorted(found.items())]


@app.get("/api/episodes/{ep}/{variant}")
def get_episode(ep: int, variant: str):
    return read_episode(ep, variant)


@app.put("/api/episodes/{ep}/{variant}")
def save_episode(ep: int, variant: str, body: Episode):
    path = write_episode(ep, variant, body)
    return {"ok": True, "path": str(path.relative_to(ROOT))}


# ---------- 生成した素材 ----------

def load_state(d: Path) -> dict:
    return read_json(d / "state.json", {})


def media_url(path: Path) -> str:
    return "/media/" + path.relative_to(ROOT).as_posix() + f"?v={int(path.stat().st_mtime)}"


@app.get("/api/episodes/{ep}/{variant}/media")
def get_media(ep: int, variant: str):
    out = []
    for n in range(1, CUTS_PER_EPISODE + 1):
        d = cut_dir(ep, variant, n)
        st = load_state(d)
        item = {}
        for kind in ("image", "video", "voice"):
            if st.get(kind) and (d / st[kind]).exists():
                item[kind] = media_url(d / st[kind])
        out.append(item)
    exported = EXPORT_DIR / f"ep{ep:02d}_{variant}.mp4"
    return {"cuts": out, "export": media_url(exported) if exported.exists() else None}


@app.get("/media/{path:path}")
def serve_media(path: str):
    full = (ROOT / path).resolve()
    allowed = [MEDIA_DIR.resolve(), EXPORT_DIR.resolve()]
    if not any(full.is_relative_to(a) for a in allowed) or not full.is_file():  # 許可したフォルダの外は読ませない
        raise HTTPException(404)
    return FileResponse(full)


@app.get("/files/characters/{name}")
def character_image(name: str):
    path = (CHAR_DIR / name).resolve()
    if path.parent != CHAR_DIR.resolve() or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path)


# ---------- 生成・書き出しのジョブ（時間がかかるので裏で実行し、画面は状態を確認しに来る） ----------

jobs: dict[str, dict] = {}
executor = ThreadPoolExecutor(max_workers=3)


def submit(label: str, fn, *args) -> dict:
    job_id = uuid.uuid4().hex[:12]
    jobs[job_id] = {"id": job_id, "label": label, "status": "running", "error": None, "message": ""}

    def run():
        try:
            jobs[job_id]["message"] = fn(*args) or ""
            jobs[job_id]["status"] = "done"
        except Exception as e:  # noqa: BLE001 失敗理由を画面に出す
            jobs[job_id].update(status="error", error=str(e))
    executor.submit(run)
    return jobs[job_id]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "ジョブが見つかりません")
    return jobs[job_id]


def set_state(d: Path, kind: str, path: Path):
    with _lock:
        st = load_state(d)
        st[kind] = path.name
        write_json(d / "state.json", st)


def job_image(ep, variant, n):
    cut = read_episode(ep, variant)["cuts"][n - 1]
    if not cut["image_prompt"]:
        raise RuntimeError("画像プロンプトが空です")
    chars = {c["id"]: c for c in load_chars()}
    used = [chars[k] for k in cut["characters"] if k in chars]
    prompt = cut["image_prompt"]
    if used:
        prompt += ". Characters (use the reference image for their exact design): " + "; ".join(
            f"{c['name']}: {c['prompt']}" if c["prompt"] else c["name"] for c in used)
    prompt += ". Japanese anime style, vertical 9:16 frame, no text."
    d = cut_dir(ep, variant, n)
    d.mkdir(parents=True, exist_ok=True)
    path = sv.generate_image(prompt, [CHAR_DIR / c["image"] for c in used], d, load_settings())
    set_state(d, "image", path)
    return "静止画を生成しました"


def job_video(ep, variant, n):
    cut = read_episode(ep, variant)["cuts"][n - 1]
    d = cut_dir(ep, variant, n)
    st = load_state(d)
    if not st.get("image") or not (d / st["image"]).exists():
        raise RuntimeError("先に静止画を生成してください")
    prompt = ", ".join(p for p in (cut["motion_prompt"], cut["image_prompt"]) if p) or "subtle motion"
    path = sv.generate_video(prompt + ", Japanese anime style", d / st["image"], d, load_settings())
    set_state(d, "video", path)
    return "動画を生成しました"


def job_voice(ep, variant, n):
    cut = read_episode(ep, variant)["cuts"][n - 1]
    if not cut["dialogue"]:
        raise RuntimeError("セリフが空です")
    s = load_settings()
    actor = s["narrator_voice_actor_id"]
    if cut["speaker"]:
        chars = {c["id"]: c for c in load_chars()}
        actor = chars.get(cut["speaker"], {}).get("voice_actor_id") or actor
    d = cut_dir(ep, variant, n)
    d.mkdir(parents=True, exist_ok=True)
    path = sv.generate_voice(cut["dialogue"], actor, d, float(s.get("voice_speed", 1.0)))
    set_state(d, "voice", path)
    return "音声を生成しました"


def job_export(ep, variant):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("FFmpeg が見つかりません。インストールしてPATHを通してください")
    data = read_episode(ep, variant)
    font = sv.find_font(load_settings().get("font_path", ""))
    work = EXPORT_DIR / f"_work_ep{ep:02d}_{variant}"
    work.mkdir(parents=True, exist_ok=True)
    segments, notes = [], []
    for n, cut in enumerate(data["cuts"], 1):
        d = cut_dir(ep, variant, n)
        st = load_state(d)
        visual, kind = None, "black"
        if st.get("video") and (d / st["video"]).exists():
            visual, kind = d / st["video"], "video"
        elif st.get("image") and (d / st["image"]).exists():
            visual, kind = d / st["image"], "image"
            notes.append(f"C{n:02d}は動画がないため静止画を使用")
        else:
            notes.append(f"C{n:02d}は素材がないため黒画面")
        voice = d / st["voice"] if st.get("voice") and (d / st["voice"]).exists() else None
        sub = None
        if cut["dialogue"]:
            if font:
                sub = sv.subtitle_png(cut["dialogue"], font, work / f"sub_{n:02d}.png")
            elif n == 1:
                notes.append("日本語フォントが見つからないため字幕なし（設定でフォントを指定してください）")
        seg = work / f"seg_{n:02d}.mp4"
        sv.render_segment(visual, kind, voice, sub, seg)
        segments.append(seg)
    out = EXPORT_DIR / f"ep{ep:02d}_{variant}.mp4"
    sv.concat(segments, out)
    shutil.rmtree(work, ignore_errors=True)
    return f"{VARIANTS[variant]}を書き出しました（{out.relative_to(ROOT)}）" + ("。" + "、".join(notes) if notes else "")


@app.post("/api/episodes/{ep}/{variant}/cuts/{n}/{kind}")
def start_cut_job(ep: int, variant: str, n: int, kind: str):
    cut_dir(ep, variant, n)  # 範囲チェック
    fns = {"image": job_image, "video": job_video, "voice": job_voice}
    if kind not in fns:
        raise HTTPException(400, "image / video / voice のいずれかを指定してください")
    return submit(f"C{n:02d} {kind}", fns[kind], ep, variant, n)


@app.post("/api/episodes/{ep}/{variant}/export")
def start_export(ep: int, variant: str):
    check_ep(ep, variant)
    return submit(f"{VARIANTS[variant]}書き出し", job_export, ep, variant)


# ---------- 画面 ----------

@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")


if __name__ == "__main__":
    import uvicorn

    # 自分専用なので、このPCからしか開けないよう 127.0.0.1 で待ち受ける
    uvicorn.run(app, host="127.0.0.1", port=8000)
