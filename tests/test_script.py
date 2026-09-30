import copy
import json
import tempfile
import unittest
from pathlib import Path

from autovideo.config import load_config
from autovideo.script import (chapter_list, load_script, split_subtitles, subtitle_timings, template,
                              validate)
from autovideo.util import fmt_timestamp

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "content" / "sample-ai-video-workflow" / "script.json"


class SubtitleTest(unittest.TestCase):
    def test_split_respects_max_chars_and_strips_period(self):
        text = "これはとても長い文章なので、字幕では二つに分かれるはずです。短い文。"
        chunks = split_subtitles(text, max_chars=16)
        self.assertTrue(all(len(c) <= 16 for c in chunks), chunks)
        self.assertEqual(chunks[-1], "短い文")
        self.assertEqual("".join(chunks).replace("、", ""), text.replace("。", "").replace("、", ""))

    def test_timings_cover_duration(self):
        timings = subtitle_timings(["あいう", "えお"], 5.0)
        self.assertAlmostEqual(timings[0][2], 3.0)
        self.assertAlmostEqual(timings[-1][2], 5.0)


class ChapterTest(unittest.TestCase):
    def test_merges_consecutive_chapters(self):
        script = {"segments": [{"chapter": "A"}, {"chapter": "A"}, {"chapter": "B"}, {}]}
        self.assertEqual(chapter_list(script, [10, 5, 20, 3]), [("A", 0.0, 15.0), ("B", 15.0, 23.0)])

    def test_timestamp_format(self):
        self.assertEqual(fmt_timestamp(0), "0:00")
        self.assertEqual(fmt_timestamp(754), "12:34")
        self.assertEqual(fmt_timestamp(3725), "1:02:05")


class ValidateTest(unittest.TestCase):
    def setUp(self):
        self.cfg = load_config()
        self.sample = load_script(SAMPLE)

    def test_sample_is_valid_as_draft(self):
        errors, _ = validate(self.sample, self.cfg, draft=True)
        self.assertEqual(errors, [])

    def test_unapproved_script_is_rejected(self):
        errors, _ = validate(self.sample, self.cfg)
        self.assertTrue(any("approved" in e for e in errors))

    def test_approved_requires_opinion_and_no_todo(self):
        s = copy.deepcopy(self.sample)
        s["review_status"] = "approved"
        for seg in s["segments"]:
            seg.pop("opinion", None)
        s["segments"][0]["narration"] = "TODO: 書く"
        errors, _ = validate(s, self.cfg)
        self.assertTrue(any("opinion" in e for e in errors))
        self.assertTrue(any("TODO" in e for e in errors))

    def test_chart_requires_source(self):
        s = copy.deepcopy(self.sample)
        chart_seg = next(seg for seg in s["segments"] if seg["visual"]["type"] == "chart")
        del chart_seg["visual"]["chart"]["source"]
        errors, _ = validate(s, self.cfg, draft=True)
        self.assertTrue(any("source" in e for e in errors))

    def test_news_format_requires_sources_when_approved(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "script.json"
            path.write_text(json.dumps(template("news_top5", "テスト"), ensure_ascii=False), encoding="utf-8")
            s = load_script(path)
        self.assertEqual(validate(s, self.cfg, draft=True)[0], [])
        s["review_status"] = "approved"
        errors, _ = validate(s, self.cfg)
        self.assertTrue(any("sources" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
