"""B1の静止画をGoogle Veo（Gemini API）で動画クリップにする。

assets/stills/b1/<カット>.jpg を元画像として送り、カットごとの動きの指示で
動かしたクリップを assets/stills/b1/<カット>.mp4 に保存する。
make_vconte_b1.py は .mp4 があればそれを静止画より優先して使う。

準備:
  pip install google-genai
  環境変数 GEMINI_API_KEY にAPIキーを入れる（チャットには貼らない）

使い方:
  python3 tools/veo_generate.py --list-models          # 使えるVeoのモデル名を確認
  python3 tools/veo_generate.py --dry-run              # 送る内容と料金の目安だけ表示
  python3 tools/veo_generate.py C04 C07 C09 C10 C11    # 指定カットを生成
  python3 tools/veo_generate.py --model <モデル名> --resolution 720p C04
"""
import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STILLS = ROOT / "assets" / "stills" / "b1"

STYLE = ("Japanese anime style, cel shading, clean bold lineart, muted desaturated colors, "
         "warm orange sunset lighting. Keep the character design, colors and background exactly as in "
         "the input image. No text, no subtitles, no flags.")
NEGATIVE = "text, subtitles, watermark, extra people, deformed hands, face change, style change, live action"

# カットごとの動き（制作パックのカット表「動画化の指示」を元に、具体的に書いたもの）
MOTION = {
    "C01": "Slow camera tilt down from the sunset sky to the lonely man standing on the overpass. "
           "Only his hair and tie move slightly in the wind.",
    "C02": "The man's fingertip slowly traces along the crack in the concrete. Fine dust drifts. Camera still.",
    "C03": "The tired man looks down at his tablet and slowly breathes out. Subtle slow push in.",
    "C04": "The boy runs happily toward the camera along the overpass, the red school backpack bouncing "
           "with each step. Camera slowly moves back.",
    "C05": "The man's half-closed eyes suddenly widen and focus. The sunset reflection shimmers in his eyes. "
           "Very slow push in.",
    "C06": "The man raises his right hand slightly and speaks calmly. Subtle mouth movement. Camera still.",
    "C07": "The boy stops abruptly in surprise. The chunk of concrete in front of him breaks off and falls "
           "down through the hole, dust bursting up.",
    "C08": "The boy walks away into the distance along the overpass. The man stays still in the foreground. "
           "Camera still.",
    "C09": "The concrete under the man's feet cracks and collapses. He loses his balance with a shocked face. "
           "Dust bursts up, strong camera shake.",
    "C10": "Slow motion: the man falls backward through the air below the broken overpass, concrete debris "
           "and the tablet tumbling around him.",
    "C11": "Close-up while falling: his hair and necktie flutter violently upward in the wind. His face stays "
           "completely deadpan. Small debris drifts past.",
}

# 1秒あたりの料金の目安（USD）。2026年9月時点の公開情報。必ず公式の料金ページで確認すること。
PRICE = {
    ("lite", "720p"): 0.05, ("lite", "1080p"): 0.08,
    ("fast", "720p"): 0.10, ("fast", "1080p"): 0.12,
    ("standard", "720p"): 0.40, ("standard", "1080p"): 0.40,
}


def tier(model):
    m = model.lower()
    return "lite" if "lite" in m else "fast" if "fast" in m else "standard"


def client():
    if not os.environ.get("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY が設定されていません。環境の設定で登録してください。")
    from google import genai
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])


def list_models():
    for m in client().models.list():
        if "veo" in m.name.lower():
            print(m.name)


def source_image(cut):
    path = next((p for p in sorted(STILLS.glob(f"{cut}.*")) if p.suffix.lower() in (".jpg", ".jpeg", ".png")),
                None)
    if path is None:
        sys.exit(f"{cut} の静止画が {STILLS} にありません。")
    return path


def generate(cl, cut, args):
    from google.genai import types

    path = source_image(cut)
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    config = dict(aspect_ratio="9:16", resolution=args.resolution, duration_seconds=args.duration,
                  negative_prompt=NEGATIVE, number_of_videos=1)
    if args.no_audio:
        config["generate_audio"] = False
    op = cl.models.generate_videos(
        model=args.model,
        prompt=f"{MOTION[cut]} {STYLE}",
        image=types.Image(image_bytes=path.read_bytes(), mime_type=mime),
        config=types.GenerateVideosConfig(**config),
    )
    print(f"{cut}: 生成中…", flush=True)
    while not op.done:
        time.sleep(10)
        op = cl.operations.get(op)
    if op.error:
        print(f"{cut}: 失敗 {op.error}")
        return False
    videos = op.response.generated_videos if op.response else None
    if not videos:
        print(f"{cut}: 動画が返ってきませんでした（安全フィルターで止められた可能性があります）")
        return False
    out = STILLS / f"{cut}.mp4"
    if out.exists() and not args.overwrite:  # 前のクリップは残し、番号付きで保存する
        n = 2
        while (STILLS / f"{cut}_take{n}.mp4").exists():
            n += 1
        out = STILLS / f"{cut}_take{n}.mp4"
    cl.files.download(file=videos[0].video)
    videos[0].video.save(str(out))
    print(f"{cut}: 保存しました → {out.relative_to(ROOT)}")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cuts", nargs="*", help="生成するカット（省略時は C01〜C11 すべて）")
    ap.add_argument("--model", default=os.environ.get("VEO_MODEL", "veo-3.1-fast-generate-preview"),
                    help="Veoのモデル名（--list-models で確認）")
    ap.add_argument("--resolution", default="1080p", choices=["720p", "1080p"])
    ap.add_argument("--duration", type=int, default=6, help="秒数（モデルが対応する値: 4/6/8 など）")
    ap.add_argument("--no-audio", action="store_true", help="音声を生成しない（対応モデルのみ）")
    ap.add_argument("--overwrite", action="store_true", help="既存の <カット>.mp4 を上書きする")
    ap.add_argument("--list-models", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="APIを呼ばず、送る内容と料金の目安だけ表示")
    args = ap.parse_args()

    if args.list_models:
        list_models()
        return
    cuts = args.cuts or sorted(MOTION)
    unknown = [c for c in cuts if c not in MOTION]
    if unknown:
        sys.exit(f"不明なカット: {unknown}")

    rate = PRICE[(tier(args.model), args.resolution)]
    total = rate * args.duration * len(cuts)
    print(f"モデル {args.model} / {args.resolution} / {args.duration}秒 × {len(cuts)}カット")
    print(f"料金の目安: 約 ${total:.2f}（約 {total * 150:,.0f} 円、1ドル150円換算・1回ずつの場合）")
    if args.dry_run:
        for c in cuts:
            print(f"\n[{c}] 元画像: {source_image(c).relative_to(ROOT)}\n  {MOTION[c]}")
        return

    cl = client()
    ok = sum(generate(cl, c, args) for c in cuts)
    print(f"\n完了: {ok}/{len(cuts)} カット")


if __name__ == "__main__":
    main()
