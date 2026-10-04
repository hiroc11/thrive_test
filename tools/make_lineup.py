"""主要4人の身長・配色・シルエット比較シートを生成する。

AIで生成した三面図が設定どおりか確かめるための基準図。絵としての完成品ではない。
色と身長は企画書「キャラデザインと美術設定」の指定に合わせている。

出力: assets/design/lineup.png
使い方: python3 tools/make_lineup.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "design"
FONT = "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"

S = 2  # 2倍で描いて縮小する
W, H = 1600, 1150
PX_PER_CM = 4.2
GROUND = 880
SKIN = "#F3D9C4"
LINE = "#2A2420"

CHARS = [
    {
        "key": "alto", "name": "アルト", "height": 170, "heads": 6.8, "x": 230,
        "colors": [("髪", "#2B2D33"), ("瞳", "#8A8F99"), ("外套", "#2E3A55"),
                   ("ベスト", "#6B5B4A"), ("帳面", "#A8895C")],
        "mark": "フード＋腰の帳面",
    },
    {
        "key": "lize", "name": "リゼ（19）", "height": 165, "heads": 7.0, "x": 600,
        "colors": [("髪", "#9C4A32"), ("瞳", "#5BA8E0"), ("トップス", "#F4F4F2"),
                   ("スカート", "#2B3350"), ("肩当て", "#8D9696")],
        "mark": "リボンのポニーテール＋左肩だけの肩当て",
    },
    {
        "key": "nox", "name": "ノクス（年齢不詳）", "height": 155, "heads": 6.8, "x": 970,
        "colors": [("髪", "#E6E8EE"), ("瞳", "#E0B341"), ("ドレス", "#14141A"),
                   ("ベール", "#1F1F28"), ("帳簿", "#5C4A3A")],
        "mark": "長いベール＋ほどける裾。頭上に旗なし",
    },
    {
        "key": "gald", "name": "ガルド", "height": 182, "heads": 7.2, "x": 1350,
        "colors": [("髪", "#E8C35A"), ("瞳", "#4CAF6A"), ("マント", "#C8102E"),
                   ("鎧", "#D4AF37"), ("大剣", "#C9D1D9")],
        "mark": "なびくマント＋背中の大剣",
    },
]


def p(v):
    return int(v * S)


def font(size):
    return ImageFont.truetype(FONT, p(size))


class Body:
    """頭身から各部の位置を出す。座標は等倍。"""

    def __init__(self, cx, height_cm, heads):
        self.cx = cx
        self.h = height_cm * PX_PER_CM
        self.top = GROUND - self.h
        self.hh = self.h / heads  # 頭ひとつ分の高さ
        self.chin = self.top + self.hh
        self.shoulder_y = self.chin + self.hh * 0.25
        self.waist = self.chin + self.hh * 2.2
        self.knee = self.waist + (GROUND - self.waist) * 0.5
        self.sw = self.hh * 0.95  # 肩幅の半分

    def head_box(self):
        w = self.hh * 0.42
        return [self.cx - w, self.top, self.cx + w, self.chin]


def rect(d, box, fill, outline=LINE, width=2):
    d.rectangle([p(v) for v in box], fill=fill, outline=outline, width=p(width))


def poly(d, pts, fill, outline=LINE, width=2):
    d.polygon([(p(x), p(y)) for x, y in pts], fill=fill, outline=outline, width=p(width))


def ellipse(d, box, fill, outline=LINE, width=2):
    d.ellipse([p(v) for v in box], fill=fill, outline=outline, width=p(width))


def legs(d, b, color, boots="#3A302A"):
    lw = b.hh * 0.24
    gap = b.hh * 0.06
    for side in (-1, 1):
        x0 = b.cx + side * gap if side > 0 else b.cx - gap - lw
        rect(d, [x0, b.waist, x0 + lw, GROUND], color)
        rect(d, [x0 - 2, GROUND - b.hh * 0.45, x0 + lw + 2, GROUND], boots)


def arms(d, b, color, length=1.45):
    aw = b.hh * 0.2
    for side in (-1, 1):
        x_out = b.cx + side * b.sw
        x_in = x_out - side * aw
        xs = sorted([x_in, x_out])
        rect(d, [xs[0], b.shoulder_y, xs[1], b.shoulder_y + b.hh * length], color)
        hand_y = b.shoulder_y + b.hh * length
        ellipse(d, [xs[0], hand_y - 2, xs[1], hand_y + aw], SKIN)


def torso(d, b, color, bottom=None, flare=1.0):
    bottom = bottom or b.waist
    poly(d, [
        (b.cx - b.sw * 0.82, b.shoulder_y), (b.cx + b.sw * 0.82, b.shoulder_y),
        (b.cx + b.sw * 0.62 * flare, bottom), (b.cx - b.sw * 0.62 * flare, bottom),
    ], color)


def face(d, b, eye):
    ellipse(d, b.head_box(), SKIN)
    ey = b.top + b.hh * 0.58
    ew = b.hh * 0.09
    for side in (-1, 1):
        ex = b.cx + side * b.hh * 0.17
        ellipse(d, [ex - ew, ey - ew * 1.3, ex + ew, ey + ew * 1.3], eye, width=1.5)


def draw_alto(d, b, c):
    legs(d, b, "#3A3A40")
    arms(d, b, c["外套"], 1.4)
    torso(d, b, c["ベスト"])
    # 外套：肩から膝下まで、前が開いている
    for side in (-1, 1):
        poly(d, [
            (b.cx + side * b.sw * 0.35, b.shoulder_y), (b.cx + side * b.sw * 1.08, b.shoulder_y + 6),
            (b.cx + side * b.sw * 1.25, b.knee + b.hh * 0.3), (b.cx + side * b.sw * 0.45, b.knee + b.hh * 0.3),
        ], c["外套"])
    rect(d, [b.cx - b.sw * 0.55, b.waist - 8, b.cx + b.sw * 0.55, b.waist], "#3A302A")
    rect(d, [b.cx - b.sw * 0.42, b.waist - 2, b.cx - b.sw * 0.1, b.waist + b.hh * 0.38], c["帳面"])  # 右の腰
    # フード（かぶっている）
    hb = b.head_box()
    ellipse(d, [hb[0] - 14, hb[1] - 12, hb[2] + 14, hb[3] + 6], c["外套"])
    face(d, b, c["瞳"])
    # 前髪
    poly(d, [(hb[0] + 2, b.top + b.hh * 0.42), (b.cx, b.top + 2), (hb[2] - 2, b.top + b.hh * 0.42),
             (b.cx + 8, b.top + b.hh * 0.32), (b.cx - 6, b.top + b.hh * 0.45)], c["髪"])


def draw_lize(d, b, c):
    hb = b.head_box()
    # 長いハイポニーテール
    ellipse(d, [b.cx + b.hh * 0.2, b.top - b.hh * 0.25, b.cx + b.hh * 0.85, b.top + b.hh * 2.1], c["髪"])
    # 素足と白いロングブーツ
    legs(d, b, SKIN, boots="#F2F2F2")
    lw = b.hh * 0.24
    for x0 in (b.cx - b.hh * 0.06 - lw, b.cx + b.hh * 0.06):
        rect(d, [x0 - 2, b.knee + b.hh * 0.2, x0 + lw + 2, GROUND], "#F2F2F2")
    # 素肌の腕と紺のグローブ
    arms(d, b, SKIN, 1.3)
    aw = b.hh * 0.2
    for side in (-1, 1):
        xs = sorted([b.cx + side * b.sw * 0.85, b.cx + side * b.sw * 0.85 - side * aw])
        rect(d, [xs[0], b.shoulder_y + b.hh * 1.0, xs[1], b.shoulder_y + b.hh * 1.35], c["スカート"])
    # 胴（素肌）と白いチューブトップ
    poly(d, [(b.cx - b.sw * 0.6, b.shoulder_y), (b.cx + b.sw * 0.6, b.shoulder_y),
             (b.cx + b.sw * 0.45, b.waist), (b.cx - b.sw * 0.45, b.waist)], SKIN)
    rect(d, [b.cx - b.sw * 0.6, b.shoulder_y + b.hh * 0.3, b.cx + b.sw * 0.6, b.shoulder_y + b.hh * 0.85],
         c["トップス"])
    # 紺の短いプリーツスカートとベルト
    poly(d, [(b.cx - b.sw * 0.5, b.waist - 6), (b.cx + b.sw * 0.5, b.waist - 6),
             (b.cx + b.sw * 0.72, b.waist + b.hh * 0.7), (b.cx - b.sw * 0.72, b.waist + b.hh * 0.7)], c["スカート"])
    rect(d, [b.cx - b.sw * 0.52, b.waist - 12, b.cx + b.sw * 0.52, b.waist], "#6B4A30")
    # 左肩だけの大きすぎる肩当て（画面右側がキャラの左肩）
    r = b.hh * 0.45
    sx = b.cx + b.sw * 0.75
    ellipse(d, [sx - r, b.shoulder_y - r * 0.55, sx + r, b.shoulder_y + r * 0.75], c["肩当て"])
    # 折れた剣（左の腰）
    hx = b.cx + b.sw * 0.7
    rect(d, [hx - 4, b.waist, hx + 4, b.waist + b.hh * 0.75], "#C9D1D9")
    rect(d, [hx - 12, b.waist - 4, hx + 12, b.waist + 4], "#6B5B4A")
    face(d, b, c["瞳"])
    ellipse(d, [hb[0] - 2, b.top - 2, hb[2] + 2, b.top + b.hh * 0.42], c["髪"])
    ellipse(d, [b.cx + b.hh * 0.3, b.top - b.hh * 0.22, b.cx + b.hh * 0.62, b.top + b.hh * 0.05], "#FFFFFF")
    rect(d, [b.cx + b.hh * 0.18, b.top + b.hh * 0.7, b.cx + b.hh * 0.32, b.top + b.hh * 0.78], "#E8C9A0", width=1)


def draw_nox(d, b, c, img):
    hb = b.head_box()
    # 半透明の黒ベール（頭の後ろから背中へ垂れる）
    veil = Image.new("RGBA", img.size, (0, 0, 0, 0))
    vd = ImageDraw.Draw(veil)
    vd.polygon([(p(hb[0] - 12), p(b.top - 8)), (p(hb[2] + 12), p(b.top - 8)),
                (p(b.cx + b.sw * 1.35), p(b.knee)), (p(b.cx - b.sw * 1.35), p(b.knee))],
               fill=(31, 31, 40, 150))
    img.alpha_composite(veil)
    d = ImageDraw.Draw(img)
    # 足首まで届く白銀の髪（背面）
    poly(d, [(hb[0] - 4, b.top + b.hh * 0.3), (hb[2] + 4, b.top + b.hh * 0.3),
             (b.cx + b.sw * 0.95, GROUND - 10), (b.cx - b.sw * 0.95, GROUND - 10)], c["髪"])
    # ドレス
    poly(d, [(b.cx - b.sw * 0.7, b.shoulder_y), (b.cx + b.sw * 0.7, b.shoulder_y),
             (b.cx + b.sw * 1.1, GROUND - b.hh * 0.5), (b.cx - b.sw * 1.1, GROUND - b.hh * 0.5)], c["ドレス"])
    # 裾は霧のようにほどける
    mist = Image.new("RGBA", img.size, (0, 0, 0, 0))
    md = ImageDraw.Draw(mist)
    md.ellipse([p(b.cx - b.sw * 1.25), p(GROUND - b.hh * 0.8), p(b.cx + b.sw * 1.25), p(GROUND)],
               fill=(20, 20, 26, 170))
    img.alpha_composite(mist.filter(ImageFilter.GaussianBlur(p(10))))
    d = ImageDraw.Draw(img)
    arms(d, b, c["ドレス"], 1.2)
    # 帳簿を胸の前で抱える
    rect(d, [b.cx - b.sw * 0.55, b.shoulder_y + b.hh * 0.75, b.cx + b.sw * 0.55, b.shoulder_y + b.hh * 1.3], c["帳簿"])
    face(d, b, c["瞳"])
    ellipse(d, [hb[0] - 3, b.top - 3, hb[2] + 3, b.top + b.hh * 0.42], c["髪"])
    # 頭の上に旗がない（目印として点線の枠）
    fy = b.top - 70
    for i in range(0, 60, 10):
        d.line([(p(b.cx - 30 + i), p(fy)), (p(b.cx - 25 + i), p(fy))], fill="#8A8273", width=p(2))


def draw_gald(d, b, c):
    # 背中の大剣（右肩の上から斜めに見える）
    poly(d, [(b.cx + b.sw * 0.2, b.waist), (b.cx + b.sw * 0.45, b.waist + 10),
             (b.cx + b.sw * 1.2, b.top + b.hh * 0.15), (b.cx + b.sw * 0.95, b.top + b.hh * 0.05)], c["大剣"])
    # マント（背面、ふくらはぎまで、なびく）
    poly(d, [(b.cx - b.sw * 0.9, b.shoulder_y), (b.cx + b.sw * 0.9, b.shoulder_y),
             (b.cx + b.sw * 1.6, b.knee + b.hh * 0.9), (b.cx - b.sw * 1.35, b.knee + b.hh * 1.0)], c["マント"])
    legs(d, b, "#4A3A2E")
    arms(d, b, c["鎧"], 1.5)
    torso(d, b, c["鎧"], flare=0.78)
    d.line([(p(b.cx), p(b.shoulder_y + 6)), (p(b.cx), p(b.waist - 12))], fill="#8C6D1F", width=p(3))
    d.arc([p(b.cx - b.sw * 0.6), p(b.shoulder_y - b.hh * 0.2), p(b.cx + b.sw * 0.6), p(b.shoulder_y + b.hh * 0.9)],
          20, 160, fill="#8C6D1F", width=p(3))
    rect(d, [b.cx - b.sw * 0.5, b.waist - 10, b.cx + b.sw * 0.5, b.waist + 4], "#8C6D1F")
    face(d, b, c["瞳"])
    hb = b.head_box()
    # オールバック
    poly(d, [(hb[0] - 2, b.top + b.hh * 0.38), (hb[0] + 4, b.top - 8), (hb[2] + 10, b.top - 4),
             (hb[2] + 2, b.top + b.hh * 0.38), (b.cx, b.top + b.hh * 0.22)], c["髪"])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGBA", (p(W), p(H)), "#EEEAE2")
    d = ImageDraw.Draw(img)

    d.text((p(40), p(28)), "主要4人 身長・配色・シルエット比較（AI生成の三面図を確認するための基準）",
           font=font(26), fill="#2A2420")

    # 身長の目盛り線
    for cm in (140, 150, 160, 170, 180):
        y = GROUND - cm * PX_PER_CM
        d.line([(p(90), p(y)), (p(W - 40), p(y))], fill="#CFC8BB", width=p(1.5))
        d.text((p(36), p(y - 10)), f"{cm}cm", font=font(16), fill="#8A8273")
    d.line([(p(40), p(GROUND)), (p(W - 40), p(GROUND))], fill="#8A8273", width=p(3))

    for ch in CHARS:
        b = Body(ch["x"], ch["height"], ch["heads"])
        c = dict(ch["colors"])
        if ch["key"] == "alto":
            draw_alto(d, b, c)
        elif ch["key"] == "lize":
            draw_lize(d, b, c)
        elif ch["key"] == "nox":
            draw_nox(d, b, c, img)
            d = ImageDraw.Draw(img)
        else:
            draw_gald(d, b, c)

        # 名前と身長
        d.text((p(ch["x"]), p(GROUND + 28)), f"{ch['name']}  {ch['height']}cm",
               font=font(24), fill="#2A2420", anchor="mt")
        d.text((p(ch["x"]), p(GROUND + 62)), ch["mark"], font=font(15), fill="#6A6254", anchor="mt")
        # 配色の見本
        sw, gap = 52, 10
        x0 = ch["x"] - (sw * 5 + gap * 4) / 2
        for i, (label, col) in enumerate(ch["colors"]):
            x = x0 + i * (sw + gap)
            y = GROUND + 100
            rect(d, [x, y, x + sw, y + sw], col, outline="#8A8273", width=1)
            d.text((p(x + sw / 2), p(y + sw + 8)), label, font=font(13), fill="#2A2420", anchor="mt")
            d.text((p(x + sw / 2), p(y + sw + 28)), col, font=font(11), fill="#6A6254", anchor="mt")

    img = img.resize((W, H), Image.LANCZOS).convert("RGB")
    img.save(OUT / "lineup.png")
    print("wrote", OUT / "lineup.png")


if __name__ == "__main__":
    main()
