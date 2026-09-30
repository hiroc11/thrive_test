import re
import shutil
import subprocess
import wave
from functools import lru_cache


@lru_cache(maxsize=None)
def ffmpeg_exe():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
    except ImportError:
        raise SystemExit("ffmpeg が見つかりません。`pip install imageio-ffmpeg` を実行してください。")
    return imageio_ffmpeg.get_ffmpeg_exe()


def run(args):
    cmd = [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *map(str, args)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{' '.join(cmd)}\n{result.stderr[-3000:]}")


def wav_duration(path):
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def to_wav(src, dst, pad_sec=0.0):
    """任意の音声を 44.1kHz mono WAV に変換し、末尾に無音を足す。"""
    run(["-i", src, "-af", f"apad=pad_dur={pad_sec}", "-ar", 44100, "-ac", 1, "-c:a", "pcm_s16le", dst])


def silence(dst, duration):
    run(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", f"{duration:.3f}", "-c:a", "pcm_s16le", dst])


def concat_wavs(srcs, dst):
    list_file = dst.with_suffix(".txt")
    list_file.write_text("".join(f"file '{p.resolve()}'\n" for p in srcs), encoding="utf-8")
    run(["-f", "concat", "-safe", 0, "-i", list_file, "-c", "copy", dst])
    list_file.unlink()


def concat_videos(srcs, dst):
    """同じエンコード設定のクリップを再エンコードなしで連結する。"""
    list_file = dst.with_suffix(".txt")
    list_file.write_text("".join(f"file '{p.resolve()}'\n" for p in srcs), encoding="utf-8")
    run(["-f", "concat", "-safe", 0, "-i", list_file, "-c", "copy", "-movflags", "+faststart", dst])
    list_file.unlink()


def media_duration(path):
    """ffprobe 無しで動画・音声の尺（秒）を得る。"""
    result = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", result.stderr)
    if not m:
        raise RuntimeError(f"尺を取得できません: {path}")
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)
