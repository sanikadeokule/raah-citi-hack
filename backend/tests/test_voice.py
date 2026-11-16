"""Speech: 503 without keys, disk cache first, then BHASHINI, then Sarvam, with clear errors."""
import base64
import io
import os
import tempfile
import wave

os.environ["RAAH_TTS_CACHE"] = tempfile.mkdtemp()

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from raah import voice  # noqa: E402
from raah.main import app  # noqa: E402

c = TestClient(app)
KEYS = ("BHASHINI_USER_ID", "BHASHINI_API_KEY", "SARVAM_API_KEY", "VOICE_PROVIDERS")


def _wav(frames: bytes, rate: int = 22050) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    return b.getvalue()


class FakeResp:
    def __init__(self, status: int, payload: dict):
        self.status_code, self._p = status, payload

    def json(self):
        return self._p


@pytest.fixture(autouse=True)
def clean(monkeypatch, tmp_path):
    for k in KEYS:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(voice, "TTS_DIR", tmp_path)
    voice._failed.clear()


def both_keys(monkeypatch):
    monkeypatch.setenv("BHASHINI_USER_ID", "u")
    monkeypatch.setenv("BHASHINI_API_KEY", "k")
    monkeypatch.setenv("SARVAM_API_KEY", "s")


def test_tts_without_keys_tells_app_to_use_device_voice():
    r = c.post("/api/voice/tts", json={"text": "नमस्कार", "lang": "mr"})
    assert r.status_code == 503 and "phone" in r.json()["detail"]
    assert c.get("/api/voice/status").json() == {"bhashini": False, "sarvam": False, "providers": [], "tts": False, "asr": False}


def test_tts_served_from_cache_without_keys_or_network(monkeypatch):
    monkeypatch.setattr(voice, "_pipeline", lambda *a: (_ for _ in ()).throw(AssertionError("network call")))
    wav = b"RIFF0000WAVEfmt "
    voice._tts_path("ITI म्हणजे काय?", "mr", "female").write_bytes(wav)
    j = c.post("/api/voice/tts", json={"text": "ITI म्हणजे काय?", "lang": "mr"}).json()
    assert j["cached"] is True and base64.b64decode(j["audio_b64"]) == wav


def test_status_lists_providers_in_order(monkeypatch):
    both_keys(monkeypatch)
    assert c.get("/api/voice/status").json()["providers"] == ["bhashini", "sarvam"]
    monkeypatch.setenv("VOICE_PROVIDERS", "sarvam,bhashini")
    assert c.get("/api/voice/status").json()["providers"] == ["sarvam", "bhashini"]


def test_sarvam_used_when_bhashini_fails(monkeypatch):
    both_keys(monkeypatch)
    monkeypatch.setattr(voice, "_bhashini_tts", lambda *a: (_ for _ in ()).throw(voice.VoiceError("down")))
    sent = []

    def fake_post(url, **kw):
        sent.append((url, kw))
        return FakeResp(200, {"audios": [base64.b64encode(_wav(b"\x01\x00" * 10)).decode()]})

    monkeypatch.setattr(voice.httpx, "post", fake_post)
    j = c.post("/api/voice/tts", json={"text": "नमस्कार", "lang": "mr"}).json()
    assert j["provider"] == "sarvam" and j["cached"] is False
    url, kw = sent[0]
    assert url == voice.SARVAM_TTS_URL
    assert kw["headers"] == {"api-subscription-key": "s"}
    assert kw["json"]["target_language_code"] == "mr-IN" and kw["json"]["text"] == "नमस्कार"
    # bhashini is now cooling down, so the next request starts with sarvam
    assert voice._try_order() == ["sarvam", "bhashini"]


def test_long_text_is_split_and_joined_into_one_wav(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "s")
    calls = []

    def fake_post(url, **kw):
        calls.append(kw["json"]["text"])
        return FakeResp(200, {"audios": [base64.b64encode(_wav(b"\x02\x00" * 100)).decode()]})

    monkeypatch.setattr(voice.httpx, "post", fake_post)
    text = "हे एक वाक्य आहे. " * 60
    j = c.post("/api/voice/tts", json={"text": text, "lang": "mr"}).json()
    assert len(calls) > 1 and all(len(p) <= voice.SARVAM_MAX_CHARS for p in calls)
    with wave.open(io.BytesIO(base64.b64decode(j["audio_b64"]))) as w:
        assert w.getnframes() == 100 * len(calls)


def test_all_providers_failing_returns_502_with_reason(monkeypatch):
    both_keys(monkeypatch)
    monkeypatch.setattr(voice, "_bhashini_tts", lambda *a: (_ for _ in ()).throw(voice.VoiceError("bhashini down")))
    monkeypatch.setattr(voice.httpx, "post", lambda url, **kw: FakeResp(401, {}))
    r = c.post("/api/voice/tts", json={"text": "hello", "lang": "en"})
    assert r.status_code == 502
    assert "bhashini down" in r.json()["detail"] and "Sarvam TTS returned 401" in r.json()["detail"]


def test_asr_through_sarvam(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "s")
    seen = {}

    def fake_post(url, **kw):
        seen.update(url=url, **kw)
        return FakeResp(200, {"transcript": " मला ITI करायचं आहे "})

    monkeypatch.setattr(voice.httpx, "post", fake_post)
    audio = base64.b64encode(_wav(b"\x00\x00" * 160, 16000)).decode()
    j = c.post("/api/voice/asr", json={"audio_b64": audio, "lang": "mr"}).json()
    assert j == {"text": "मला ITI करायचं आहे", "provider": "sarvam"}
    assert seen["url"] == voice.SARVAM_ASR_URL and seen["data"]["language_code"] == "mr-IN"
    assert seen["files"]["file"][0] == "speech.wav"


def test_asr_rejects_bad_audio(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "s")
    assert c.post("/api/voice/asr", json={"audio_b64": "not base64!!", "lang": "mr"}).status_code == 400
    assert c.post("/api/voice/asr", json={"audio_b64": "", "lang": "mr"}).status_code == 400


def test_chunks_respect_limit_and_keep_text():
    text = "पहिले वाक्य. " * 50 + "x" * 1000
    parts = voice._chunks(text, 100)
    assert all(len(p) <= 100 for p in parts)
    assert "".join(parts).replace(" ", "") == text.replace(" ", "")
