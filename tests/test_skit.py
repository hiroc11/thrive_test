import copy
import json
import tempfile
import unittest
from pathlib import Path

from autovideo import ffmpeg
from autovideo.config import load_config
from autovideo.skit import build_skit, caption_text, load_skit, skit_template, validate_skit

ROOT = Path(__file__).resolve().parent.parent
OTOYAKU = ROOT / "skits" / "sample-otoyaku-toast" / "skit.json"
ANIME_VS_LIVE = ROOT / "skits" / "sample-hana-live" / "skit.json"


class ValidateSkitTest(unittest.TestCase):
    def setUp(self):
        self.cfg = load_config()
        self.skit = load_skit(OTOYAKU)

    def errors(self, skit, draft=True, cfg=None):
        return validate_skit(skit, cfg or self.cfg, draft=draft)[0]

    def test_samples_are_valid_as_draft(self):
        self.assertEqual(self.errors(self.skit), [])
        self.assertEqual(self.errors(load_skit(ANIME_VS_LIVE)), [])

    def test_unapproved_is_rejected(self):
        self.assertTrue(any("approved" in e for e in self.errors(self.skit, draft=False)))

    def test_unknown_character_and_speaker(self):
        s = copy.deepcopy(self.skit)
        s["characters"].append("nobody")
        s["cuts"][0]["lines"][0]["who"] = "stranger"
        errors = self.errors(s)
        self.assertTrue(any("nobody" in e for e in errors))
        self.assertTrue(any("stranger" in e for e in errors))

    def test_banned_terms_are_rejected(self):
        cfg = copy.deepcopy(self.cfg)
        cfg["skit"]["banned_terms"] = ["既存作品タイトル"]
        s = copy.deepcopy(self.skit)
        s["cuts"][0]["lines"][0]["text"] = "既存作品タイトルのセリフ"
        self.assertTrue(any("禁止ワード" in e for e in self.errors(s, cfg=cfg)))

    def test_split_must_be_still(self):
        s = load_skit(ANIME_VS_LIVE)
        s["cuts"][0]["shot"] = "video"
        self.assertTrue(any("split" in e for e in self.errors(s)))

    def test_anime_vs_live_needs_both_styles(self):
        s = load_skit(ANIME_VS_LIVE)
        for cut in s["cuts"]:
            cut["style"] = "live"
        self.assertTrue(any("両方" in e for e in self.errors(s)))

    def test_otoyaku_needs_trope(self):
        s = copy.deepcopy(self.skit)
        del s["trope"]
        self.assertTrue(any("trope" in e for e in self.errors(s)))

    def test_template_is_valid_as_draft(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "x" / "skit.json"
            path.parent.mkdir()
            path.write_text(json.dumps(skit_template("anime_vs_live", ["hana"]), ensure_ascii=False),
                            encoding="utf-8")
            self.assertEqual(self.errors(load_skit(path)), [])

    def test_caption_reminds_altered_content_only_for_live(self):
        self.assertIn("改変または合成", caption_text(self.skit, self.cfg))
        s = load_skit(ANIME_VS_LIVE)
        s["cuts"] = [c for c in s["cuts"] if c["style"] == "anime"]
        self.assertNotIn("改変または合成", caption_text(s, self.cfg))


class BuildSkitTest(unittest.TestCase):
    def test_build_with_dummy_providers(self):
        cfg = load_config()
        skit = load_skit(ANIME_VS_LIVE)
        with tempfile.TemporaryDirectory() as tmp:
            out_dir, manifest = build_skit(skit, cfg, out_root=tmp, draft=True, tts_choice="dummy",
                                           image_choice="dummy", video_choice="dummy", log=lambda *_: None)
            short = out_dir / manifest["path"]
            self.assertTrue(short.exists())
            self.assertTrue(manifest["altered_content"])
            # 各カットは min_sec 以上の長さになる
            min_total = sum(c.get("min_sec", 2.0) for c in skit["cuts"])
            self.assertGreaterEqual(ffmpeg.media_duration(short), min_total - 0.1)
            self.assertTrue((out_dir / "caption.txt").exists())


if __name__ == "__main__":
    unittest.main()
