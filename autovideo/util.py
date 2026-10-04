import base64
import hashlib
import json
import mimetypes


def digest(*parts):
    h = hashlib.sha1()
    for p in parts:
        h.update(json.dumps(p, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8"))
    return h.hexdigest()[:12]


def fmt_timestamp(sec):
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def data_uri(path):
    """ローカル画像を API に直接渡すための data URI。"""
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()


def file_digest(path):
    return hashlib.sha1(open(path, "rb").read()).hexdigest()[:12]
