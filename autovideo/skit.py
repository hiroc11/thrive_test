"""縦型ショートスキット（お約束の実写化 / オリジナルキャラのアニメ⇄実写）。

skits/<日付>-<slug>/skit.json → output/skits/<slug>/short.mp4。形式は docs/skit-format.md を参照。
"""
import json
import math
import os
from pathlib import Path

from PIL import Image, ImageDraw

from . import ffmpeg, textdraw
from .config import ROOT
from .tts import get_tts
from .util import digest, file_digest
from .video import get_video_provider
from .visuals import cover, get_image_provider

SERIES = {
    "otoyaku": "アニメのお約束を実写でやってみた",
    "anime_vs_live": "オリジナルキャラ アニメ⇄実写",
}
STYLES = {"anime", "live", "split"}
SHOTS = {"still", "video"}
NARRATOR = "narrator"
SIZE = (1080, 1920)
HALF = (1080, 960)
SHORTS_HARD_MAX_SEC = 180
STYLE_LABEL = {"anime": "アニメ", "live": "実写"}


# ---------- 読み込み ----------

def characters_dir():
    return ROOT / "characters"


def load_character(cid):
    path = characters_dir() / cid / "character.json"
    with open(path, encoding="utf-8") as f:
        char = json.load(f)
    char["id"] = cid
    char["_dir"] = path.parent
    return char


def character_ref(char, style):
    ref = char["_dir"] / f"ref_{style}.png"
    return ref if ref.exists() else None


def load_skit(path):
    path = Path(path)
    with open(path, encoding="utf-8") as f:
        skit = json.load(f)
    skit["_path"] = path
    skit.setdefault("slug", path.parent.name)
    return skit


def has_live_footage(skit):
    return any(cut.get("style") in ("live", "split") for cut in skit.get("cuts", []))


# ---------- 検証 ----------

def estimate_cut_seconds(cut, cfg):
    talk = sum(len(line.get("text", "")) / cfg["chars_per_sec"] + cfg["skit"]["line_pad_sec"]
               for line in cut.get("lines", []))
    return max(talk, cut.get("min_sec", 2.0))


def validate_skit(skit, cfg, draft=False):
    errors, warnings = [], []
    for key in ("series", "title", "hook", "cuts"):
        if not skit.get(key):
            errors.append(f"必須項目 '{key}' がありません")
    if errors:
        return errors, warnings

    if skit["series"] not in SERIES:
        errors.append(f"series は {list(SERIES)} のいずれか: '{skit['series']}'")
    if not draft and skit.get("review_status") != "approved":
        errors.append('review_status が "approved" ではありません。試し書き出しなら --draft を付けてください')
    if skit["series"] == "otoyaku" and not skit.get("trope"):
        errors.append("otoyaku シリーズは trope（どのお約束か）が必要です")

    chars = {}
    for cid in skit.get("characters", []):
        try:
            char = load_character(cid)
        except FileNotFoundError:
            errors.append(f"キャラクターが見つかりません: characters/{cid}/character.json")
            continue
        for key in ("name", "anime_prompt", "live_prompt"):
            if not char.get(key) or "TODO" in char[key]:
                (warnings if draft else errors).append(f"キャラ {cid} の {key} が未記入です")
        chars[cid] = char
    if skit["series"] == "anime_vs_live" and not chars:
        errors.append("anime_vs_live シリーズはオリジナルキャラ（characters）が必要です")

    ids = [c.get("id") for c in skit["cuts"]]
    if None in ids or len(set(ids)) != len(ids):
        errors.append("cuts の id が未設定または重複しています")
    for cut in skit["cuts"]:
        cid = cut.get("id", "?")
        if cut.get("style") not in STYLES:
            errors.append(f"[{cid}] style は {sorted(STYLES)} のいずれか")
        if cut.get("shot", "still") not in SHOTS:
            errors.append(f"[{cid}] shot は {sorted(SHOTS)} のいずれか")
        if cut.get("style") == "split" and cut.get("shot", "still") != "still":
            errors.append(f"[{cid}] split は shot: still のみ対応です")
        if not cut.get("scene"):
            errors.append(f"[{cid}] scene（場面の英語プロンプト）がありません")
        for who in cut.get("characters", []):
            if who not in skit.get("characters", []):
                errors.append(f"[{cid}] characters の '{who}' が skit.characters にありません")
        for line in cut.get("lines", []):
            if line.get("who") != NARRATOR and line.get("who") not in skit.get("characters", []):
                errors.append(f"[{cid}] セリフの who '{line.get('who')}' はキャラ id か narrator にしてください")
            if not line.get("text", "").strip():
                errors.append(f"[{cid}] 空のセリフがあります")
            elif "TODO" in line["text"] and not draft:
                errors.append(f"[{cid}] セリフに TODO が残っています")

    if skit["series"] == "anime_vs_live":
        styles = {c.get("style") for c in skit["cuts"]}
        if "split" not in styles and not {"anime", "live"} <= styles:
            errors.append("anime_vs_live はアニメと実写の両方のカット（または split）が必要です")

    banned = [t for t in cfg["skit"].get("banned_terms", []) if t]
    texts = _all_texts(skit) + [c.get(k, "") for c in chars.values() for k in ("name", "anime_prompt", "live_prompt")]
    for term in banned:
        if any(term.lower() in t.lower() for t in texts):
            errors.append(f"禁止ワード（既存作品・実在人物など）が含まれています: {term}")

    total = sum(estimate_cut_seconds(c, cfg) for c in skit["cuts"])
    if total > SHORTS_HARD_MAX_SEC:
        errors.append(f"推定尺 {total:.0f} 秒。ショートの上限（3分）を超えています")
    elif total > cfg["skit"]["max_sec"]:
        warnings.append(f"推定尺 {total:.0f} 秒（{cfg['skit']['max_sec']} 秒以内推奨）")
    if not skit.get("hashtags"):
        warnings.append("hashtags がありません")
    return errors, warnings


def _all_texts(skit):
    out = [skit.get(k, "") for k in ("title", "hook", "trope", "caption")]
    for cut in skit.get("cuts", []):
        out += [cut.get("scene", ""), cut.get("motion", ""), cut.get("telop", "")]
        out += [line.get("text", "") for line in cut.get("lines", [])]
    return out


# ---------- 書き出し ----------

def build_skit(skit, cfg, out_root="output", draft=False, tts_choice=None, image_choice=None,
               video_choice=None, log=print):
    errors, warnings = validate_skit(skit, cfg, draft=draft)
    for w in warnings:
        log(f"⚠ {w}")
    if errors:
        raise SystemExit("スキットにエラーがあります:\n" + "\n".join(f"  ✗ {e}" for e in errors))

    textdraw.set_font_candidates(cfg["fonts"])
    out_dir = Path(out_root) / "skits" / skit["slug"]
    cache = out_dir / "cache"
    for d in ("audio", "images", "videos", "overlays", "clips"):
        (cache / d).mkdir(parents=True, exist_ok=True)

    chars = {cid: load_character(cid) for cid in skit.get("characters", [])}
    tts = get_tts(tts_choice, cfg)
    images = get_image_provider(image_choice, cfg)
    video = get_video_provider(video_choice, cfg)
    log(f"音声: {tts.name} / 画像: {images.name} / 動画: {video.name}")
    for cid, char in chars.items():
        for style in ("anime", "live"):
            if not character_ref(char, style):
                log(f"⚠ {cid} の参照画像 ref_{style}.png がありません（見た目が回ごとにぶれます）。"
                    f"`python -m autovideo character-refs {cid}` で作れます")

    hook_png = _hook_overlay(skit["hook"], cache / "overlays")
    clips = []
    for cut in skit["cuts"]:
        audio, line_times = _cut_audio(cut, chars, tts, cfg, cache / "audio")
        duration = ffmpeg.wav_duration(audio)
        still = _cut_image(cut, chars, images, cfg, cache / "images")
        moving = None
        if cut.get("shot") == "video":
            moving = _cut_video(still, cut, video, cache / "videos")
            if moving is None:
                log(f"  [{cut['id']}] 動画生成なし → 静止画＋ズームで代用")
        clips.append(_render_cut(cut, still, moving, hook_png, line_times, chars, audio, duration, cfg,
                                 cache))
        log(f"  [{cut['id']}] {duration:.1f}秒")

    suffix = "_DRAFT" if draft else ""
    short = out_dir / f"short{suffix}.mp4"
    ffmpeg.concat_videos(clips, short)
    (out_dir / "caption.txt").write_text(caption_text(skit, cfg), encoding="utf-8")
    seconds = ffmpeg.media_duration(short)
    manifest = {"slug": skit["slug"], "series": skit["series"], "draft": draft, "path": short.name,
                "seconds": round(seconds, 1), "altered_content": has_live_footage(skit),
                "tts": tts.name, "images": images.name, "video": video.name}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"完了: {short}（{seconds:.1f}秒）")
    return out_dir, manifest


def caption_text(skit, cfg):
    lines = [skit["title"], ""]
    if skit.get("caption"):
        lines += [skit["caption"].strip(), ""]
    lines += [cfg["skit"]["disclosure"], "", " ".join(skit.get("hashtags", [])), "", "---- 投稿時チェック（投稿文には含めない）----"]
    if has_live_footage(skit):
        lines.append("・YouTube: 「改変または合成されたコンテンツ」を「はい」にする（実写風カットあり）")
    lines.append("・TikTok: 「AI生成コンテンツ」ラベルをオンにする")
    lines.append("・既存作品・実在人物に似ていないか最終確認")
    return "\n".join(lines) + "\n"


def _voice_for(who, chars):
    if who == NARRATOR:
        return None
    char = chars[who]
    return char.get("voice_id") or os.environ.get(char.get("voice_id_env") or "", "") or None


def _cut_audio(cut, chars, tts, cfg, cache):
    """セリフを順に読み上げてつなげる。[(line, start, end)] とカット音声を返す。"""
    wavs, times, t = [], [], 0.0
    for line in cut.get("lines", []):
        voice = _voice_for(line["who"], chars)
        wav = cache / f"line-{digest(line['text'], voice, tts.cache_key())}.wav"
        if not wav.exists():
            tts.synth(line["text"], wav, voice_id=voice)
        d = ffmpeg.wav_duration(wav)
        times.append((line, t, t + d))
        wavs.append(wav)
        t += d
    min_sec = cut.get("min_sec", 2.0)
    out = cache / f"cut-{cut['id']}-{digest([w.name for w in wavs], min_sec)}.wav"
    if not out.exists():
        if wavs:
            joined = cache / f"{out.stem}-joined.wav"
            ffmpeg.concat_wavs(wavs, joined)
            ffmpeg.run(["-i", joined, "-af", f"apad=whole_dur={min_sec}", "-c:a", "pcm_s16le", out])
            joined.unlink()
        else:
            ffmpeg.silence(out, min_sec)
    return out, times


def _style_prompt(cut, chars, style):
    looks = [chars[c][f"{style}_prompt"] for c in cut.get("characters", [])]
    prompt = cut["scene"]
    if looks:
        prompt += ". Characters: " + "; ".join(looks)
    ref = next((character_ref(chars[c], style) for c in cut.get("characters", [])
                if character_ref(chars[c], style)), None)
    return prompt, ref


def _generate(images, prompt, size, ref, style, cfg, cache):
    suffix = cfg["skit"]["style_suffix"][style]
    key = digest(prompt, suffix, size, file_digest(ref) if ref else None, images.cache_key())
    out = cache / f"{style}-{key}.png"
    if not out.exists():
        img = images.generate(prompt, size, ref=ref, suffix=suffix, label=f"{STYLE_LABEL[style]}風（仮）")
        cover(img.convert("RGB"), size).save(out)
    return out


def _cut_image(cut, chars, images, cfg, cache):
    style = cut["style"]
    if style != "split":
        prompt, ref = _style_prompt(cut, chars, style)
        return _generate(images, prompt, SIZE, ref, style, cfg, cache)

    # split: 上にアニメ版、下に実写版
    halves = []
    for s in ("anime", "live"):
        prompt, ref = _style_prompt(cut, chars, s)
        halves.append(_generate(images, prompt, HALF, ref, s, cfg, cache))
    out = cache / f"split-{digest([h.name for h in halves], 2)}.png"
    if not out.exists():
        canvas = Image.new("RGB", SIZE, "#000000")
        draw = ImageDraw.Draw(canvas)
        for i, (half, s) in enumerate(zip(halves, ("anime", "live"))):
            y = i * HALF[1]
            canvas.paste(Image.open(half).convert("RGB"), (0, y))
            label_y = y + 400 if i == 0 else y + 40
            draw.rectangle([0, label_y, 230, label_y + 90], fill=cfg["colors"]["accent"])
            textdraw.draw_lines(draw, [STYLE_LABEL[s]], 56, 115, label_y + 12, "#000000")
        draw.rectangle([0, HALF[1] - 4, SIZE[0], HALF[1] + 4], fill="#ffffff")
        canvas.save(out)
    return out


def _cut_video(still, cut, video, cache):
    out = cache / f"video-{digest(file_digest(still), cut.get('motion') or cut['scene'], video.cache_key())}.mp4"
    if out.exists():
        return out
    return video.generate(still, cut.get("motion") or cut["scene"], out)


def _hook_overlay(hook, cache):
    """画面上部にずっと出すフック文（上を暗くして読みやすく）。"""
    out = cache / f"hook-{digest(hook, 2)}.png"
    if out.exists():
        return out
    w, h = SIZE
    img = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    shade = Image.new("L", SIZE, 0)
    for y in range(420):
        shade.paste(int(170 * (1 - y / 420)), (0, y, w, y + 1))
    img.paste((0, 0, 0, 255), mask=shade)
    draw = ImageDraw.Draw(img)
    size, lines = textdraw.fit_wrap(hook, 80, 52, w - 100, 2)
    textdraw.draw_lines(draw, lines, size, w / 2, 150, "#facc15", stroke=6)
    img.save(out)
    return out


def _telop_png(text, cache):
    out = cache / f"telop-{digest(text, 2)}.png"
    if not out.exists():
        img = Image.new("RGBA", SIZE, (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        size, lines = textdraw.fit_wrap(text, 120, 72, SIZE[0] - 120, 3)
        top = 860 - textdraw.lines_height(len(lines), size) / 2
        textdraw.draw_lines(draw, lines, size, SIZE[0] / 2, top, "#ffffff", stroke=10, stroke_fill="#dc2626")
        img.save(out)
    return out


def _line_png(line, chars, cfg, cache):
    """セリフ字幕。キャラ名の札（キャラ色）＋本文。ナレーションは札なし。"""
    who = line["who"]
    name = None if who == NARRATOR else chars[who]["name"]
    color = None if who == NARRATOR else chars[who].get("color", cfg["colors"]["accent2"])
    out = cache / f"line-{digest(line['text'], name, color, 2)}.png"
    if out.exists():
        return out
    w, _ = SIZE
    img = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    size, lines = textdraw.fit_wrap(line["text"], 68, 48, w - 120, 3)
    bottom = 1700
    top = bottom - textdraw.lines_height(len(lines), size)
    if name:
        tag_w = textdraw.text_width(name, 44) + 48
        draw.rounded_rectangle([60, top - 80, 60 + tag_w, top - 14], radius=16, fill=color)
        textdraw.draw_lines(draw, [name], 44, 84, top - 74, "#ffffff", stroke=3, stroke_fill="#000000",
                            align="left")
    textdraw.draw_lines(draw, lines, size, w / 2, top, "#ffffff", stroke=max(4, size // 9))
    img.save(out)
    return out


def _render_cut(cut, still, moving, hook_png, line_times, chars, audio, duration, cfg, cache):
    fps = cfg["fps"]
    overlays = [(hook_png, None, None)]
    if cut.get("telop"):
        overlays.append((_telop_png(cut["telop"], cache / "overlays"), None, None))
    overlays += [(_line_png(line, chars, cfg, cache / "overlays"), t0, t1) for line, t0, t1 in line_times]

    key = digest(still.name, moving.name if moving else None, [str(o[0].name) for o in overlays],
                 [(round(a or 0, 3), round(b or 0, 3)) for _, a, b in overlays], audio.name, fps, 2)
    out = cache / "clips" / f"{cut['id']}-{key}.mp4"
    if out.exists():
        return out

    frames = math.ceil(duration * fps)
    if moving:
        inputs = ["-i", moving]
        first = (f"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,"
                 f"fps={fps},tpad=stop_mode=clone:stop_duration={duration + 1:.2f}[v0]")
    else:
        zmax = 1.03 if cut["style"] == "split" else 1.10
        rate = (zmax - 1) / max(frames, 1)
        inputs = ["-i", still]
        first = (f"[0:v]scale=2160:3840,zoompan=z='min(1+{rate:.7f}*on,{zmax})'"
                 f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1080x1920:fps={fps}[v0]")
    filters, last = [first], "v0"
    for i, (png, t0, t1) in enumerate(overlays, 1):
        inputs += ["-i", png]
        enable = f":enable='between(t,{t0:.3f},{t1:.3f})'" if t0 is not None else ""
        filters.append(f"[{last}][{i}:v]overlay=0:0{enable}[o{i}]")
        last = f"o{i}"
    filters.append(f"[{last}]format=yuv420p[vout]")
    inputs += ["-i", audio]
    ffmpeg.run([
        *inputs,
        "-filter_complex", ";".join(filters),
        "-map", "[vout]", "-map", f"{len(overlays) + 1}:a",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", 20, "-r", fps,
        "-c:a", "aac", "-b:a", "192k", "-ar", 44100, "-ac", 2,
        "-t", f"{duration:.3f}", out,
    ])
    return out


# ---------- 参照画像・テンプレート ----------

def make_character_refs(cid, cfg, image_choice=None, force=False, log=print):
    """キャラの見た目を固定するための参照画像（アニメ版・実写版）を作る。人が見て採用を決める。"""
    textdraw.set_font_candidates(cfg["fonts"])
    char = load_character(cid)
    images = get_image_provider(image_choice, cfg)
    prompts = {
        "anime": f"character reference, full body, front view, plain light gray background, {char['anime_prompt']}",
        "live": f"full body portrait, front view, plain studio background, {char['live_prompt']}",
    }
    for style, prompt in prompts.items():
        out = char["_dir"] / f"ref_{style}.png"
        if out.exists() and not force:
            log(f"既にあります（作り直すなら --force）: {out}")
            continue
        img = images.generate(prompt, SIZE, suffix=cfg["skit"]["style_suffix"][style],
                              label=f"{char['name']} {STYLE_LABEL[style]}版（仮）")
        cover(img.convert("RGB"), SIZE).save(out)
        log(f"作成: {out}")


def character_template(cid, name):
    return {
        "name": name,
        "profile": "TODO: 年齢・性格・口癖など（台本を書くときの設定）",
        "color": "#ec4899",
        "anime_prompt": "TODO: アニメ版の見た目（英語。髪型・髪色・目・服装・小物を具体的に）",
        "live_prompt": "TODO: 実写版の見た目（英語。anime_prompt と同じ特徴を実写で。実在の人物名は書かない）",
        "voice_id": "",
        "voice_id_env": "",
    }


def skit_template(series, characters):
    first = characters[0] if characters else NARRATOR
    skit = {
        "series": series,
        "title": "TODO: 投稿タイトル",
        "hook": "TODO: 最初の2秒で目を止める一言",
        "review_status": "draft",
        "characters": characters,
        "cuts": [
            {"id": "c1", "style": "live", "shot": "video", "scene": "TODO: 場面（英語）",
             "characters": characters[:1], "motion": "TODO: 動き（英語）",
             "lines": [{"who": first, "text": "TODO: セリフ"}]},
            {"id": "c2", "style": "live", "shot": "still", "scene": "TODO: オチの場面（英語）",
             "characters": characters[:1], "telop": "TODO: オチのテロップ",
             "lines": [{"who": first, "text": "TODO: セリフ"}]},
        ],
        "caption": "TODO: 投稿文（1〜2行）",
        "hashtags": ["#Shorts", "#AIアニメ"],
    }
    if series == "otoyaku":
        skit["trope"] = "TODO: どのお約束か（例: 食パンをくわえて遅刻ダッシュ）"
    else:
        skit["cuts"].insert(0, {"id": "c0", "style": "split", "shot": "still",
                                "scene": "TODO: 比較する場面（英語）", "characters": characters[:1],
                                "telop": "アニメ → 実写", "min_sec": 3.0, "lines": []})
    return skit
