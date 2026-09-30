"""台本 (script.json) の読み込み・検証・字幕分割。フォーマットは docs/script-format.md を参照。"""
import json
import re
from pathlib import Path

FORMATS = {
    "news_top5": {
        "name": "今週のAIニュースTOP5",
        "chapters": ["オープニング", "第5位", "第4位", "第3位", "第2位", "第1位", "私の見解", "まとめ"],
        "needs_sources": True,
    },
    "case_study": {
        "name": "企業のAI活用事例 深掘り",
        "chapters": ["オープニング", "背景", "何をしたか", "結果と数字", "なぜ成功/失敗したか", "私の見解", "まとめ"],
        "needs_sources": True,
    },
    "tool_compare": {
        "name": "AIツール本気比較",
        "chapters": ["オープニング", "比較の条件", "ツールA", "ツールB", "ツールC", "結果比較", "私の見解", "まとめ"],
        "needs_sources": False,
    },
    "experiment": {
        "name": "AIで○○は稼げるのか検証",
        "chapters": ["オープニング", "検証のルール", "やったこと", "結果（数字）", "わかったこと", "私の見解", "まとめ"],
        "needs_sources": False,
    },
}

VISUAL_TYPES = {"title", "text", "chart", "image", "file"}
CHART_KINDS = {"bar", "barh", "line"}
LONG_MIN_SEC = 8 * 60  # 8分以上でミッドロール広告を入れられる
SHORT_MAX_SEC = 60


def load_script(path):
    path = Path(path)
    with open(path, encoding="utf-8") as f:
        script = json.load(f)
    script["_path"] = path
    script.setdefault("slug", path.parent.name)
    return script


def estimate_seconds(text, cfg):
    return len(text) / cfg["chars_per_sec"] + cfg["segment_pad_sec"]


def validate(script, cfg, draft=False):
    """(errors, warnings) を返す。errors が1つでもあれば build しない。"""
    errors, warnings = [], []

    for key in ("title", "format", "segments", "thumbnail"):
        if key not in script:
            errors.append(f"必須項目 '{key}' がありません")
    if errors:
        return errors, warnings

    fmt = FORMATS.get(script["format"])
    if not fmt:
        errors.append(f"format は {list(FORMATS)} のいずれか: '{script['format']}'")

    if not draft and script.get("review_status") != "approved":
        errors.append('review_status が "approved" ではありません（人の確認が済んでいない台本）。'
                      "試し書き出しなら --draft を付けてください")

    segments = script["segments"]
    if not segments:
        errors.append("segments が空です")
    ids = [s.get("id") for s in segments]
    if len(set(ids)) != len(ids) or None in ids:
        errors.append("segments の id が未設定または重複しています")

    for seg in segments:
        sid = seg.get("id", "?")
        if not seg.get("narration", "").strip():
            errors.append(f"[{sid}] narration が空です")
        if "TODO" in seg.get("narration", "") and not draft:
            errors.append(f"[{sid}] narration に TODO が残っています")
        errors += [f"[{sid}] {e}" for e in _validate_visual(seg.get("visual", {}), script)]

    if not any(s.get("opinion") for s in segments):
        (warnings if draft else errors).append(
            '"opinion": true の区間（自分の見解）がありません。量産コンテンツ判定を避けるため必須です')

    sources = script.get("sources", [])
    if fmt and fmt["needs_sources"] and not sources:
        (warnings if draft else errors).append("このフォーマットは sources（出典）が必須です")
    for src in sources:
        if not src.get("url"):
            errors.append(f"出典に url がありません: {src}")

    total = sum(estimate_seconds(s.get("narration", ""), cfg) for s in segments)
    if total < LONG_MIN_SEC:
        warnings.append(f"推定尺 {total / 60:.1f} 分。8分未満だとミッドロール広告を入れられません")

    chapters = chapter_list(script, [estimate_seconds(s.get("narration", ""), cfg) for s in segments])
    if len(chapters) < 3:
        warnings.append("チャプターが3つ未満のため YouTube のチャプター表示が有効になりません")
    elif any(dur < 10 for _, _, dur in chapters):
        warnings.append("10秒未満のチャプターがあると YouTube のチャプター表示が無効になります")

    by_id = {s.get("id"): s for s in segments}
    for i, short in enumerate(script.get("shorts", []), 1):
        missing = [sid for sid in short.get("segments", []) if sid not in by_id]
        if missing or not short.get("segments"):
            errors.append(f"shorts[{i}] の segments が不正です: {missing or '空'}")
            continue
        sec = sum(estimate_seconds(by_id[sid]["narration"], cfg) for sid in short["segments"])
        if sec > SHORT_MAX_SEC:
            warnings.append(f"shorts[{i}] の推定尺が {sec:.0f} 秒です（60秒以内推奨）")

    thumb = script["thumbnail"]
    if not thumb.get("text"):
        errors.append("thumbnail.text がありません")
    elif len(thumb["text"]) > 14:
        warnings.append("thumbnail.text は14文字以内がおすすめです（スマホで読めるサイズ）")

    return errors, warnings


def _validate_visual(visual, script):
    errs = []
    vtype = visual.get("type")
    if vtype not in VISUAL_TYPES:
        return [f"visual.type は {sorted(VISUAL_TYPES)} のいずれか: '{vtype}'"]
    if vtype == "image" and not visual.get("prompt"):
        errs.append("image には prompt が必要です")
    if vtype == "file":
        if not visual.get("path"):
            errs.append("file には path が必要です")
        elif not (script["_path"].parent / visual["path"]).exists():
            errs.append(f"file が見つかりません: {visual['path']}")
    if vtype == "text" and not (visual.get("heading") or visual.get("bullets")):
        errs.append("text には heading か bullets が必要です")
    if vtype == "title" and not visual.get("text"):
        errs.append("title には text が必要です")
    if vtype == "chart":
        chart = visual.get("chart", {})
        if chart.get("kind", "bar") not in CHART_KINDS:
            errs.append(f"chart.kind は {sorted(CHART_KINDS)} のいずれか")
        labels, values = chart.get("labels", []), chart.get("values", [])
        if not labels or len(labels) != len(values):
            errs.append("chart.labels と chart.values は同じ長さで必要です")
        if not chart.get("source"):
            errs.append("chart.source（数字の出典）が必要です")
    return errs


def split_subtitles(text, max_chars=28):
    """ナレーションを字幕1枚分ずつに分ける。句点で区切り、長ければ読点で折る。"""
    sentences = re.findall(r"[^。！？!?]+[。！？!?」』）]*", text.strip())
    chunks = []
    for sentence in sentences:
        s = sentence.strip()
        while len(s) > max_chars:
            cut = s.rfind("、", 0, max_chars)
            if cut < max_chars // 3:
                cut = max_chars - 1
            chunks.append(s[: cut + 1])
            s = s[cut + 1:].strip()
        if s:
            chunks.append(s)
    return [c.rstrip("。、") or c for c in chunks]


def subtitle_timings(chunks, duration):
    """文字数比で表示時間を割り振る。[(text, start, end), ...]"""
    total = sum(len(c) for c in chunks) or 1
    t, out = 0.0, []
    for c in chunks:
        d = duration * len(c) / total
        out.append((c, t, t + d))
        t += d
    return out


def chapter_list(script, durations):
    """連続する同名チャプターをまとめ、[(title, start_sec, dur_sec), ...] を返す。"""
    chapters, t = [], 0.0
    for seg, dur in zip(script["segments"], durations):
        name = seg.get("chapter")
        if name and (not chapters or chapters[-1][0] != name):
            chapters.append([name, t, 0.0])
        if chapters:
            chapters[-1][2] += dur
        t += dur
    return [tuple(c) for c in chapters]


def template(fmt_key, title):
    fmt = FORMATS[fmt_key]
    segments = []
    for i, ch in enumerate(fmt["chapters"], 1):
        seg = {
            "id": f"s{i}",
            "chapter": ch,
            "narration": f"TODO: {ch}のナレーション",
            "visual": {"type": "image", "prompt": f"TODO: {ch}の画像プロンプト（英語）"},
        }
        if i == 1:
            seg["visual"] = {"type": "title", "text": title, "sub": fmt["name"]}
        if ch == "私の見解":
            seg["opinion"] = True
            seg["visual"] = {"type": "text", "heading": "私の見解", "bullets": ["TODO"]}
        segments.append(seg)
    return {
        "title": title,
        "format": fmt_key,
        "review_status": "draft",
        "description": "TODO: 概要欄の導入文（2〜3行）",
        "tags": [],
        "sources": [],
        "thumbnail": {"text": "TODO", "sub": "", "image_prompt": "TODO"},
        "segments": segments,
        "shorts": [{"title": "TODO", "hook": "TODO", "segments": ["s2"], "hashtags": ["#AI", "#Shorts"]}],
    }
