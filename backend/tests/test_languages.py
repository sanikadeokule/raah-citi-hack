"""The Python view of the shared release registry and its English fallback."""
import json

from raah import languages


def test_registry_integrity_and_release_state():
    raw = json.loads(languages.REGISTRY_PATH.read_text(encoding="utf-8"))
    codes = [item["code"] for item in raw["languages"]]
    assert codes == ["en", "hi", "mr", "bn", "ta", "te", "gu", "kn", "ml", "pa", "or", "as"]
    assert len(codes) == len(set(codes))
    assert languages.DEFAULT_LANGUAGE == raw["default"] == "en"
    assert set(languages.REGISTERED_LANGUAGES) == set(codes)
    assert languages.SELECTABLE_LANGUAGES == {"en", "hi", "mr"}
    for item in raw["languages"]:
        assert all(item.get(field) for field in ("code", "name", "nativeName", "locale"))
        assert languages.is_registered_language(item["code"])
        assert languages.is_selectable_language(item["code"]) == item["selectable"]


def test_normalization_and_existing_language_names():
    assert [languages.normalize_language(code) for code in ("en", "hi", "mr")] == ["en", "hi", "mr"]
    assert [languages.language_name(code) for code in ("en", "hi", "mr")] == ["English", "Hindi", "Marathi"]
    for code in ("ta", "bn", "xx", None, 3):
        assert languages.normalize_language(code) == "en"
        assert languages.language_name(code) == "English"
