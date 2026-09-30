"""日本語テキスト描画（フォント解決・折り返し・字幕PNG）。"""
import re
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

NO_LINE_START = set("、。，．・：；？！ー」』）］｝〉》ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ")

_font_candidates = []


def set_font_candidates(paths):
    _font_candidates[:] = paths
    font_path.cache_clear()
    font.cache_clear()


@lru_cache(maxsize=None)
def font_path():
    for p in _font_candidates:
        if Path(p).exists():
            return p
    raise SystemExit(f"日本語フォントが見つかりません。config.json の fonts にパスを追加してください: {_font_candidates}")


@lru_cache(maxsize=None)
def font(size):
    return ImageFont.truetype(font_path(), size)


def text_width(text, size):
    return font(size).getlength(text)


def _tokens(text):
    """英数字の連続（AI, GPT-5, 30分 など）は途中で折らないよう1トークンにまとめる。"""
    return re.findall(r"[A-Za-z0-9.,%+\-]+[分秒円万億千倍人本件社位年月日時個回割]*|.", text)


def wrap(text, size, max_width):
    """トークン単位で詰めて max_width で折り返す（簡易禁則つき）。改行文字も尊重する。"""
    lines = []
    for para in text.split("\n"):
        line = ""
        for tok in _tokens(para):
            if line and text_width(line + tok, size) > max_width and tok[0] not in NO_LINE_START:
                lines.append(line)
                line = tok
            else:
                line += tok
        lines.append(line)
    return lines


def balanced_wrap(text, size, max_width):
    """行数を増やさない範囲で幅を詰め、最終行に1〜2文字だけ残るのを防ぐ。"""
    lines = wrap(text, size, max_width)
    if len(lines) < 2 or "\n" in text:
        return lines
    lo, hi = max_width * 0.4, max_width
    while hi - lo > 4:
        mid = (lo + hi) / 2
        if len(wrap(text, size, mid)) > len(lines):
            lo = mid
        else:
            hi = mid
    return wrap(text, size, hi)


def fit_wrap(text, max_size, min_size, max_width, max_lines):
    """max_lines 行に収まる最大のフォントサイズで折り返す。"""
    size = max_size
    while size > min_size:
        lines = balanced_wrap(text, size, max_width)
        if len(lines) <= max_lines:
            return size, lines
        size -= 4
    return min_size, balanced_wrap(text, min_size, max_width)[:max_lines]


def draw_lines(draw, lines, size, center_x, top, fill, stroke=0, stroke_fill="#000000", line_gap=1.25, align="center"):
    f = font(size)
    y = top
    for line in lines:
        w = f.getlength(line)
        x = center_x - w / 2 if align == "center" else center_x
        draw.text((x, y), line, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
        y += size * line_gap
    return y


def lines_height(n, size, line_gap=1.25):
    return size * line_gap * n


def subtitle_png(text, canvas_size, out, layout="long"):
    """透明背景に字幕を描いたPNG。長尺は画面下、ショートは画像の下の帯に置く。"""
    w, h = canvas_size
    img = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if layout == "long":
        size, lines = fit_wrap(text, 58, 40, w - 240, 2)
        bottom = h - 60
    else:
        size, lines = fit_wrap(text, 72, 52, w - 100, 3)
        bottom = 1560
    top = bottom - lines_height(len(lines), size)
    draw_lines(draw, lines, size, w / 2, top, "#ffffff", stroke=max(4, size // 9))
    img.save(out)
    return out
