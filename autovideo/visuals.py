"""各区間の背景画像（1920x1080）を作る。title/text/chart はローカル描画、image は画像生成AI。"""
import colorsys
import io
import os
import zlib
from pathlib import Path

import requests
from PIL import Image, ImageDraw

from . import textdraw
from .util import digest

LONG_SIZE = (1920, 1080)


# ---------- 画像生成プロバイダ ----------

class DummyImages:
    name = "dummy"

    def cache_key(self):
        return [self.name, 2]

    def generate(self, prompt, size):
        """APIキー無しの仮画像。プロンプトから色を決め、内容を文字で表示する。"""
        hue = (zlib.crc32(prompt.encode("utf-8")) % 360) / 360
        img = _gradient(size, _hsv(hue, 0.55, 0.45), _hsv((hue + 0.12) % 1, 0.65, 0.18))
        draw = ImageDraw.Draw(img)
        w, h = size
        textdraw.draw_lines(draw, ["AI画像（仮）"], 44, w / 2, h * 0.28, "#facc15")
        size_, lines = textdraw.fit_wrap(prompt, 48, 30, w - 360, 5)
        textdraw.draw_lines(draw, lines, size_, w / 2, h * 0.40, "#e2e8f0")
        return img


class FalImages:
    name = "fal"

    def __init__(self, cfg):
        self.key = os.environ["FAL_KEY"]
        self.model = cfg["images"]["fal_model"]
        self.suffix = cfg["images"].get("style_suffix", "")

    def cache_key(self):
        return [self.name, self.model, self.suffix]

    def generate(self, prompt, size):
        resp = requests.post(
            f"https://fal.run/{self.model}",
            headers={"Authorization": f"Key {self.key}"},
            json={"prompt": prompt + self.suffix, "image_size": "landscape_16_9", "num_images": 1},
            timeout=300,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"fal.ai API error {resp.status_code}: {resp.text[:500]}")
        url = resp.json()["images"][0]["url"]
        data = requests.get(url, timeout=120).content
        return cover(Image.open(io.BytesIO(data)).convert("RGB"), size)


def get_image_provider(choice, cfg):
    choice = choice or cfg["images"]["provider"]
    if choice == "auto":
        choice = "fal" if os.environ.get("FAL_KEY") else "dummy"
    if choice == "fal":
        return FalImages(cfg)
    if choice == "dummy":
        return DummyImages()
    raise SystemExit(f"未対応の画像プロバイダ: {choice}")


# ---------- 区間ビジュアル ----------

def render_visual(visual, cfg, provider, cache_dir, script_dir):
    """visual 定義から背景PNGを作り、パスを返す（内容が同じならキャッシュを再利用）。"""
    vtype = visual["type"]
    key_parts = [visual, cfg["colors"], 3]
    if vtype == "image":
        key_parts.append(provider.cache_key())
    if vtype == "file":
        key_parts.append((script_dir / visual["path"]).stat().st_mtime)
    out = Path(cache_dir) / f"{vtype}-{digest(*key_parts)}.png"
    if out.exists():
        return out

    if vtype == "image":
        img = provider.generate(visual["prompt"], LONG_SIZE)
    elif vtype == "file":
        img = cover(Image.open(script_dir / visual["path"]).convert("RGB"), LONG_SIZE)
    elif vtype == "title":
        img = _title_card(visual, cfg)
    elif vtype == "text":
        img = _text_card(visual, cfg)
    elif vtype == "chart":
        img = _chart(visual["chart"], cfg)
    else:
        raise ValueError(vtype)
    img.convert("RGB").save(out)
    return out


def cover(img, size):
    """アスペクト比を保ったまま size を埋めるように拡大・中央トリミング。"""
    tw, th = size
    scale = max(tw / img.width, th / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left, top = (img.width - tw) // 2, (img.height - th) // 2
    return img.crop((left, top, left + tw, top + th))


def _title_card(visual, cfg):
    c = cfg["colors"]
    w, h = LONG_SIZE
    img = _gradient(LONG_SIZE, _hex(c["panel"]), _hex(c["bg"]))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, h * 0.5 - 6, 220, h * 0.5 + 6], fill=c["accent"])
    size, lines = textdraw.fit_wrap(visual["text"], 110, 64, w - 360, 3)
    top = h * 0.46 - textdraw.lines_height(len(lines), size)
    textdraw.draw_lines(draw, lines, size, w / 2, top, c["text"], stroke=3, stroke_fill=c["bg"])
    if visual.get("sub"):
        textdraw.draw_lines(draw, [visual["sub"]], 52, w / 2, h * 0.58, c["accent"])
    textdraw.draw_lines(draw, [cfg["channel_name"]], 34, w / 2, h - 110, c["muted"])
    return img


def _text_card(visual, cfg):
    c = cfg["colors"]
    w, h = LONG_SIZE
    img = Image.new("RGB", LONG_SIZE, c["bg"])
    draw = ImageDraw.Draw(img)
    y = 110
    if visual.get("heading"):
        draw.rectangle([120, y + 8, 134, y + 78], fill=c["accent"])
        textdraw.draw_lines(draw, [visual["heading"]], 76, 170, y, c["text"], align="left")
        y += 150
    for bullet in visual.get("bullets", []):
        lines = textdraw.wrap(bullet, 58, w - 420)
        draw.ellipse([170, y + 22, 196, y + 48], fill=c["accent2"])
        y = textdraw.draw_lines(draw, lines, 58, 230, y, c["text"], align="left") + 34
    return img


def _chart(chart, cfg):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager

    c = cfg["colors"]
    fp = textdraw.font_path()
    font_manager.fontManager.addfont(fp)
    family = font_manager.FontProperties(fname=fp).get_name()
    plt.rcParams.update({"font.family": family, "font.size": 26})

    fig, ax = plt.subplots(figsize=(19.2, 10.8), dpi=100)
    fig.patch.set_facecolor(c["bg"])
    ax.set_facecolor(c["bg"])
    labels, values = chart["labels"], chart["values"]
    unit = chart.get("unit", "")
    kind = chart.get("kind", "bar")
    highlight = chart.get("highlight")
    colors = [c["accent"] if (highlight is not None and i == highlight) else c["accent2"] for i in range(len(values))]

    if kind == "bar":
        bars = ax.bar(labels, values, color=colors, width=0.6)
        ax.bar_label(bars, labels=[f"{v:g}{unit}" for v in values], color=c["text"], fontsize=30, padding=8)
        ax.set_yticks([])
    elif kind == "barh":
        bars = ax.barh(labels[::-1], values[::-1], color=colors[::-1], height=0.6)
        ax.bar_label(bars, labels=[f"{v:g}{unit}" for v in values[::-1]], color=c["text"], fontsize=30, padding=8)
        ax.set_xticks([])
    else:
        ax.plot(labels, values, color=c["accent2"], linewidth=6, marker="o", markersize=16)
        for x, v in zip(labels, values):
            ax.annotate(f"{v:g}{unit}", (x, v), textcoords="offset points", xytext=(0, 18),
                        ha="center", color=c["text"], fontsize=26)
        ax.grid(axis="y", color=c["panel"], linewidth=2)

    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(colors=c["text"], labelsize=30, length=0)
    ax.set_title(chart.get("title", ""), color=c["text"], fontsize=48, pad=40, loc="left")
    fig.text(0.95, 0.92, f"出典: {chart['source']}", ha="right", color=c["muted"], fontsize=22)
    # 下部は字幕が乗るので空けておく
    fig.subplots_adjust(left=0.08, right=0.95, top=0.80, bottom=0.26)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    return Image.open(buf).convert("RGB").resize(LONG_SIZE)


# ---------- helpers ----------

def _hex(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def _hsv(h, s, v):
    return tuple(int(x * 255) for x in colorsys.hsv_to_rgb(h, s, v))


def _gradient(size, top, bottom):
    w, h = size
    col = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        col.putpixel((0, y), tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    return col.resize(size)
