import argparse
import json
from datetime import date
from pathlib import Path

from .config import load_config
from .script import FORMATS, load_script, template, validate


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m autovideo", description="AI動画の自動生成パイプライン")
    parser.add_argument("--config", help="設定ファイル（既定: config.json）")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_new = sub.add_parser("new", help="台本テンプレートを作る")
    p_new.add_argument("slug", help="例: ai-news-1005")
    p_new.add_argument("--format", choices=list(FORMATS), default="news_top5")
    p_new.add_argument("--title", default="TODO: タイトル")

    p_val = sub.add_parser("validate", help="台本をチェックする")
    p_val.add_argument("script")
    p_val.add_argument("--draft", action="store_true", help="下書きとしてチェック（承認・TODOを問わない）")

    p_build = sub.add_parser("build", help="動画を書き出す")
    p_build.add_argument("script")
    p_build.add_argument("--draft", action="store_true", help="未承認の台本でも書き出す（ファイル名に _DRAFT）")
    p_build.add_argument("--only", default="long,shorts,thumbs", help="long,shorts,thumbs の一部を指定")
    p_build.add_argument("--tts", choices=["auto", "dummy", "elevenlabs"])
    p_build.add_argument("--images", choices=["auto", "dummy", "fal"])
    p_build.add_argument("--out", default="output")

    p_snew = sub.add_parser("skit-new", help="ショートスキットのひな形を作る")
    p_snew.add_argument("slug")
    p_snew.add_argument("--series", choices=["otoyaku", "anime_vs_live"], required=True)
    p_snew.add_argument("--chars", default="", help="登場キャラ id をカンマ区切りで")

    p_sval = sub.add_parser("skit-validate", help="スキットをチェックする")
    p_sval.add_argument("skit")
    p_sval.add_argument("--draft", action="store_true")

    p_sbuild = sub.add_parser("skit-build", help="スキットを縦型ショートに書き出す")
    p_sbuild.add_argument("skit")
    p_sbuild.add_argument("--draft", action="store_true")
    p_sbuild.add_argument("--tts", choices=["auto", "dummy", "elevenlabs"])
    p_sbuild.add_argument("--images", choices=["auto", "dummy", "fal"])
    p_sbuild.add_argument("--video", choices=["auto", "dummy", "fal"])
    p_sbuild.add_argument("--out", default="output")

    p_cnew = sub.add_parser("character-new", help="オリジナルキャラの設定ファイルを作る")
    p_cnew.add_argument("id", help="英小文字の id（例: hana）")
    p_cnew.add_argument("--name", required=True, help="表示名（例: ハナ）")

    p_cref = sub.add_parser("character-refs", help="キャラの参照画像（アニメ版・実写版）を作る")
    p_cref.add_argument("id")
    p_cref.add_argument("--images", choices=["auto", "dummy", "fal"])
    p_cref.add_argument("--force", action="store_true", help="既存の参照画像を作り直す")

    args = parser.parse_args(argv)
    cfg = load_config(args.config)

    if args.cmd == "new":
        path = Path("content") / f"{date.today():%Y-%m-%d}-{args.slug}" / "script.json"
        if path.exists():
            raise SystemExit(f"既にあります: {path}")
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(template(args.format, args.title), ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        print(path)

    elif args.cmd == "validate":
        errors, warnings = validate(load_script(args.script), cfg, draft=args.draft)
        for w in warnings:
            print(f"⚠ {w}")
        for e in errors:
            print(f"✗ {e}")
        if errors:
            raise SystemExit(1)
        print("OK")

    elif args.cmd == "build":
        from .pipeline import build

        build(load_script(args.script), cfg, out_root=args.out, draft=args.draft,
              only=tuple(args.only.split(",")), tts_choice=args.tts, image_choice=args.images)

    elif args.cmd == "skit-new":
        from .skit import skit_template

        chars = [c for c in args.chars.split(",") if c]
        path = Path("skits") / f"{date.today():%Y-%m-%d}-{args.slug}" / "skit.json"
        _write_new(path, skit_template(args.series, chars))

    elif args.cmd == "skit-validate":
        from .skit import load_skit, validate_skit

        _report(*validate_skit(load_skit(args.skit), cfg, draft=args.draft))

    elif args.cmd == "skit-build":
        from .skit import build_skit, load_skit

        build_skit(load_skit(args.skit), cfg, out_root=args.out, draft=args.draft, tts_choice=args.tts,
                   image_choice=args.images, video_choice=args.video)

    elif args.cmd == "character-new":
        from .skit import character_template, characters_dir

        _write_new(characters_dir() / args.id / "character.json", character_template(args.id, args.name))

    elif args.cmd == "character-refs":
        from .skit import make_character_refs

        make_character_refs(args.id, cfg, image_choice=args.images, force=args.force)


def _write_new(path, data):
    if path.exists():
        raise SystemExit(f"既にあります: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(path)


def _report(errors, warnings):
    for w in warnings:
        print(f"⚠ {w}")
    for e in errors:
        print(f"✗ {e}")
    if errors:
        raise SystemExit(1)
    print("OK")
