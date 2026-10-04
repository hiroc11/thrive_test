"""画像から短い動画クリップを作る（image-to-video）。キーが無ければ None を返し、静止画＋ズームで代用する。"""
import os

import requests

from .util import data_uri


class DummyVideo:
    name = "dummy"

    def cache_key(self):
        return [self.name]

    def generate(self, image_path, motion, out_mp4):
        return None


class FalVideo:
    name = "fal"

    def __init__(self, cfg):
        self.key = os.environ["FAL_KEY"]
        self.model = cfg["skit"]["video"]["fal_model"]
        self.seconds = cfg["skit"]["video"]["seconds"]

    def cache_key(self):
        return [self.name, self.model, self.seconds]

    def generate(self, image_path, motion, out_mp4):
        resp = requests.post(
            f"https://fal.run/{self.model}",
            headers={"Authorization": f"Key {self.key}"},
            json={"prompt": motion, "image_url": data_uri(image_path), "duration": self.seconds,
                  "aspect_ratio": "9:16"},
            timeout=900,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"fal.ai video API error {resp.status_code}: {resp.text[:500]}")
        url = resp.json()["video"]["url"]
        out_mp4.write_bytes(requests.get(url, timeout=300).content)
        return out_mp4


def get_video_provider(choice, cfg):
    choice = choice or cfg["skit"]["video"]["provider"]
    if choice == "auto":
        choice = "fal" if os.environ.get("FAL_KEY") else "dummy"
    if choice == "fal":
        return FalVideo(cfg)
    if choice == "dummy":
        return DummyVideo()
    raise SystemExit(f"未対応の動画プロバイダ: {choice}")
