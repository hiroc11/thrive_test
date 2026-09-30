"""script.json → output/<slug>/ に長尺・ショート・サムネ・概要欄を書き出す。"""
import json
from pathlib import Path

from . import ffmpeg, render, textdraw
from .script import chapter_list, split_subtitles, subtitle_timings, validate
from .thumbnail import make_thumbnails
from .tts import get_tts
from .util import digest, fmt_timestamp
from .visuals import get_image_provider, render_visual


def build(script, cfg, out_root="output", draft=False, only=("long", "shorts", "thumbs"),
          tts_choice=None, image_choice=None, log=print):
    errors, warnings = validate(script, cfg, draft=draft)
    for w in warnings:
        log(f"⚠ {w}")
    if errors:
        raise SystemExit("台本にエラーがあります:\n" + "\n".join(f"  ✗ {e}" for e in errors))

    textdraw.set_font_candidates(cfg["fonts"])
    out_dir = Path(out_root) / script["slug"]
    cache = out_dir / "cache"
    for d in ("audio", "visuals", "clips"):
        (cache / d).mkdir(parents=True, exist_ok=True)
    script_dir = script["_path"].parent

    tts = get_tts(tts_choice, cfg)
    images = get_image_provider(image_choice, cfg)
    log(f"音声: {tts.name} / 画像: {images.name}" + ("（仮素材）" if "dummy" in (tts.name, images.name) else ""))

    # 1. 区間ごとの音声・背景・字幕タイミング
    assets = {}
    for seg in script["segments"]:
        wav = cache / "audio" / f"{seg['id']}-{digest(seg['narration'], tts.cache_key(), cfg['segment_pad_sec'])}.wav"
        if not wav.exists():
            log(f"  音声生成 {seg['id']}")
            tts.synth(seg["narration"], wav)
        duration = ffmpeg.wav_duration(wav)
        png = render_visual(seg["visual"], cfg, images, cache / "visuals", script_dir)
        chunks = split_subtitles(seg["narration"], cfg["subtitle_max_chars"])
        assets[seg["id"]] = {
            "wav": wav, "png": png, "duration": duration, "vtype": seg["visual"]["type"],
            "timings": subtitle_timings(chunks, duration - cfg["segment_pad_sec"]),
        }

    suffix = "_DRAFT" if draft else ""
    manifest = {"slug": script["slug"], "draft": draft, "tts": tts.name, "images": images.name}

    # 2. 長尺
    if "long" in only:
        clips = [_clip(assets[s["id"]], cache, cfg, "long") for s in script["segments"]]
        log(f"  長尺を連結（{len(clips)} 区間）")
        tmp = out_dir / "long_nobgm.mp4"
        ffmpeg.concat_videos(clips, tmp)
        long_path = out_dir / f"long{suffix}.mp4"
        render.mix_bgm(tmp, long_path, cfg)
        durations = [assets[s["id"]]["duration"] for s in script["segments"]]
        (out_dir / "description.txt").write_text(description(script, durations, cfg), encoding="utf-8")
        manifest["long"] = {"path": long_path.name, "seconds": round(sum(durations), 1)}

    # 3. ショート
    if "shorts" in only and script.get("shorts"):
        shorts_dir = out_dir / "shorts"
        shorts_dir.mkdir(exist_ok=True)
        manifest["shorts"] = []
        for i, short in enumerate(script["shorts"], 1):
            meta = {"title": short["title"], "hook": short.get("hook", "")}
            clips = [_clip(assets[sid], cache, cfg, "short", meta) for sid in short["segments"]]
            path = shorts_dir / f"short_{i}{suffix}.mp4"
            ffmpeg.concat_videos(clips, path)
            caption = f"{short['title']}\n\n{cfg['disclosure']}\n\n{' '.join(short.get('hashtags', []))}\n"
            (shorts_dir / f"short_{i}.txt").write_text(caption, encoding="utf-8")
            seconds = sum(assets[sid]["duration"] for sid in short["segments"])
            manifest["shorts"].append({"path": f"shorts/{path.name}", "seconds": round(seconds, 1)})
            log(f"  ショート {i}: {seconds:.0f}秒")

    # 4. サムネ
    if "thumbs" in only:
        thumb = script["thumbnail"]
        base = render_visual({"type": "image", "prompt": thumb.get("image_prompt") or script["title"]},
                             cfg, images, cache / "visuals", script_dir)
        thumbs_dir = out_dir / "thumbs"
        thumbs_dir.mkdir(exist_ok=True)
        manifest["thumbs"] = [f"thumbs/{p.name}" for p in make_thumbnails(thumb, base, cfg, thumbs_dir)]

    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"完了: {out_dir}")
    return out_dir, manifest


def _clip(asset, cache, cfg, layout, short_meta=None):
    key = digest(str(asset["wav"]), str(asset["png"]), asset["timings"], cfg["fps"], layout, short_meta, 3)
    out = cache / "clips" / f"{layout}-{key}.mp4"
    if not out.exists():
        render.render_clip(out, asset["png"], asset["vtype"], asset["timings"], asset["wav"],
                           asset["duration"], cfg, layout, short_meta)
    return out


def description(script, durations, cfg):
    lines = [script["title"], "", script.get("description", "").strip(), ""]
    chapters = chapter_list(script, durations)
    if chapters:
        lines.append("■ チャプター")
        lines += [f"{fmt_timestamp(start)} {name}" for name, start, _ in chapters]
        lines.append("")
    if script.get("sources"):
        lines.append("■ 出典・参考")
        lines += [f"・{s.get('title', s['url'])} {s['url']}" for s in script["sources"]]
        lines.append("")
    lines.append(cfg["disclosure"])
    if script.get("tags"):
        lines += ["", " ".join(f"#{t.lstrip('#')}" for t in script["tags"][:5])]
    return "\n".join(lines).strip() + "\n"
