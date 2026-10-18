"""三面図（基準画像）からキャラを切り抜き、背景透過のPNGにする。

白背景のうち、画像の外周とつながっている部分だけを透明にする。
キャラの中の白（ケーキのクリームなど）は残る。

出力: assets/design/sprites/<名前>.png
使い方: python3 tools/extract_sprites.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
REFS = ROOT / "assets" / "design" / "refs"
OUT = ROOT / "assets" / "design" / "sprites"

# 出力名: (基準画像, 左から何番目の絵か)
SPRITES = {
    "alto_front": ("alto_ref.png", 1),
    "alto_side": ("alto_ref.png", 2),
    "alto_back": ("alto_ref.png", 3),
    "pipi_front": ("pipi_ref.png", 0),
    "pipi_side": ("pipi_ref.png", 1),
    "pipi_back": ("pipi_ref.png", 2),
    "lize_front": ("lize_ref.png", 0),
    "lize_side": ("lize_ref.png", 1),
    "lize_back": ("lize_ref.png", 2),
    "ren_front": ("ren_ref.png", 0),
    "ren_side": ("ren_ref.png", 1),
    "ren_back": ("ren_ref.png", 2),
}

WHITE = 232  # これより明るい画素を背景候補とみなす


def figure_segments(im):
    """縦に白い列で区切られた、キャラの左右の範囲を返す。"""
    w, h = im.size
    px = im.load()
    segs, start = [], None
    for x in range(w):
        dark = any(min(px[x, y]) < WHITE for y in range(0, h, 3))
        if dark and start is None:
            start = x
        elif not dark and start is not None:
            if x - start > 20:
                segs.append((start, x))
            start = None
    if start is not None:
        segs.append((start, w))
    return segs


def cut(im):
    w, h = im.size
    gray = im.convert("RGB")
    mask = Image.new("L", (w + 2, h + 2), 255)  # 外周を1画素広げて背景をつなげる
    mpx, gpx = mask.load(), gray.load()
    for y in range(h):
        for x in range(w):
            if min(gpx[x, y]) < WHITE:
                mpx[x + 1, y + 1] = 0
    ImageDraw.floodfill(mask, (0, 0), 128)
    alpha = mask.crop((1, 1, w + 1, h + 1)).point(lambda v: 0 if v == 128 else 255)
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out.crop(out.getbbox())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cache = {}
    for name, (ref, idx) in SPRITES.items():
        path = REFS / ref
        if not path.exists():
            print("skip", name, "(基準画像なし)")
            continue
        im = cache.setdefault(ref, Image.open(path).convert("RGB"))
        segs = figure_segments(im)
        a, b = segs[idx]
        sprite = cut(im.crop((max(0, a - 6), 0, min(im.width, b + 6), im.height)))
        sprite.save(OUT / f"{name}.png")
        print("wrote", name, sprite.size)


if __name__ == "__main__":
    main()
