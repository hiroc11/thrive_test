import json
from pathlib import Path

DEFAULT_CONFIG = Path(__file__).resolve().parent.parent / "config.json"


def load_config(path=None):
    path = Path(path) if path else DEFAULT_CONFIG
    with open(path, encoding="utf-8") as f:
        return json.load(f)
