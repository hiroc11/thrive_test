"""生成と書き出しの処理（fal.ai、Aivis Cloud API／Fish Audio、FFmpeg）。

環境変数:
  FAL_KEY             fal.ai の API キー
  AIVIS_API_KEY       Aivis Cloud API の API キー
  FISH_API_KEY        Fish Audio の API キー
  WEBUI_FAKE=1        外部APIを呼ばず、手元で仮の画像・動画・音声を作る（動作確認用）
"""
import json
import os
import shutil
import subprocess
import textwrap
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

AIVIS_URL = "https://api.aivis-project.com/v1/tts/synthesize"
FISH_URL = "https://api.fish.audio/v1/tts"
TTS_PROVIDERS = {"aivis": ("Aivis Cloud API", "AIVIS_API_KEY"), "fish": ("Fish Audio", "FISH_API_KEY")}
W, H, FPS = 1080, 1920, 30
MIN_CUT_SEC = 5.0

FONT_CANDIDATES = [
    # Windows
    "C:/Windows/Fonts/meiryob.ttc", "C:/Windows/Fonts/meiryo.ttc", "C:/Windows/Fonts/YuGothB.ttc",
    "C:/Windows/Fonts/msgothic.ttc",
    # macOS
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc", "/Library/Fonts/Arial Unicode.ttf",
    # Linux
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf", "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
]


def _ssl_context():
    """Mac の python.org 版などで証明書が見つからない問題を避けるため、certifi の証明書を使う。"""
    import ssl
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


SSL_CTX = _ssl_context()


def fake_mode():
    return os.environ.get("WEBUI_FAKE") == "1"


def stamp():
    return time.strftime("%Y%m%d-%H%M%S")


def download(url, dest: Path):
    with urllib.request.urlopen(url, timeout=600, context=SSL_CTX) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    return dest


def media_seconds(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                          str(path)], capture_output=True, text=True, check=True).stdout.strip()
    return float(out or 0)


def find_font(setting: str = "") -> str | None:
    for path in ([setting] if setting else []) + FONT_CANDIDATES:
        if path and Path(path).exists():
            return path
    return None


# ---------- fal.ai ----------

def _fal(model, arguments):
    if not os.environ.get("FAL_KEY"):
        raise RuntimeError("FAL_KEY が設定されていません")
    import fal_client
    # 動画などは数分かかるので、つなぎっぱなしで待たず、短い問い合わせを繰り返して完了を待つ
    handle = fal_client.submit(model, arguments=arguments)
    deadline = time.time() + 30 * 60
    while True:
        for attempt in range(5):  # 一時的な通信の失敗は、少し待ってやり直す
            try:
                status = handle.status()
                break
            except Exception:  # noqa: BLE001
                if attempt == 4:
                    raise
                time.sleep(5)
        if type(status).__name__ == "Completed":
            break
        if time.time() > deadline:
            raise RuntimeError("30分待っても生成が終わりませんでした。fal.ai の混雑が考えられます。時間をおいて再度お試しください")
        time.sleep(5)
    for attempt in range(5):
        try:
            return handle.get()
        except Exception:  # noqa: BLE001
            if attempt == 4:
                raise
            time.sleep(5)


def _fal_upload(path: Path) -> str:
    import fal_client
    for attempt in range(3):  # アップロードも、一時的な失敗はやり直す
        try:
            return fal_client.upload_file(path)
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(5)


def reference_canvas(ref_paths: list[Path], dest: Path) -> Path:
    """複数の基準画像を、縦型(9:16)の白いキャンバスに横並びでまとめる。

    Kontext [dev] は入力画像を1枚しか取れず、出力の縦横比も入力に合わせるため、
    縦型キャンバスにまとめた1枚を渡す。
    """
    cw, ch = 768, 1365
    canvas = Image.new("RGB", (cw, ch), "white")
    imgs = [Image.open(p).convert("RGB") for p in ref_paths]
    slot = cw // len(imgs)
    for i, im in enumerate(imgs):
        k = min(slot / im.width, ch / im.height)
        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
        canvas.paste(im, (i * slot + (slot - im.width) // 2, (ch - im.height) // 2))
    canvas.save(dest, quality=95)
    return dest


def generate_image(prompt: str, ref_paths: list[Path], out_dir: Path, settings: dict) -> Path:
    dest = out_dir / f"image_{stamp()}.jpg"
    if fake_mode():
        return _fake_image(prompt, ref_paths, dest)
    safety = bool(settings.get("enable_safety_checker", False))
    if ref_paths:
        canvas = reference_canvas(ref_paths, out_dir / "_refs.jpg")
        res = _fal(settings["models"]["image"], {
            "prompt": prompt, "image_url": _fal_upload(canvas), "enable_safety_checker": safety,
            "resolution_mode": "match_input", "output_format": "jpeg", "num_images": 1})
    else:  # 参照するキャラがいないカット（背景だけなど）は文章から生成する
        res = _fal(settings["models"]["image_t2i"], {
            "prompt": prompt, "image_size": "portrait_16_9", "enable_safety_checker": safety,
            "output_format": "jpeg", "num_images": 1})
    return download(res["images"][0]["url"], dest)


def generate_video(prompt: str, image: Path, out_dir: Path, settings: dict) -> Path:
    dest = out_dir / f"video_{stamp()}.mp4"
    if fake_mode():
        return _fake_video(image, dest)
    res = _fal(settings["models"]["video"], {
        "prompt": prompt, "image_url": _fal_upload(image), "num_frames": 81,
        "resolution": settings.get("video_resolution", "720p"), "aspect_ratio": "9:16",
        "enable_safety_checker": bool(settings.get("enable_safety_checker", False))})
    return download(res["video"]["url"], dest)


# ---------- 音声（Aivis Cloud API／Fish Audio） ----------

def _post_audio(url, key_name, body, extra_headers=None, dest=None):
    """音声合成APIにJSONを送り、返ってきた音声データをそのままファイルに保存する。"""
    key = os.environ.get(key_name)
    if not key:
        raise RuntimeError(f"{key_name} が設定されていません（設定画面でキーを保存してください）")
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode(), headers={
        "authorization": f"Bearer {key}", "content-type": "application/json", **(extra_headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=180, context=SSL_CTX) as r, open(dest, "wb") as f:
            shutil.copyfileobj(r, f)
    except urllib.error.HTTPError as e:  # エラー内容を画面に出せるよう、本文も付けて返す
        detail = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"音声の生成に失敗しました（{e.code}）: {detail}") from e
    if dest.stat().st_size < 100:
        raise RuntimeError("音声データが空でした。声のIDが正しいか確認してください")
    return dest


def generate_voice(text: str, provider: str, voice_id: str, out_dir: Path, settings: dict) -> Path:
    dest = out_dir / f"voice_{stamp()}.mp3"
    if fake_mode():
        return _fake_voice(text, dest)
    if provider not in TTS_PROVIDERS:
        raise RuntimeError(f"音声サービスの指定が不正です: {provider}")
    if not voice_id:
        name = TTS_PROVIDERS[provider][0]
        raise RuntimeError(f"{name}の声のIDが設定されていません（キャラクター、または設定画面のナレーション用）")
    if provider == "aivis":
        # model_uuid は AivisHub の音声合成モデルのページに表示されるID
        return _post_audio(AIVIS_URL, "AIVIS_API_KEY",
                           {"model_uuid": voice_id, "text": text, "output_format": "mp3"}, dest=dest)
    # Fish Audio：reference_id は fish.audio の声のページに表示されるID。model ヘッダーで使うモデルを指定する
    return _post_audio(FISH_URL, "FISH_API_KEY", {"text": text, "reference_id": voice_id, "format": "mp3"},
                       extra_headers={"model": settings.get("fish_model", "s2-pro")}, dest=dest)


# ---------- 動作確認用の仮素材 ----------

def _fake_image(prompt, ref_paths, dest):
    im = Image.new("RGB", (768, 1365), "#3A4A5A")
    if ref_paths:
        ref = Image.open(ref_paths[0]).convert("RGB")
        ref.thumbnail((700, 900))
        im.paste(ref, ((768 - ref.width) // 2, 250))
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype(find_font(), 28) if find_font() else None
    d.multiline_text((30, 30), "（仮の画像）\n" + "\n".join(textwrap.wrap(prompt, 40)[:5]), fill="white", font=font)
    im.save(dest, quality=90)
    return dest


def _fake_video(image, dest):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-loop", "1", "-i", str(image), "-t", "5",
                    "-vf", "scale=720:1280,zoompan=z='min(zoom+0.0015,1.2)':d=125:s=720x1280:fps=25",
                    "-pix_fmt", "yuv420p", str(dest)], check=True)
    return dest


def _fake_voice(text, dest):
    sec = max(1.0, len(text) * 0.15)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    f"sine=frequency=440:duration={sec}", "-af", "volume=0.2", str(dest)], check=True)
    return dest


# ---------- 書き出し ----------

def subtitle_png(text: str, font_path: str, dest: Path) -> Path:
    """セリフ字幕を、1080x1920 の透明PNGに描く（画面下から4分の1あたり）。"""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype(font_path, 54)
    lines = []
    for para in text.splitlines() or [text]:
        lines += textwrap.wrap(para, 16) or [""]
    body = "\n".join(lines)
    box = d.multiline_textbbox((W / 2, 1450), body, font=font, anchor="mm", align="center", spacing=14)
    d.rounded_rectangle([box[0] - 36, box[1] - 24, box[2] + 36, box[3] + 24], radius=20, fill=(0, 0, 0, 150))
    d.multiline_text((W / 2, 1450), body, font=font, fill="white", anchor="mm", align="center", spacing=14,
                     stroke_width=3, stroke_fill="black")
    im.save(dest)
    return dest


def render_segment(visual: Path | None, kind: str, voice: Path | None, subtitle: Path | None,
                   dest: Path) -> float:
    """1カット分を 1080x1920・30fps・音声付きのMP4にする。尺は音声に合わせて最低5秒。"""
    dur = MIN_CUT_SEC
    if voice:
        dur = max(dur, media_seconds(voice) + 0.8)
    cmd = ["ffmpeg", "-loglevel", "error", "-y"]
    fit = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS}"
    if kind == "video":
        cmd += ["-i", str(visual)]
        vchain = f"[0:v]{fit},tpad=stop_mode=clone:stop_duration={dur},trim=duration={dur},setpts=PTS-STARTPTS"
    elif kind == "image":
        cmd += ["-loop", "1", "-t", f"{dur}", "-i", str(visual)]
        # 静止画は、ゆっくり寄るカメラの動きを付ける
        frames = int(dur * FPS)
        vchain = (f"[0:v]scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,crop={W * 2}:{H * 2},"
                  f"zoompan=z='min(1+0.10*on/{frames},1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                  f":d={frames}:s={W}x{H}:fps={FPS},setsar=1")
    else:
        cmd += ["-f", "lavfi", "-t", f"{dur}", "-i", f"color=c=black:s={W}x{H}:r={FPS}"]
        vchain = "[0:v]setsar=1"
    n = 1
    if subtitle:
        cmd += ["-i", str(subtitle)]
        vchain += f"[base];[base][{n}:v]overlay=0:0"
        n += 1
    vchain += "[v]"
    if voice:
        cmd += ["-i", str(voice)]
        achain = f"[{n}:a]adelay=300:all=1,apad,atrim=duration={dur},aresample=44100[a]"
    else:
        cmd += ["-f", "lavfi", "-t", f"{dur}", "-i", "anullsrc=r=44100:cl=stereo"]
        achain = f"[{n}:a]atrim=duration={dur}[a]"
    cmd += ["-filter_complex", f"{vchain};{achain}", "-map", "[v]", "-map", "[a]", "-t", f"{dur}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-ar", "44100", "-ac", "2", str(dest)]
    subprocess.run(cmd, check=True, capture_output=True)
    return dur


def concat(segments: list[Path], dest: Path):
    listing = dest.with_suffix(".txt")
    listing.write_text("".join(f"file '{s.resolve().as_posix()}'\n" for s in segments), encoding="utf-8")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-c", "copy", "-movflags", "+faststart", str(dest)], check=True, capture_output=True)
    listing.unlink(missing_ok=True)
