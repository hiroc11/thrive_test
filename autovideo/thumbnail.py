"""サムネイル3案（1280x720）。人が1つ選んで YouTube にアップする。"""
from PIL import Image, ImageDraw

from . import textdraw
from .visuals import cover

SIZE = (1280, 720)


def make_thumbnails(thumb, base_img, cfg, out_dir):
    c = cfg["colors"]
    base = cover(Image.open(base_img).convert("RGB"), SIZE)
    text, sub = thumb["text"], thumb.get("sub", "")
    paths = []
    for i, fn in enumerate((_left_text, _bottom_band, _bold_split), 1):
        img = fn(base.copy(), text, sub, c)
        path = out_dir / f"thumb_{i}.png"
        img.save(path)
        paths.append(path)
    return paths


def _left_text(img, text, sub, c):
    """左に暗いグラデーション＋大きな文字。"""
    w, h = SIZE
    shade = Image.new("L", SIZE)
    for x in range(w):
        shade.paste(int(230 * max(0.0, 1 - x / (w * 0.75))), (x, 0, x + 1, h))
    img.paste(Image.new("RGB", SIZE, "#000000"), mask=shade)
    draw = ImageDraw.Draw(img)
    size, lines = textdraw.fit_wrap(text, 130, 80, w * 0.62, 3)
    top = (h - textdraw.lines_height(len(lines), size, 1.12)) / 2 - (30 if sub else 0)
    y = textdraw.draw_lines(draw, lines, size, 50, top, c["accent"], stroke=8, line_gap=1.12, align="left")
    if sub:
        textdraw.draw_lines(draw, [sub], 50, 56, y + 10, "#ffffff", stroke=5, align="left")
    return img


def _bottom_band(img, text, sub, c):
    """下に赤い帯＋白文字。"""
    w, h = SIZE
    draw = ImageDraw.Draw(img)
    size, lines = textdraw.fit_wrap(text, 110, 70, w - 80, 2)
    band_h = textdraw.lines_height(len(lines), size, 1.1) + 60
    draw.rectangle([0, h - band_h, w, h], fill="#dc2626")
    textdraw.draw_lines(draw, lines, size, w / 2, h - band_h + 26, "#ffffff", stroke=6, line_gap=1.1)
    if sub:
        label_w = textdraw.text_width(sub, 46) + 50
        draw.rectangle([30, 30, 30 + label_w, 110], fill=c["accent"])
        textdraw.draw_lines(draw, [sub], 46, 55, 44, "#000000", align="left")
    return img


def _bold_split(img, text, sub, c):
    """左半分を単色、右半分に画像。"""
    w, h = SIZE
    canvas = Image.new("RGB", SIZE, c["accent"])
    right = cover(img, (w // 2, h))
    canvas.paste(right, (w // 2, 0))
    draw = ImageDraw.Draw(canvas)
    size, lines = textdraw.fit_wrap(text, 120, 70, w / 2 - 70, 4)
    top = (h - textdraw.lines_height(len(lines), size, 1.1)) / 2 - (30 if sub else 0)
    y = textdraw.draw_lines(draw, lines, size, 40, top, "#000000", line_gap=1.1, align="left")
    if sub:
        textdraw.draw_lines(draw, [sub], 46, 44, y + 8, "#7f1d1d", align="left")
    return canvas
