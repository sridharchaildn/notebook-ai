from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def load_storage_model_spec() -> dict[str, object]:
    repo_root = Path(__file__).resolve().parents[3]
    spec_path = repo_root / "specs" / "storage-model.json"
    return json.loads(spec_path.read_text(encoding="utf-8"))
