from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

from app import config as config_module
from app import spec_loader


def test_load_storage_model_spec_supports_frozen_bundle(monkeypatch, tmp_path: Path):
    specs_dir = tmp_path / "specs"
    specs_dir.mkdir(parents=True)
    (specs_dir / "storage-model.json").write_text(
        json.dumps({"default_note_extension": ".bundle-note.json"}),
        encoding="utf-8",
    )

    spec_loader.load_storage_model_spec.cache_clear()
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)

    try:
        assert spec_loader.load_storage_model_spec()["default_note_extension"] == ".bundle-note.json"
    finally:
        spec_loader.load_storage_model_spec.cache_clear()
        monkeypatch.delattr(sys, "_MEIPASS", raising=False)


def test_read_repo_version_supports_frozen_bundle(monkeypatch, tmp_path: Path):
    (tmp_path / "VERSION").write_text("9.9.9\n", encoding="utf-8")
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)

    try:
        reloaded = importlib.reload(config_module)
        assert reloaded._read_repo_version() == "9.9.9"
    finally:
        monkeypatch.delattr(sys, "_MEIPASS", raising=False)
        importlib.reload(config_module)
