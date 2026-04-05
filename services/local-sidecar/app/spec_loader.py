from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path


def _resource_root() -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).resolve().parents[3]


@lru_cache(maxsize=1)
def load_storage_model_spec() -> dict[str, object]:
    spec_path = _resource_root() / "specs" / "storage-model.json"
    return json.loads(spec_path.read_text(encoding="utf-8"))
