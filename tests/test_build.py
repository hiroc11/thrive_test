"""仮素材（dummy）で実際に動画を書き出す結合テスト。ffmpeg が必要。"""
import json
import tempfile
import unittest
from pathlib import Path

from autovideo import ffmpeg
from autovideo.config import load_config
from autovideo.pipeline import build
from autovideo.script import load_script

SCRIPT = {
    "title": "テスト動画",
    "format": "tool_compare",
    "review_status": "approved",
    "thumbnail": {"text": "テスト", "sub": "サブ", "image_prompt": "test image"},
    "segments": [
        {"id": "a", "chapter": "はじめに", "narration": "これはテストです。字幕が出ます。",
         "visual": {"type": "title", "text": "テスト"}},
        {"id": "b", "chapter": "見解", "opinion": True, "narration": "図表も描けます。",
         "visual": {"type": "chart", "chart": {"labels": ["A", "B"], "values": [1, 2], "source": "テスト"}}},
    ],
    "shorts": [{"title": "ショート", "hook": "フック", "segments": ["b"]}],
}


class BuildTest(unittest.TestCase):
    def test_build_with_dummy_providers(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            path = tmp / "ep" / "script.json"
            path.parent.mkdir()
            path.write_text(json.dumps(SCRIPT, ensure_ascii=False), encoding="utf-8")
            out_dir, manifest = build(load_script(path), load_config(), out_root=tmp / "out",
                                      tts_choice="dummy", image_choice="dummy", log=lambda *_: None)

            self.assertTrue((out_dir / "long.mp4").stat().st_size > 0)
            self.assertTrue((out_dir / "shorts" / "short_1.mp4").exists())
            self.assertEqual(len(manifest["thumbs"]), 3)
            desc = (out_dir / "description.txt").read_text(encoding="utf-8")
            self.assertIn("0:00 はじめに", desc)

            # 書き出した動画の尺が区間音声の合計と一致する
            wavs = sorted((out_dir / "cache" / "audio").glob("*.wav"))
            expected = sum(ffmpeg.wav_duration(w) for w in wavs)
            self.assertAlmostEqual(ffmpeg.media_duration(out_dir / "long.mp4"), expected, delta=0.2)


if __name__ == "__main__":
    unittest.main()
