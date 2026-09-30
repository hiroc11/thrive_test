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
