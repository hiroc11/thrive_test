"""ナレーション音声の生成。APIキーが無ければ文字数から尺を見積もった無音（仮音声）を作る。"""
import os
import tempfile
from pathlib import Path

import requests

from . import ffmpeg


class DummyTTS:
    name = "dummy"

    def __init__(self, cfg):
        self.cfg = cfg

    def cache_key(self):
        return [self.name, self.cfg["chars_per_sec"]]

    def synth(self, text, out_wav):
        duration = max(1.0, len(text) / self.cfg["chars_per_sec"]) + self.cfg["segment_pad_sec"]
        ffmpeg.silence(out_wav, duration)


class ElevenLabsTTS:
    name = "elevenlabs"

    def __init__(self, cfg):
        self.cfg = cfg
        self.api_key = os.environ["ELEVENLABS_API_KEY"]
        self.voice_id = os.environ.get(cfg["tts"]["voice_id_env"]) or cfg["tts"].get("voice_id")
        if not self.voice_id:
            raise SystemExit(f"ElevenLabs の voice ID がありません。環境変数 {cfg['tts']['voice_id_env']} を設定してください")
        self.model = cfg["tts"]["elevenlabs_model"]

    def cache_key(self):
        return [self.name, self.voice_id, self.model]

    def synth(self, text, out_wav):
        resp = requests.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": self.api_key, "accept": "audio/mpeg"},
            json={"text": text, "model_id": self.model},
            timeout=180,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"ElevenLabs API error {resp.status_code}: {resp.text[:500]}")
        with tempfile.TemporaryDirectory() as tmp:
            mp3 = Path(tmp) / "voice.mp3"
            mp3.write_bytes(resp.content)
            ffmpeg.to_wav(mp3, out_wav, self.cfg["segment_pad_sec"])


def get_tts(choice, cfg):
    choice = choice or cfg["tts"]["provider"]
    if choice == "auto":
        choice = "elevenlabs" if os.environ.get("ELEVENLABS_API_KEY") else "dummy"
    if choice == "elevenlabs":
        return ElevenLabsTTS(cfg)
    if choice == "dummy":
        return DummyTTS(cfg)
    raise SystemExit(f"未対応の TTS プロバイダ: {choice}")
