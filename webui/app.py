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


def ensure_ffmpeg():
    """FFmpeg が見つからなければ、static-ffmpeg で自動ダウンロードして使えるようにする（初回のみ数分）。"""
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        return
    try:
        import static_ffmpeg
        print("FFmpeg を準備しています（初回はダウンロードに数分かかります）…", flush=True)
        static_ffmpeg.add_paths(weak=True)
    except Exception as e:  # noqa: BLE001 失敗しても画面は使えるようにし、設定画面で未設定と表示する
        print(f"[注意] FFmpeg を自動で準備できませんでした: {e}", flush=True)


ensure_ffmpeg()
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
    "tts_provider": "aivis",                       # 音声サービス：aivis（Aivis Cloud API）／fish（Fish Audio）
    "narrator_voice": {"aivis": "", "fish": ""},   # ナレーション・心の声に使う声のID
    "fish_model": "s2-pro",
    "enable_safety_checker": False,
    "video_resolution": "720p",
    "font_path": "",
    "image_mode": "multi",
    "bgm_volume": 0.2,                             # BGMの音量（0〜1。セリフが聞こえるよう小さめ）                         # 静止画の作り方：multi（参考画像を複数そのまま渡す）／kontext（1枚にまとめる）
    "models": {
        "image": "fal-ai/flux-kontext/dev",
        "image_multi": "fal-ai/bytedance/seedream/v4/edit",
        "image_t2i": "fal-ai/flux/dev",
        "video": "fal-ai/wan-i2v",
    },
}

app = FastAPI(title="縦型AIアニメ制作")


@app.middleware("http")
async def no_cache(request, call_next):
    """更新後に古い画面が混ざらないよう、画面のファイルはブラウザに保存させない。"""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store"
    return response
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
    merged["narrator_voice"] = {**DEFAULT_SETTINGS["narrator_voice"], **s.get("narrator_voice", {})}
    return merged


@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.put("/api/settings")
def put_settings(body: dict):
    s = load_settings()
    for key in ("font_path", "video_resolution", "fish_model"):
        if key in body:
            s[key] = str(body[key]).strip()
    if body.get("tts_provider") in sv.TTS_PROVIDERS:
        s["tts_provider"] = body["tts_provider"]
    for prov in sv.TTS_PROVIDERS:
        if prov in body.get("narrator_voice", {}):
            s["narrator_voice"][prov] = str(body["narrator_voice"][prov]).strip()
    if "enable_safety_checker" in body:
        s["enable_safety_checker"] = bool(body["enable_safety_checker"])
    if "bgm_volume" in body:
        try:
            s["bgm_volume"] = min(max(float(body["bgm_volume"]), 0.0), 1.0)
        except (TypeError, ValueError):
            raise HTTPException(400, "BGMの音量は0〜1の数字で指定してください")
    if body.get("image_mode") in ("multi", "kontext"):
        s["image_mode"] = body["image_mode"]
    for key in ("image", "image_multi", "image_t2i", "video"):
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
        "tts_provider": s["tts_provider"],
        "tts_keys": {p: bool(os.environ.get(k)) for p, (_, k) in sv.TTS_PROVIDERS.items()},
        "ffmpeg": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
        "font": sv.find_font(s.get("font_path", "")),
    }


KEYS_FILE = Path(__file__).resolve().parent / "keys.env"
KEY_NAMES = ("FAL_KEY", "AIVIS_API_KEY", "FISH_API_KEY")


@app.put("/api/keys")
def put_keys(body: dict):
    """画面から入力されたAPIキーを keys.env（このPCだけ）に保存し、すぐ使えるようにする。空欄の項目は変更しない。"""
    import os
    updates = {k: str(body.get(k, "")).strip() for k in KEY_NAMES if str(body.get(k, "")).strip()}
    if not updates:
        raise HTTPException(400, "キーが入力されていません")
    lines = KEYS_FILE.read_text(encoding="utf-8-sig").splitlines() if KEYS_FILE.exists() else []
    out, done = [], set()
    for line in lines:
        key = line.split("=", 1)[0].strip()
        if key in updates and not line.lstrip().startswith("#"):
            out.append(f"{key}={updates[key]}")
            done.add(key)
        else:
            out.append(line)
    out += [f"{k}={v}" for k, v in updates.items() if k not in done]
    KEYS_FILE.write_text("\n".join(out) + "\n", encoding="utf-8")
    for k, v in updates.items():
        os.environ[k] = v  # 起動し直さなくても使えるようにする
    return {"ok": True, "saved": list(updates)}


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
async def create_character(name: str = Form(...), prompt: str = Form(""), voice_aivis: str = Form(""),
                           voice_fish: str = Form(""), image: UploadFile = File(...)):
    if not name.strip():
        raise HTTPException(400, "名前を入力してください")
    char_id = uuid.uuid4().hex[:10]
    char = {"id": char_id, "name": name.strip(), "prompt": prompt.strip(),
            "voices": {"aivis": voice_aivis.strip(), "fish": voice_fish.strip()},
            "image": await store_image(image, char_id)}
    with _lock:
        chars = load_chars()
        chars.append(char)
        write_json(CHAR_DB, chars)
    return char


@app.put("/api/characters/{char_id}")
async def update_character(char_id: str, name: str = Form(...), prompt: str = Form(""),
                           voice_aivis: str = Form(""), voice_fish: str = Form(""),
                           image: UploadFile | None = File(None)):
    if not name.strip():
        raise HTTPException(400, "名前を入力してください")
    new_image = await store_image(image, char_id) if image is not None and image.filename else None
    with _lock:
        chars = load_chars()
        char = find_char(chars, char_id)
        char.update(name=name.strip(), prompt=prompt.strip(),
                    voices={"aivis": voice_aivis.strip(), "fish": voice_fish.strip()})
        char.pop("voice_actor_id", None)  # にじボイス時代の項目は消す
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
    use_prev_ref: bool = False  # 前のカットの静止画を背景・色の参考にする
    length: float = Field(0, ge=0, le=15)       # カットの長さ（秒）。0なら自動
    video_start: float = Field(0, ge=0, le=10)  # 動画の使い始め（秒）
    se_start: float = Field(0, ge=0, le=15)     # 効果音を鳴らし始める秒


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
                        characters=c.get("characters", []),
                        use_prev_ref=bool(c.get("use_prev_ref", False)),
                        length=c.get("length_sec", 0) or 0, video_start=c.get("video_start", 0) or 0,
                        se_start=c.get("se_start", 0) or 0).model_dump())
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
                                 "voices": c.get("voices", {})}
                           for cid, c in chars.items()},
            "cuts": [
                {
                    **(old_cuts[i] if i < len(old_cuts) else {}),
                    "id": f"C{i + 1:02d}",
                    "duration": cut.length or 5,
                    "length_sec": cut.length,
                    "video_start": cut.video_start,
                    "se_start": cut.se_start,
                    "characters": [k for k in cut.characters if k in chars],
                    "image_prompt": cut.image_prompt.strip(),
                    "motion_prompt": cut.motion_prompt.strip(),
                    "use_prev_ref": cut.use_prev_ref,
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


AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg"}
MAX_AUDIO_BYTES = 30 * 1024 * 1024


async def read_audio(upload: UploadFile) -> tuple[bytes, str]:
    ext = Path(upload.filename or "").suffix.lower()
    if ext not in AUDIO_EXTS:
        raise HTTPException(400, "音声は MP3 / WAV / M4A / AAC / OGG のみ登録できます")
    data = await upload.read()
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(400, "音声ファイルが大きすぎます（30MBまで）")
    return data, ext


def bgm_dir(ep: int, variant: str) -> Path:
    check_ep(ep, variant)
    return MEDIA_DIR / f"ep{ep:02d}" / variant


def find_bgm(ep: int, variant: str) -> Path | None:
    files = sorted(bgm_dir(ep, variant).glob("bgm.*"))
    return files[0] if files else None


@app.post("/api/episodes/{ep}/{variant}/bgm")
async def upload_bgm(ep: int, variant: str, file: UploadFile = File(...)):
    data, ext = await read_audio(file)
    d = bgm_dir(ep, variant)
    d.mkdir(parents=True, exist_ok=True)
    for old in d.glob("bgm.*"):
        old.unlink()
    (d / f"bgm{ext}").write_bytes(data)
    return {"ok": True}


@app.delete("/api/episodes/{ep}/{variant}/bgm")
def delete_bgm(ep: int, variant: str):
    for old in bgm_dir(ep, variant).glob("bgm.*"):
        old.unlink()
    return {"ok": True}


@app.post("/api/episodes/{ep}/{variant}/cuts/{n}/se")
async def upload_se(ep: int, variant: str, n: int, file: UploadFile = File(...)):
    data, ext = await read_audio(file)
    d = cut_dir(ep, variant, n)
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"se_{sv.stamp()}{ext}"
    path.write_bytes(data)
    set_state(d, "se", path)
    return {"ok": True}


@app.delete("/api/episodes/{ep}/{variant}/cuts/{n}/se")
def delete_se(ep: int, variant: str, n: int):
    d = cut_dir(ep, variant, n)
    with _lock:
        st = load_state(d)
        st.pop("se", None)
        write_json(d / "state.json", st)
    return {"ok": True}


@app.get("/api/episodes/{ep}/{variant}/media")
def get_media(ep: int, variant: str):
    out = []
    for n in range(1, CUTS_PER_EPISODE + 1):
        d = cut_dir(ep, variant, n)
        st = load_state(d)
        item = {}
        for kind in ("image", "video", "voice", "se"):
            if st.get(kind) and (d / st[kind]).exists():
                item[kind] = media_url(d / st[kind])
        out.append(item)
    exported = EXPORT_DIR / f"ep{ep:02d}_{variant}.mp4"
    bgm = find_bgm(ep, variant)
    return {"bgm": media_url(bgm) if bgm else None, "cuts": out, "export": media_url(exported) if exported.exists() else None}


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
    refs = [CHAR_DIR / c["image"] for c in used]
    if cut.get("use_prev_ref") and n > 1:
        prev_dir = cut_dir(ep, variant, n - 1)
        prev = load_state(prev_dir).get("image")
        if not prev or not (prev_dir / prev).exists():
            raise RuntimeError(f"前のカット（C{n - 1:02d}）の静止画がまだありません。先に生成してください")
        refs.append(prev_dir / prev)
        names = ", ".join(c["name"] for c in used) or "no characters"
        prompt += (". The last reference image is the previous shot: use it ONLY for the location, background,"
                   " lighting and color palette. Do not copy its composition or its people."
                   f" The only people in this shot are: {names}")
    prompt += ". Japanese anime style, vertical 9:16 frame, no text."
    d = cut_dir(ep, variant, n)
    d.mkdir(parents=True, exist_ok=True)
    path = sv.generate_image(prompt, refs, d, load_settings())
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
    provider = s["tts_provider"]
    voice = s["narrator_voice"].get(provider, "")
    if cut["speaker"]:
        chars = {c["id"]: c for c in load_chars()}
        voice = chars.get(cut["speaker"], {}).get("voices", {}).get(provider) or voice
    d = cut_dir(ep, variant, n)
    d.mkdir(parents=True, exist_ok=True)
    path = sv.generate_voice(cut["dialogue"], provider, voice, d, s)
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
        se = d / st["se"] if st.get("se") and (d / st["se"]).exists() else None
        sv.render_segment(visual, kind, voice, sub, seg, length=cut["length"], start=cut["video_start"],
                          se=se, se_start=cut["se_start"])
        segments.append(seg)
    out = EXPORT_DIR / f"ep{ep:02d}_{variant}.mp4"
    bgm = find_bgm(ep, variant)
    if bgm:
        joined = work / "joined.mp4"
        sv.concat(segments, joined)
        sv.add_bgm(joined, bgm, load_settings().get("bgm_volume", 0.2), out)
    else:
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
