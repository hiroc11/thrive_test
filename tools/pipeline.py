"""絵コンテJSONから、声・原画・アニメ化・口パク合成を順に実行する。

担当:
  声        にじボイス API（NIJIVOICE_API_KEY）
  原画      fal.ai の画像モデル（FAL_KEY）
  アニメ化  fal.ai の動画モデル（Kling など）
  口パク    fal.ai の Kling LipSync

使い方（すべて --dry-run を付けると、APIを呼ばずに内容と料金の目安だけ表示）:
  python3 tools/pipeline.py check                       # キーと接続の確認
  python3 tools/pipeline.py actors                      # にじボイスの声優一覧
  python3 tools/pipeline.py voices  [カット...]         # セリフの音声を作る
  python3 tools/pipeline.py images  C11                 # 原画を作る（既存の静止画は上書きしない）
  python3 tools/pipeline.py videos  [カット...]         # 静止画をアニメ化する（省略時は animate:true のカット）
  python3 tools/pipeline.py lipsync [カット...]         # 口パク合成（省略時は lipsync:true のカット）

オプション: --board storyboards/ep01_b1.json（既定）
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NIJI_BASE = "https://api.nijivoice.com/api/platform/v1"

# 料金の目安（USD）。公開情報からの概算なので、必ず公式ページで確認すること。
COST = {"image": 0.04, "video_per_sec": 0.07, "video_min_sec": 5, "lipsync_per_sec": 0.014,
        "voice_per_char_jpy": 825 / 10000}
JPY = 150


# ---------- 共通 ----------

def load_board(path):
    board = json.loads(Path(path).read_text(encoding="utf-8"))
    board["_out"] = ROOT / board["out_dir"]
    board["_voices"] = ROOT / "assets" / "voices" / board["out_dir"].split("/")[-1]
    return board


def pick(board, ids, key):
    cuts = [c for c in board["cuts"] if (c["id"] in ids if ids else c.get(key))]
    missing = set(ids) - {c["id"] for c in cuts}
    if missing:
        sys.exit(f"絵コンテにないカット: {sorted(missing)}")
    return cuts


def need(var):
    if not os.environ.get(var):
        sys.exit(f"{var} が設定されていません。環境の設定（Network secrets または環境変数）で登録してください。")


def next_take(path):
    """既存のファイルを消さないよう、空いている名前を返す（C04.mp4 → C04_take2.mp4 …）。"""
    if not path.exists():
        return path
    n = 2
    while path.with_name(f"{path.stem}_take{n}{path.suffix}").exists():
        n += 1
    return path.with_name(f"{path.stem}_take{n}{path.suffix}")


def download(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=300) as r, open(dest, "wb") as f:
        f.write(r.read())
    print(f"  保存 → {dest.relative_to(ROOT)}")
    return dest


def seconds(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                          str(path)], capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def still_of(board, cut_id):
    for ext in (".jpg", ".jpeg", ".png"):
        p = board["_out"] / f"{cut_id}{ext}"
        if p.exists():
            return p
    return None


def fal_run(model, arguments):
    import fal_client

    def log(update):
        if getattr(update, "logs", None):
            for entry in update.logs:
                print("   ", entry.get("message", ""))
    return fal_client.subscribe(model, arguments=arguments, with_logs=True, on_queue_update=log)


def fal_upload(path):
    import fal_client
    return fal_client.upload_file(path)


def money(usd):
    return f"約${usd:.2f}（約{usd * JPY:,.0f}円）"


# ---------- にじボイス ----------

def niji(method, path, body=None):
    need("NIJIVOICE_API_KEY")
    req = urllib.request.Request(
        NIJI_BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"x-api-key": os.environ["NIJIVOICE_API_KEY"], "accept": "application/json",
                 "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def cmd_actors(board, args):
    if args.dry_run:
        print(f"GET {NIJI_BASE}/voice-actors")
        return
    data = niji("GET", "/voice-actors")
    for a in data.get("voiceActors", data if isinstance(data, list) else []):
        print(f"{a.get('id')}  {a.get('name')}  {a.get('gender', '')}  {a.get('age', '')}  "
              f"{a.get('smallImageUrl', '') and ''}{a.get('description', '')[:40]}")


def cmd_voices(board, args):
    cuts = pick(board, args.cuts, "lines")
    jobs = [(c, i, ln) for c in cuts for i, ln in enumerate(c.get("lines", []), 1)]
    chars = sum(len(ln["text"]) for _, _, ln in jobs)
    print(f"セリフ {len(jobs)}本 / {chars}文字 / 料金の目安 約{chars * COST['voice_per_char_jpy']:,.0f}円")
    for c, i, ln in jobs:
        actor = board["characters"][ln["speaker"]].get("voice_actor_id")
        print(f"  {c['id']}_{i} [{ln['speaker']}] {ln['text']}" + ("" if actor else "  ※声優が未設定"))
    if args.dry_run:
        return
    for c, i, ln in jobs:
        actor = board["characters"][ln["speaker"]].get("voice_actor_id")
        if not actor:
            sys.exit(f"characters.{ln['speaker']}.voice_actor_id を絵コンテJSONに設定してください（actors で一覧表示）。")
        res = niji("POST", f"/voice-actors/{actor}/generate-voice",
                   {"script": ln["text"], "speed": str(ln.get("speed", 1.0)), "format": "mp3"})
        gv = res.get("generatedVoice", res)
        url = gv.get("audioFileDownloadUrl") or gv.get("audioFileUrl")
        download(url, board["_voices"] / f"{c['id']}_{i}.mp3")
        if "remainingCredits" in gv:
            print(f"  残りクレジット: {gv['remainingCredits']}")


# ---------- fal.ai：原画 ----------

def cmd_images(board, args):
    cuts = [c for c in pick(board, args.cuts, "image_prompt") if c.get("image_prompt")]
    print(f"原画 {len(cuts)}枚 / モデル {board['models']['image']} / 料金の目安 {money(COST['image'] * len(cuts))}")
    for c in cuts:
        refs = [board["characters"][k]["ref"] for k in c["characters"]] + [board["background_ref"]]
        prompt = "; ".join([c["image_prompt"]] + [board["characters"][k]["prompt"] for k in c["characters"]]
                           + [board["style"]])
        print(f"  {c['id']} 参照: {', '.join(refs)}\n    {prompt[:160]}…")
        if args.dry_run:
            continue
        need("FAL_KEY")
        urls = [fal_upload(ROOT / r) for r in dict.fromkeys(refs)]
        res = fal_run(board["models"]["image"], {
            "prompt": f"{prompt}. Avoid: {board['negative']}",
            "image_urls": urls, "num_images": 1, "aspect_ratio": board["aspect_ratio"],
            "output_format": "jpeg"})
        # 既存の静止画は残し、候補として _gen 付きで保存する（採用するときに名前を変える）
        download(res["images"][0]["url"], next_take(board["_out"] / f"{c['id']}_gen.jpg"))


# ---------- fal.ai：アニメ化 ----------

def cmd_videos(board, args):
    cuts = pick(board, args.cuts, "animate")
    total = sum(max(COST["video_min_sec"], 5 if c["duration"] <= 5 else 10) for c in cuts) * COST["video_per_sec"]
    print(f"アニメ化 {len(cuts)}カット / モデル {board['models']['video']} / 料金の目安 {money(total)}")
    for c in cuts:
        src = still_of(board, c["id"])
        print(f"  {c['id']} 元画像: {src.relative_to(ROOT) if src else 'なし'}\n    {c['motion_prompt']}")
        if args.dry_run:
            continue
        if src is None:
            sys.exit(f"{c['id']} の静止画がありません。")
        need("FAL_KEY")
        res = fal_run(board["models"]["video"], {
            "prompt": f"{c['motion_prompt']} {board['style']}. Keep the character design exactly as in the image.",
            "image_url": fal_upload(src),
            "duration": "5" if c["duration"] <= 5 else "10",
            "negative_prompt": board["negative"]})
        download(res["video"]["url"], next_take(board["_out"] / f"{c['id']}.mp4"))


# ---------- fal.ai：口パク合成 ----------

def cmd_lipsync(board, args):
    cuts = pick(board, args.cuts, "lipsync")
    print(f"口パク合成 {len(cuts)}カット / モデル {board['models']['lipsync']} / "
          f"料金の目安 {money(len(cuts) * 5 * COST['lipsync_per_sec'])}")
    for c in cuts:
        video = board["_out"] / f"{c['id']}.mp4"
        voice = board["_voices"] / f"{c['id']}_1.mp3"
        print(f"  {c['id']} 動画: {video.relative_to(ROOT)} / 声: {voice.relative_to(ROOT)}")
        if args.dry_run:
            continue
        for p in (video, voice):
            if not p.exists():
                sys.exit(f"{p.relative_to(ROOT)} がありません（先に videos / voices を実行）。")
        need("FAL_KEY")
        audio = voice
        if seconds(voice) < 2.0:  # LipSync は音声2秒以上が必要なので、無音を足して伸ばす
            audio = voice.with_name(f"{voice.stem}_2s.mp3")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(voice), "-af", "apad=whole_dur=2.2",
                            str(audio)], check=True)
        res = fal_run(board["models"]["lipsync"], {"video_url": fal_upload(video), "audio_url": fal_upload(audio)})
        keep = next_take(video.with_name(f"{c['id']}_nolip.mp4"))
        video.rename(keep)  # 口パク前のクリップは残す
        print(f"  元のクリップ → {keep.relative_to(ROOT)}")
        download(res["video"]["url"], video)


# ---------- 接続確認 ----------

def cmd_check(board, args):
    for var in ("FAL_KEY", "NIJIVOICE_API_KEY"):
        print(f"{var}: {'設定済み' if os.environ.get(var) else '未設定'}")
    for host in ("queue.fal.run", "fal.run", "rest.alpha.fal.ai", "v3.fal.media", "api.nijivoice.com"):
        try:
            urllib.request.urlopen(f"https://{host}/", timeout=10)
            ok = "接続OK"
        except urllib.error.HTTPError:
            ok = "接続OK"  # 応答があれば到達はできている
        except Exception as e:  # noqa: BLE001
            ok = f"接続できない（{type(e).__name__}）"
        print(f"{host}: {ok}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["check", "actors", "voices", "images", "videos", "lipsync"])
    ap.add_argument("cuts", nargs="*")
    ap.add_argument("--board", default="storyboards/ep01_b1.json")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    board = load_board(ROOT / args.board)
    {"check": cmd_check, "actors": cmd_actors, "voices": cmd_voices, "images": cmd_images,
     "videos": cmd_videos, "lipsync": cmd_lipsync}[args.command](board, args)


if __name__ == "__main__":
    main()
