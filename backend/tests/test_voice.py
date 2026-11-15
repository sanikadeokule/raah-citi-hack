"""Speech: 503 without BHASHINI keys, and generated audio is served from the disk cache."""
import base64
import os
import tempfile

os.environ["RAAH_TTS_CACHE"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient  # noqa: E402

from raah import voice  # noqa: E402
from raah.main import app  # noqa: E402

c = TestClient(app)


def test_tts_without_keys_tells_app_to_use_device_voice(monkeypatch):
    monkeypatch.delenv("BHASHINI_USER_ID", raising=False)
    monkeypatch.delenv("BHASHINI_API_KEY", raising=False)
    assert c.post("/api/voice/tts", json={"text": "नमस्कार", "lang": "mr"}).status_code == 503


def test_tts_served_from_cache_without_calling_bhashini(monkeypatch):
    monkeypatch.setenv("BHASHINI_USER_ID", "u")
    monkeypatch.setenv("BHASHINI_API_KEY", "k")
    monkeypatch.setattr(voice, "TTS_DIR", voice.Path(os.environ["RAAH_TTS_CACHE"]))
    monkeypatch.setattr(voice, "_pipeline", lambda *a: (_ for _ in ()).throw(AssertionError("network call")))
    wav = b"RIFF0000WAVEfmt "
    path = voice._tts_path("ITI म्हणजे काय?", "mr", "female")
    path.write_bytes(wav)
    j = c.post("/api/voice/tts", json={"text": "ITI म्हणजे काय?", "lang": "mr"}).json()
    assert j["cached"] is True and base64.b64decode(j["audio_b64"]) == wav
