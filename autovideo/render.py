"""区間クリップの書き出しと、長尺・ショートの組み立て。"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

from . import ffmpeg, textdraw
from .util import digest

LONG = (1920, 1080)
SHORT = (1080, 1920)
SHORT_IMG_Y = 600
SHORT_IMG_SIZE = (1080, 608)
ZOOM_MAX = {"image": 1.12, "file": 1.06}  # それ以外（図表・文字カード）はほぼ動かさない
ZOOM_DEFAULT = 1.03


def render_clip(out, visual_png, vtype, timings, audio_wav, duration, cfg, layout, short_meta=None):
    """1区間分のクリップ（映像＋字幕＋音声）を作る。同じ入力ならキャッシュを使う。"""
    fps = cfg["fps"]
    frames = math.ceil(duration * fps)
    zmax = ZOOM_MAX.get(vtype, ZOOM_DEFAULT)
    rate = (zmax - 1) / max(frames, 1)
    canvas = LONG if layout == "long" else SHORT

    sub_dir = out.parent / "subs"
    sub_dir.mkdir(parents=True, exist_ok=True)
    subs = []
    for text, t0, t1 in timings:
        png = sub_dir / f"{layout}-{digest(text, canvas, 2)}.png"
        if not png.exists():
            textdraw.subtitle_png(text, canvas, png, layout)
        subs.append((png, t0, t1))

    inputs, filters = [], []
    if layout == "long":
        inputs += ["-i", visual_png]
        filters.append(
            f"[0:v]scale=3840:2160,zoompan=z='min(1+{rate:.7f}*on,{zmax})'"
            f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps={fps}[v0]"
        )
    else:
        base = short_base_png(out.parent, short_meta, cfg)
        inputs += ["-loop", 1, "-framerate", fps, "-t", f"{duration:.3f}", "-i", base, "-i", visual_png]
        filters.append(
            f"[1:v]scale=2160:1216,zoompan=z='min(1+{rate:.7f}*on,{zmax})'"
            f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1080x608:fps={fps}[img]"
        )
        filters.append(f"[0:v][img]overlay=0:{SHORT_IMG_Y}[v0]")

    first_sub = 1 if layout == "long" else 2  # 字幕PNGが始まる入力番号
    for png, _, _ in subs:
        inputs += ["-i", png]
    last = "v0"
    for i, (_, t0, t1) in enumerate(subs):
        filters.append(f"[{last}][{first_sub + i}:v]overlay=0:0:enable='between(t,{t0:.3f},{t1:.3f})'[s{i}]")
        last = f"s{i}"
    filters.append(f"[{last}]format=yuv420p[vout]")
    audio_idx = first_sub + len(subs)
    inputs += ["-i", audio_wav]

    ffmpeg.run([
        *inputs,
        "-filter_complex", ";".join(filters),
        "-map", "[vout]", "-map", f"{audio_idx}:a",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", 20, "-r", fps,
        "-c:a", "aac", "-b:a", "192k", "-ar", 44100, "-ac", 2,
        "-t", f"{duration:.3f}", out,
    ])
    return out


def short_base_png(work_dir, meta, cfg):
    """ショートの固定レイアウト（上: フック / 中: 画像 / 下: 字幕帯 / 最下部: 本編への誘導）。"""
    out = Path(work_dir) / f"short-base-{digest(meta, cfg['colors'], cfg['channel_name'], 2)}.png"
    if out.exists():
        return out
    c = cfg["colors"]
    w, h = SHORT
    img = Image.new("RGB", SHORT, c["bg"])
    draw = ImageDraw.Draw(img)
    textdraw.draw_lines(draw, [cfg["channel_name"]], 36, w / 2, 120, c["muted"])
    size, lines = textdraw.fit_wrap(meta.get("hook") or meta["title"], 84, 56, w - 100, 3)
    top = SHORT_IMG_Y - 40 - textdraw.lines_height(len(lines), size)
    textdraw.draw_lines(draw, lines, size, w / 2, top, c["accent"], stroke=5, stroke_fill="#000000")
    draw.rectangle([0, h - 250, w, h - 150], fill=c["panel"])
    textdraw.draw_lines(draw, ["フル解説は本編で →"], 48, w / 2, h - 230, c["text"])
    img.save(out)
    return out


def mix_bgm(video_in, video_out, cfg):
    bgm = Path(cfg["bgm"]["path"])
    if not bgm.exists():
        video_in.replace(video_out)
        return False
    ffmpeg.run([
        "-i", video_in, "-stream_loop", -1, "-i", bgm,
        "-filter_complex",
        f"[1:a]volume={cfg['bgm']['volume']}[b];[0:a][b]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", video_out,
    ])
    video_in.unlink()
    return True
