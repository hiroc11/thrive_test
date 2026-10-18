"""死亡フラグの透過PNG素材を生成する。

出力: assets/flags/
  flag_<色>.png          文字なしの旗（編集ソフトで文字を乗せる）
  flag_<色>_broken_top.png / _broken_bottom.png  折れる演出用（上下2パーツ）
  preview.png            確認用の一覧（明るい背景と暗い背景、下段は折れた状態）

使い方: python3 tools/make_flags.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "flags"

W, H = 512, 600  # 出力サイズ
S = 2  # 2倍で描いて縮小し、輪郭をなめらかにする

# 色名: (塗り, 影, 線, 不透明度)  色の指定は企画書「死亡フラグのデザイン」に合わせる
COLORS = {
    "white": ("#F2F2F2", "#CFCFD6", "#6E6E78", 215),
    "yellow": ("#F2C94C", "#D9A92E", "#6B4E10", 255),
    "orange": ("#F2994A", "#D9772A", "#6B3410", 255),
    "red": ("#EB5757", "#C93A3A", "#5E1414", 255),
    "black": ("#1A1A1A", "#0A0A0A", "#7A3FB0", 255),
}

POLE_X = 150
POLE_TOP = 70
POLE_BOTTOM = 560
BREAK_Y = 455  # 折れる位置（旗より下、竿の真ん中あたり）


def flag_outline(wave: float = 1.0):
    """竿側を根元にした、はためく三角旗の輪郭点。"""
    x0, y_top, y_bot = POLE_X + 6, 95, 365
    tip = (475, 225)
    pts = []
    n = 40
    # 上辺：根元から先端へ、ゆるい波
    for i in range(n + 1):
        t = i / n
        x = x0 + (tip[0] - x0) * t
        y = y_top + (tip[1] - y_top) * t + math.sin(t * math.pi * 1.5) * 14 * wave * (1 - t * 0.4)
        pts.append((x, y))
    # 下辺：先端から根元へ
    for i in range(n + 1):
        t = 1 - i / n
        x = x0 + (tip[0] - x0) * t
        y = y_bot + (tip[1] - y_bot) * t + math.sin(t * math.pi * 1.5) * 14 * wave * (1 - t * 0.4)
        pts.append((x, y))
    return [(x * S, y * S) for x, y in pts]


def draw_pole(d: ImageDraw.ImageDraw, top: int, bottom: int, finial: bool):
    x = POLE_X * S
    d.rounded_rectangle(
        [x - 7 * S, top * S, x + 7 * S, bottom * S], radius=7 * S, fill="#2B2420"
    )
    d.rounded_rectangle(
        [x - 4 * S, top * S, x + 4 * S, bottom * S], radius=4 * S, fill="#5A4A3E"
    )
    if finial:
        r = 15 * S
        cy = (POLE_TOP - 4) * S
        d.ellipse([x - r, cy - r, x + r, cy + r], fill="#2B2420")
        r2 = 10 * S
        d.ellipse([x - r2, cy - r2, x + r2, cy + r2], fill="#C9A24A")


def draw_flag(name: str) -> Image.Image:
    fill, shade, line, alpha = COLORS[name]
    img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))

    # 黒は紫の煙のようなオーラ、赤は脈打つ光（の静止状態）を後ろに敷く
    if name in ("black", "red"):
        glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        color = (150, 70, 220, 255) if name == "black" else (255, 90, 90, 120)
        gd.polygon(flag_outline(), fill=color)
        glow = glow.filter(ImageFilter.GaussianBlur((20 if name == "black" else 28) * S))
        img = Image.alpha_composite(img, glow)

    d = ImageDraw.Draw(img)
    draw_pole(d, POLE_TOP, POLE_BOTTOM, finial=True)

    body = Image.new("RGBA", img.size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    outline = flag_outline()
    bd.polygon(outline, fill=fill)
    # 下半分に影（アニメ塗りの1段影）
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).polygon(outline, fill=255)
    shade_layer = Image.new("RGBA", img.size, shade)
    band = Image.new("L", img.size, 0)
    ImageDraw.Draw(band).polygon(
        [(POLE_X * S, 260 * S), (480 * S, 225 * S), (480 * S, 400 * S), (POLE_X * S, 400 * S)],
        fill=255,
    )
    shade_mask = Image.composite(band, Image.new("L", img.size, 0), mask)
    body.paste(shade_layer, (0, 0), shade_mask)
    bd.line(outline + [outline[0]], fill=line, width=6 * S, joint="curve")

    if alpha < 255:
        a = body.getchannel("A").point(lambda v: v * alpha // 255)
        body.putalpha(a)
    img = Image.alpha_composite(img, body)
    return img.resize((W, H), Image.LANCZOS)


def split_broken(img: Image.Image):
    """竿の BREAK_Y で上下2パーツに分ける。断面はギザギザにする。"""
    top = img.copy()
    bottom = img.copy()
    jag = []
    for i, x in enumerate(range(POLE_X - 12, POLE_X + 13, 4)):
        jag.append((x, BREAK_Y + (6 if i % 2 else -6)))
    # 上パーツ：ギザギザ線より下を消す（竿の付近だけ）
    m_top = Image.new("L", img.size, 255)
    ImageDraw.Draw(m_top).polygon(
        jag + [(POLE_X + 12, H), (POLE_X - 12, H)], fill=0
    )
    top.putalpha(Image.composite(top.getchannel("A"), Image.new("L", img.size, 0), m_top))
    # 下パーツ：竿の下半分だけ残す
    m_bot = Image.new("L", img.size, 0)
    ImageDraw.Draw(m_bot).polygon(jag + [(POLE_X + 12, H), (POLE_X - 12, H)], fill=255)
    bottom.putalpha(Image.composite(bottom.getchannel("A"), Image.new("L", img.size, 0), m_bot))
    return top, bottom


def preview(flags: dict, broken: dict):
    cell = 256
    ch = cell * H // W
    sheet = Image.new("RGBA", (cell * len(flags), ch * 3), (0, 0, 0, 255))
    d = ImageDraw.Draw(sheet)
    d.rectangle([0, 0, sheet.width, ch], fill="#C8C2B4")
    d.rectangle([0, ch, sheet.width, sheet.height], fill="#2A2C34")
    for i, (name, img) in enumerate(flags.items()):
        small = img.resize((cell, ch), Image.LANCZOS)
        sheet.alpha_composite(small, (i * cell, 0))
        sheet.alpha_composite(small, (i * cell, ch))
        # 折れた状態：上パーツを少し傾けてずらす
        top, bottom = broken[name]
        sheet.alpha_composite(bottom.resize((cell, ch), Image.LANCZOS), (i * cell, ch * 2))
        tilted = top.rotate(-18, center=(POLE_X, BREAK_Y), resample=Image.BICUBIC)
        sheet.alpha_composite(tilted.resize((cell, ch), Image.LANCZOS), (i * cell + 20, ch * 2 - 25))
    sheet.convert("RGB").save(OUT / "preview.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    flags, broken = {}, {}
    for name in COLORS:
        img = draw_flag(name)
        img.save(OUT / f"flag_{name}.png")
        top, bottom = split_broken(img)
        top.save(OUT / f"flag_{name}_broken_top.png")
        bottom.save(OUT / f"flag_{name}_broken_bottom.png")
        flags[name] = img
        broken[name] = (top, bottom)
    preview(flags, broken)
    print("wrote", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
