"""Shared language identities; selectable means released, not speech-provider support."""
from __future__ import annotations

import json
from pathlib import Path

REGISTRY_PATH = Path(__file__).resolve().parents[2] / "languages.json"
_registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
DEFAULT_LANGUAGE: str = _registry["default"]
REGISTERED_LANGUAGES: dict[str, dict] = {item["code"]: item for item in _registry["languages"]}
SELECTABLE_LANGUAGES: frozenset[str] = frozenset(
    code for code, item in REGISTERED_LANGUAGES.items() if item["selectable"]
)


def is_registered_language(code: str) -> bool:
    return code in REGISTERED_LANGUAGES


def is_selectable_language(code: str) -> bool:
    return code in SELECTABLE_LANGUAGES


def normalize_language(code: object) -> str:
    return code if isinstance(code, str) and is_selectable_language(code) else DEFAULT_LANGUAGE


def language_name(code: object) -> str:
    return REGISTERED_LANGUAGES[normalize_language(code)]["name"]
