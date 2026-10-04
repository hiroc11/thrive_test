"""第1話B1「前世の死」のVコンテ（仮映像）を生成する。

部品（キャラの配置、カメラ、字幕・テロップ）は make_vconte.py のものを使う。
蓮は基準画像の切り抜き、少年は図形で代用する。

出力: assets/vconte/b1_vconte.mp4（540x960、24fps、無音）
使い方: python3 tools/make_vconte_b1.py
"""
import math
import random
import subprocess

from PIL import Image, ImageDraw

import make_vconte as vc
from make_vconte import FH, FPS, FW, SH, SW, font, place

vc.TELOP = "他人の死は見抜けた。\n自分のだけは無理だった"
vc.CHAR["ren"] = {"name": "蓮", "hair": "#282B2C", "body": "#484C4E"}
vc.CHAR["boy"] = {"name": "少年", "hair": "#1E1A17", "body": "#F4F4F2"}

LINE = "#1E1A17"


# ---------- 背景 ----------

_SUNSET = None


def sunset():
    """オレンジの夕焼け空（上ほど暗い）。"""
    global _SUNSET
    if _SUNSET is None:
        _SUNSET = _draw_sunset()
    return _SUNSET.copy()


def _draw_sunset():
    im = Image.new("RGBA", (SW, SH))
    d = ImageDraw.Draw(im)
    for y in range(SH):
        k = y / SH
        d.line([(0, y), (SW, y)], fill=(int(120 + 120 * k), int(70 + 80 * k), int(80 - 20 * k)))
    return im


def bridge(im, cracks=True, hole=0.0):
    """手前から奥へのびる歩道橋（縦型の一点透視）。hole>0 で手前の床が抜ける。"""
    d = ImageDraw.Draw(im)
    d.polygon([(300, 560), (420, 560), (680, SH), (40, SH)], fill="#8C8A84", outline=LINE)
    for side in (-1, 1):  # 錆びた手すり
        x_far, x_near = 360 + side * 70, 360 + side * 330
        d.line([(x_far, 480), (x_near, 900)], fill="#7A4A30", width=10)
        d.line([(x_far, 560), (x_near, SH)], fill="#5A3A28", width=6)
        for i in range(8):
            k = i / 7
            x = x_far + (x_near - x_far) * k
            d.line([(x, 480 + 420 * k), (x, 560 + 720 * k)], fill="#6A4030", width=3 + int(4 * k))
    d.rectangle([0, 520, 280, 600], fill="#4A3A40")  # 遠くのビル
    d.rectangle([450, 500, 720, 590], fill="#4A3A40")
    if cracks:
        random.seed(3)
        for _ in range(7):
            x, y = random.randint(220, 500), random.randint(820, 1150)
            pts = [(x, y)]
            for _ in range(4):
                x += random.randint(-40, 40)
                y += random.randint(-10, 25)
                pts.append((x, y))
            d.line(pts, fill="#3A3836", width=3)
    if hole > 0:
        r = 360 * hole
        d.ellipse([360 - r, 1100 - r * 0.5, 360 + r, 1100 + r * 0.5], fill="#20140F")


# ---------- シーン ----------

def c01(t):
    im = sunset()
    bridge(im)
    place(im, "ren", 360, 640, 0.9, label=False)
    return im


def c02(t):
    im = Image.new("RGBA", (SW, SH), "#8C8A84")
    d = ImageDraw.Draw(im)
    random.seed(5)
    for _ in range(14):  # ひび割れのアップ
        x, y = random.randint(0, SW), random.randint(0, SH)
        pts = [(x, y)]
        for _ in range(6):
            x += random.randint(-90, 90)
            y += random.randint(-30, 90)
            pts.append((x, y))
        d.line(pts, fill="#3A3836", width=6)
    k = min(1.0, t / 3.0)  # 指が横切る
    fx = -120 + k * 520
    d.rounded_rectangle([fx, 600, fx + 260, 680], radius=36, fill="#F3D9C4", outline=LINE, width=3)
    return im


def c03(t):
    im = sunset()
    bridge(im)
    place(im, "ren", 360, 360, 1.9, label=False)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([380, 600, 640, 770], radius=18, fill=(30, 34, 40, 230), outline="#9FD3FF", width=3)
    d.text((510, 648), "事故確率", font=font(34), fill="#9FD3FF", anchor="mm")
    d.text((510, 720), "年 0.3%", font=font(56), fill="#FFFFFF", anchor="mm")
    return im


def c04(t):
    im = sunset()
    bridge(im)
    d = ImageDraw.Draw(im)
    k = t / 5.0
    s = 0.5 + 0.9 * k
    y = 640 + 300 * k + abs(math.sin(t * 9)) * -12
    vc.draw_char(d, "boy", 360, y, s, label=False)
    d.rounded_rectangle([360 - 50 * s, y + 50 * s, 360 + 50 * s, y + 150 * s], radius=int(12 * s),
                        fill="#C8102E", outline=LINE)  # 赤いランドセル（正面から肩ベルトの見え）
    return im


def c05(t):
    im = sunset()
    place(im, "ren", 360, 600, 6.0, label=False)  # 目のアップ
    return im


def c06(t):
    im = sunset()
    bridge(im)
    place(im, "ren", 360, 420, 1.6, label=False)
    return im


def c07(t):
    im = sunset()
    bridge(im)
    d = ImageDraw.Draw(im)
    vc.draw_char(d, "boy", 360, 760, 1.2, label=False)
    fall = min(1.0, max(0.0, (t - 1.2) / 1.0))  # 一歩先でコンクリート片が落ちる
    d.polygon([(330, 1130 + 120 * fall), (420, 1120 + 120 * fall), (430, 1170 + 120 * fall),
               (320, 1180 + 120 * fall)], fill="#6E6A60", outline=LINE)
    if fall > 0:
        d.polygon([(320, 1120), (430, 1110), (440, 1180), (310, 1190)], fill="#20140F")
    return im


def c08(t):
    im = sunset()
    bridge(im)
    d = ImageDraw.Draw(im)
    k = min(1.0, t / 4.0)  # 少年が奥へ戻っていく
    s = 1.0 - 0.6 * k
    vc.draw_char(d, "boy", 360 + 60 * k, 760 - 180 * k, s, back=True, label=False)
    place(im, "ren", 120, 700, 0.9, view="side", label=False)
    return im


def c09(t):
    im = sunset()
    hole = 0.0 if t < 2.5 else min(1.0, (t - 2.5) / 2.0)
    bridge(im, hole=hole)
    place(im, "ren", 360 - 60 + t * 12, 560, 1.4, view="side", label=False)
    return im


def c10(t):
    im = sunset()
    d = ImageDraw.Draw(im)
    random.seed(7)
    for i in range(10):  # 一緒に落ちる破片
        x = random.randint(40, 680)
        y = (random.randint(0, SH) - t * 60 * (1 + i % 3)) % SH
        d.polygon([(x, y), (x + 40, y + 10), (x + 30, y + 45), (x - 5, y + 35)], fill="#6E6A60", outline=LINE)
    sp = vc.sprite("ren", "front")
    k = t / 7.0
    h = int(900 * (1 - 0.55 * k))
    body = sp.resize((int(sp.width * h / sp.height), h)).rotate(160 + 25 * math.sin(t * 0.8), expand=True)
    im.alpha_composite(body, (int(SW / 2 - body.width / 2), int(SH / 2 - body.height / 2)))
    return im


def c11(t):
    im = sunset()
    d = ImageDraw.Draw(im)
    for i in range(12):  # 上へ流れる風の線
        x = (i * 67) % SW
        y = (SH - (t * 900 + i * 150)) % SH
        d.line([(x, y), (x, y + 140)], fill=(255, 240, 220, 160), width=3)
    place(im, "ren", 360, 520, 5.0, label=False)
    return im


def c12(t):
    im = Image.new("RGBA", (SW, SH), "#000000")
    d = ImageDraw.Draw(im)
    if t > 2.0:
        d.text((360, 560), "死亡フラグが\n見える鑑定士", font=font(78), fill="#F2F2F2", anchor="mm",
               align="center", spacing=18)
        d.text((360, 900), "続きはプロフィールから", font=font(34), fill="#7EC8E3", anchor="mm")
    return im


# (番号, 秒, シーン, カメラ, セリフ, SE/メモ)
CUTS = [
    ("C01", 5, c01, "tilt", "蓮（M）「他人の死は、\nだいたい見抜けた」", "夕暮れの歩道橋"),
    ("C02", 7, c02, "static", "蓮（M）「俺の仕事は損害保険の\nリスク査定。人の『もしも』に\n値段をつけること」", "ひび割れを指でなぞる"),
    ("C03", 6, c03, "push", "蓮（M）「この橋の事故確率、\n年0.3%。……高いな」", ""),
    ("C04", 5, c04, "static", "", "SE：少年の足音"),
    ("C05", 4, c05, "push", "", "蓮の目が足元のひびに向く"),
    ("C06", 4, c06, "static", "蓮「そこ、走らないほうがいい」", ""),
    ("C07", 5, c07, "static", "少年「え？」", "SE：かすかにポキッ（8話の伏線）"),
    ("C08", 5, c08, "static", "蓮「……ほらな」", "少年が引き返す"),
    ("C09", 6, c09, "shake", "蓮（M）「他人の死は、\nだいたい見抜けた」", "SE：ミシッ→床が抜ける"),
    ("C10", 7, c10, "static", "蓮（M）「自分の以外は」", "スローモーション"),
    ("C11", 6, c11, "static", "蓮（M）「……これ、\n労災おりるかな」", "落下しながら真顔"),
    ("C12", 5, c12, "static", "", "暗転／SE：水音"),
]


def main():
    vc.OUT.mkdir(parents=True, exist_ok=True)
    out = vc.OUT / "b1_vconte.mp4"
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{FW}x{FH}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-crf", "23", "-movflags", "+faststart", str(out)],
        stdin=subprocess.PIPE)
    start = 0.0
    for cut, dur, fn, cam, line, memo in CUTS:
        for i in range(int(dur * FPS)):
            t = i / FPS
            frame = vc.camera(fn(t), cam, t, dur).convert("RGBA")
            frame = vc.overlay(frame, cut, start, t, line, memo)
            proc.stdin.write(frame.convert("RGB").tobytes())
        start += dur
    proc.stdin.close()
    proc.wait()
    print("wrote", out, f"{start:.0f}s")


if __name__ == "__main__":
    main()
