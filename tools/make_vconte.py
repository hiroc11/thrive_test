"""第1話B4「ざまぁ回収」のVコンテ（仮映像）を生成する。

絵の代わりに簡単な図形でキャラと背景を置き、カット表どおりの尺・カメラ・
セリフ字幕・旗・テロップを入れた縦型動画を作る。テンポと構図の確認用。

出力: assets/vconte/b4_vconte.mp4（540x960、24fps、無音）
使い方: python3 tools/make_vconte.py
"""
import math
import random
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "vconte"
FLAGS = ROOT / "assets" / "flags"
FONT = "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"

FW, FH = 540, 960  # 出力フレーム
SW, SH = 720, 1280  # シーン（カメラで切り出す元）
FPS = 24
TELOP = "追放された鑑定士の警告を\n無視した勇者の末路"

CHAR = {
    "alto": {"name": "アルト", "hair": "#2B2D33", "body": "#2E3A55"},
    "gald": {"name": "ガルド", "hair": "#E8C35A", "body": "#D4AF37", "cape": "#C8102E"},
    "pipi": {"name": "ピピ", "hair": "#D9B99B", "body": "#3F5A4A"},
    "doran": {"name": "ドラン", "hair": None, "body": "#7E848C"},
}
SKIN = "#F3D9C4"
LINE = "#1E1A17"

_fonts = {}


def font(size):
    if size not in _fonts:
        _fonts[size] = ImageFont.truetype(FONT, size)
    return _fonts[size]


# ---------- 部品 ----------

def draw_char(d, key, x, y, s=1.0, back=False, label=True, bandage=False):
    """(x, y) は頭の中心。s は大きさ。"""
    c = CHAR[key]
    r = 42 * s
    bw, bh = 100 * s, 190 * s
    if key == "doran":
        bw *= 1.4
    if "cape" in c:
        d.polygon([(x - bw * 0.6, y + r), (x + bw * 0.6, y + r), (x + bw * 0.9, y + r + bh * 1.1),
                   (x - bw * 0.9, y + r + bh * 1.1)], fill=c["cape"], outline=LINE)
    d.rounded_rectangle([x - bw / 2, y + r * 0.9, x + bw / 2, y + r + bh], radius=int(18 * s),
                        fill=c["body"], outline=LINE, width=max(1, int(2 * s)))
    d.ellipse([x - r, y - r, x + r, y + r], fill=c["hair"] if back and c["hair"] else SKIN,
              outline=LINE, width=max(1, int(2 * s)))
    if not back:
        if c["hair"]:
            d.chord([x - r, y - r, x + r, y + r * 0.4], 180, 360, fill=c["hair"], outline=LINE)
        for side in (-1, 1):
            d.ellipse([x + side * r * 0.38 - 5 * s, y - 4 * s, x + side * r * 0.38 + 5 * s, y + 8 * s], fill=LINE)
    if key == "alto":
        d.arc([x - r * 1.25, y - r * 1.25, x + r * 1.25, y + r * 1.15], 160, 380, fill=c["body"], width=int(14 * s))
    if key == "pipi":
        d.polygon([(x - r * 1.3, y - r * 0.5), (x + r * 1.3, y - r * 0.5), (x + r * 0.3, y - r * 2.6)],
                  fill=c["body"], outline=LINE)
    if bandage:
        for i in range(5):
            yy = y - r * 0.8 + i * r * 0.38
            d.line([(x - r, yy), (x + r, yy + 6 * s)], fill="#F4F1EA", width=int(8 * s))
    if label:
        d.text((x, y + r + bh + 12 * s), c["name"], font=font(max(14, int(22 * s))), fill="#FFFFFF",
               anchor="mt", stroke_width=2, stroke_fill="#000000")


_flag_cache = {}


def flag_image(color, text, height):
    key = (color, text, height)
    if key not in _flag_cache:
        im = Image.open(FLAGS / f"flag_{color}.png").convert("RGBA")
        d = ImageDraw.Draw(im)
        size = 110 if len(text) == 1 else 62
        fill = "#1E1A17" if color in ("white", "yellow") else "#FFFFFF"
        d.text((285, 228), text, font=font(size), fill=fill, anchor="mm")
        w = int(im.width * height / im.height)
        _flag_cache[key] = im.resize((w, height), Image.LANCZOS)
    return _flag_cache[key]


def paste_flag(scene, color, text, head_x, head_y, s, t, alpha=1.0):
    """頭の上に旗を置き、ゆっくり上下に揺らす。"""
    h = int(150 * s)
    im = flag_image(color, text, h)
    if alpha < 1.0:
        im = im.copy()
        im.putalpha(im.getchannel("A").point(lambda v: int(v * alpha)))
    bob = math.sin(t * 2 * math.pi / 2.5) * 6 * s
    pole_x = int(im.width * 150 / 512)
    x = int(head_x - pole_x)
    y = int(head_y - 42 * s - h - 8 * s + bob)
    scene.alpha_composite(im, (max(0, x), max(0, y)))


def sepia(img):
    g = img.convert("L")
    return Image.merge("RGB", [g.point(lambda v: min(255, int(v * 1.07 + 20))),
                               g.point(lambda v: int(v * 0.95 + 10)),
                               g.point(lambda v: int(v * 0.78))]).convert("RGBA")


# ---------- シーン ----------

def bg(color):
    return Image.new("RGBA", (SW, SH), color)


def scene_c01(t):
    im = bg("#7A5A3A")
    d = ImageDraw.Draw(im)
    d.rectangle([150, 250, 570, 1150], fill="#3A2A1C", outline=LINE, width=4)
    d.rectangle([180, 280, 540, 1150], fill="#C9A06A")
    draw_char(d, "alto", 360, 560, 1.6)
    return sepia(im)


def scene_c02(t):
    im = bg("#7A5A3A")
    d = ImageDraw.Draw(im)
    for i in range(6):
        d.rectangle([i * 130, 0, i * 130 + 60, SH], fill="#6A4A2E")
    draw_char(d, "gald", 360, 520, 1.9)
    im = sepia(im)
    paste_flag(im, "red", "扉", 360, 520, 1.9, t)
    return im


def scene_c03(t):
    im = bg("#14211F")
    d = ImageDraw.Draw(im)
    d.rectangle([110, 120, 610, 1050], fill="#D4AF37", outline="#8C6D1F", width=8)
    d.line([(360, 120), (360, 1050)], fill="#8C6D1F", width=8)
    for r in (60, 110):
        d.ellipse([360 - r, 420 - r, 360 + r, 420 + r], outline="#8C6D1F", width=6)
    d.rectangle([0, 1050, SW, SH], fill="#26302C")
    for i, k in enumerate(["pipi", "gald", "doran"]):
        draw_char(d, k, 230 + i * 130, 1000, 0.55, back=True)
    return im


def scene_c04(t):
    im = bg("#1C2A27")
    d = ImageDraw.Draw(im)
    d.ellipse([60, 200, 200, 340], fill="#E0A040")
    draw_char(d, "pipi", 360, 600, 1.8)
    d.text((470, 520), "汗", font=font(36), fill="#9FD3FF")
    return im


def scene_c05(t):
    im = bg("#1C2A27")
    d = ImageDraw.Draw(im)
    d.rectangle([470, 0, SW, SH], fill="#D4AF37", outline="#8C6D1F", width=6)
    draw_char(d, "gald", 300, 560, 2.0)
    d.ellipse([440, 760, 520, 840], fill=SKIN, outline=LINE, width=3)
    k = min(1.0, max(0.0, (t - 2.0) / 3.0))  # 2秒目から3秒かけて赤→黒
    paste_flag(im, "red", "扉", 300, 560, 2.0, t, alpha=1 - k)
    if k > 0:
        paste_flag(im, "black", "扉", 300, 560, 2.0, t, alpha=k)
    return im


def scene_c06(t):
    im = bg("#1C2A27")
    d = ImageDraw.Draw(im)
    draw_char(d, "doran", 360, 640, 3.4, label=False)
    d.text((360, 1180), "ドラン", font=font(26), fill="#FFFFFF", anchor="mm", stroke_width=2, stroke_fill="#000")
    return im


def scene_c07(t):
    im = bg("#14211F")
    d = ImageDraw.Draw(im)
    open_k = min(1.0, t / 3.0)
    d.rectangle([110, 120, 610, 1050], fill="#F2E6C0")
    d.rectangle([160, 200, 560, 1050], fill="#5A5248")
    d.polygon([(300, 1000), (420, 990), (430, 1030), (310, 1040)], fill="#F4F1EA", outline=LINE)
    half = 250 * (1 - open_k)
    d.rectangle([110, 120, 110 + half, 1050], fill="#D4AF37", outline="#8C6D1F", width=6)
    d.rectangle([610 - half, 120, 610, 1050], fill="#D4AF37", outline="#8C6D1F", width=6)
    d.rectangle([0, 1050, SW, SH], fill="#26302C")
    return im


def scene_c08(t):
    im = bg("#2A2A2A")
    d = ImageDraw.Draw(im)
    d.rectangle([110, 380, 610, 900], fill="#F4F1EA", outline=LINE, width=4)
    d.text((360, 640), "ハズレ", font=font(120), fill="#1E1A17", anchor="mm")
    for side in (-1, 1):
        d.ellipse([360 + side * 300 - 50, 600, 360 + side * 300 + 50, 700], fill=SKIN, outline=LINE, width=3)
    return im


def scene_c09(t):
    im = bg("#3A3A36")
    d = ImageDraw.Draw(im)
    for i in range(5):
        d.line([(0, 200 + i * 220), (SW, 240 + i * 220)], fill="#2A2A26", width=6)
    split = min(1.0, t / 2.0) * 120
    d.rectangle([360 - split, 0, 360 + split, SH], fill="#0E0E0E")
    for i, k in enumerate(["pipi", "gald", "doran"]):
        x = 230 + i * 130
        draw_char(d, k, x, 700, 0.8, back=False, label=True)
    return im


def scene_c10(t):
    im = bg("#3A3A36")
    d = ImageDraw.Draw(im)
    random.seed(10)
    for i in range(14):
        sx = random.randint(40, 680)
        sp = random.uniform(400, 700)
        y = -100 + (t * sp + i * 90) % (SH + 200)
        d.ellipse([sx - 34, y - 26, sx + 34, y + 26], fill="#5BA8E0", outline=LINE, width=3)
    d.rectangle([0, 0, SW, SH * min(1.0, t / 6) * 0.3], fill="#4A7FB0")
    by = -300 + min(1.0, t / 1.5) * 700
    d.ellipse([200, by, 520, by + 320], fill="#6E6A60", outline=LINE, width=6)
    draw_char(d, "gald", 360, 820, 1.4)
    d.ellipse([335, 830, 385, 880], fill="#1E1A17")
    return im


def scene_c11(t):
    im = bg("#BFD8E8")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 520, SW, SH], fill="#A8B878")
    d.polygon([(300, 520), (420, 520), (720, SH), (0, SH)], fill="#C8B48A")
    d.polygon([(500, 520), (600, 380), (700, 520)], fill="#3A3A44")  # 黒竜峰
    d.rectangle([60, 470, 200, 520], fill="#F0F0F0")  # 遠くの王都
    cloud = min(1.0, max(0.0, (t - 0.8) / 3.0))
    if cloud > 0:
        r = 40 + cloud * 160
        d.ellipse([140 - r, 500 - r * 1.3, 140 + r, 520], fill="#9A8A70")
    walk = math.sin(t * 6) * 6
    draw_char(d, "alto", 360, 760 + walk + t * 18, 1.1 + t * 0.05)
    return im


def scene_c12(t):
    im = bg("#E89A5A")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 760, SW, SH], fill="#6A5040")
    d.rectangle([40, 300, 300, 760], fill="#4A3A30")
    d.rectangle([90, 420, 250, 760], fill="#1A1210")
    shift = (t / 8) * 260 - 130
    for i, k in enumerate(["gald", "pipi", "doran"]):
        x = 220 + i * 230 + shift
        d.rounded_rectangle([x - 100, 880 + i * 40, x + 100, 940 + i * 40], radius=12, fill="#C8B48A", outline=LINE)
        draw_char(d, k, x - 60, 860 + i * 40, 0.5, label=False, bandage=(k == "gald"))
    return im


def scene_c13(t):
    im = scene_c12(8.0)
    k = min(1.0, max(0.0, (t - 1.5) / 2.0))
    gx = 220 + 130 - 60
    paste_flag(im, "red", "扉", gx, 860, 1.1, t, alpha=1 - k)
    if k > 0:
        paste_flag(im, "red", "逆恨み", gx, 860, 1.1, t, alpha=k)
    return im


def scene_c14(t):
    im = bg("#14141A")
    d = ImageDraw.Draw(im)
    d.text((360, 560), "死亡フラグが\n見える鑑定士", font=font(78), fill="#F2F2F2", anchor="mm",
           align="center", spacing=18)
    d.text((360, 900), "続きはプロフィールから", font=font(34), fill="#7EC8E3", anchor="mm")
    top = Image.open(FLAGS / "flag_white_broken_top.png").convert("RGBA").resize((170, 200))
    bottom = Image.open(FLAGS / "flag_white_broken_bottom.png").convert("RGBA").resize((170, 200))
    im.alpha_composite(bottom, (300, 120))
    k = min(1.0, max(0.0, (t - 1.0) / 1.2))
    rot = top.rotate(-70 * k, center=(50, 152), resample=Image.BICUBIC)
    im.alpha_composite(rot, (300 + int(40 * k), 120 + int(260 * k * k)))
    return im


# ---------- カット表 ----------
# (番号, 秒, シーン関数, カメラ, セリフ, SE/メモ)
CUTS = [
    ("C01", 3, scene_c01, "push", "アルト「今日、扉は開けない\nほうがいいですよ」", "振り返り"),
    ("C02", 3, scene_c02, "static", "ガルド「俺は勇者だ。\n扉は、開けるためにある」", "振り返り"),
    ("C03", 5, scene_c03, "tilt", "", "SE：重低音のドーン"),
    ("C04", 5, scene_c04, "static", "ピピ「ね、ねえガルド。\nさっきアルトが言ってた\n『扉』って……」", ""),
    ("C05", 6, scene_c05, "push", "ガルド「ハッ、偶然だ。それに――\nフラグなんてものは、\n俺がへし折ってやる」", "旗：赤→黒"),
    ("C06", 3, scene_c06, "static", "ドラン「……それ、フラグ」", "前後に0.5秒の無音"),
    ("C07", 6, scene_c07, "static", "", "SE：ギィィィ（扉）"),
    ("C08", 4, scene_c08, "static", "ピピ「『ハズレ』」", ""),
    ("C09", 3, scene_c09, "shake", "", "SE：ゴゴゴゴゴ"),
    ("C10", 6, scene_c10, "shake", "ガルド「なんでだああああ！！」", "SE：崩落＋水＋ポヨン"),
    ("C11", 8, scene_c11, "static", "アルト「……だから言ったのに」", "SE：遠くでドゴォォン／BGM切替"),
    ("C12", 8, scene_c12, "static", "ガルド「あ、あいつ……\n許さねえ……」", ""),
    ("C13", 6, scene_c13, "push13", "（N）勇者のフラグは、\nまだ折れていない", "旗の文字：扉→逆恨み"),
    ("C14", 4, scene_c14, "static", "", "SE：ポキッ"),
]


def camera(scene, mode, t, dur):
    k = t / dur
    if mode == "push":
        z, cx, cy = 1.0 + 0.22 * k, SW / 2, SH * 0.45
    elif mode == "push13":
        z, cx, cy = 1.0 + 1.1 * min(1.0, k * 1.6), 290, 700
    elif mode == "tilt":
        z, cx, cy = 1.3, SW / 2, SH * (0.72 - 0.42 * k)
    elif mode == "shake":
        random.seed(int(t * FPS))
        z, cx, cy = 1.1, SW / 2 + random.uniform(-14, 14), SH / 2 + random.uniform(-14, 14)
    else:
        z, cx, cy = 1.0, SW / 2, SH / 2
    w, h = SW / z, SH / z
    x0 = min(max(cx - w / 2, 0), SW - w)
    y0 = min(max(cy - h / 2, 0), SH - h)
    return scene.crop((int(x0), int(y0), int(x0 + w), int(y0 + h))).resize((FW, FH), Image.BILINEAR)


def overlay(frame, cut, start, t, line, memo):
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # 上部の常時テロップ
    d.rectangle([0, 0, FW, 118], fill=(0, 0, 0, 170))
    d.multiline_text((FW / 2, 60), TELOP, font=font(30), fill="#FFE27A", anchor="mm", align="center",
                     spacing=8, stroke_width=2, stroke_fill="#000")
    # セリフ字幕（顔にかからず、アプリ下部のUIにも隠れない高さ）
    if line:
        tb = d.multiline_textbbox((FW / 2, 770), line, font=font(28), anchor="mm", align="center", spacing=8)
        d.rounded_rectangle([tb[0] - 18, tb[1] - 14, tb[2] + 18, tb[3] + 14], radius=12, fill=(0, 0, 0, 150))
        d.multiline_text((FW / 2, 770), line, font=font(28), fill="#FFFFFF", anchor="mm", align="center",
                         spacing=8)
    # カット番号・タイムコード・SEメモ
    tc = start + t
    d.rectangle([0, FH - 44, FW, FH], fill=(0, 0, 0, 190))
    d.text((12, FH - 22), f"{cut}  {int(tc // 60)}:{int(tc % 60):02d}", font=font(20), fill="#FFFFFF",
           anchor="lm")
    if memo:
        d.text((FW - 12, FH - 22), memo, font=font(18), fill="#9FD3FF", anchor="rm")
    d.text((FW - 10, 128), "Vコンテ", font=font(16), fill="#FFFFFF", anchor="rt")
    return Image.alpha_composite(frame, layer)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "b4_vconte.mp4"
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{FW}x{FH}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-crf", "23", "-movflags", "+faststart", str(out)],
        stdin=subprocess.PIPE)
    start = 0.0
    for cut, dur, fn, cam, line, memo in CUTS:
        for i in range(int(dur * FPS)):
            t = i / FPS
            scene = fn(t)
            frame = camera(scene, cam, t, dur).convert("RGBA")
            frame = overlay(frame, cut, start, t, line, memo)
            proc.stdin.write(frame.convert("RGB").tobytes())
        start += dur
    proc.stdin.close()
    proc.wait()
    print("wrote", out, f"{start:.0f}s")


if __name__ == "__main__":
    main()
