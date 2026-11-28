"""Voice: provider-aware speech for the selectable languages.

Providers are tried in the order given by VOICE_PROVIDERS (default "bhashini,sarvam");
a provider without keys is skipped, and one that fails is skipped for a short while so
a dead service does not slow every request. With no provider configured the endpoints
return 503 and the app uses the phone's own voices (Web Speech API) instead.

Keys go in backend/.env (never in code):
  BHASHINI_USER_ID=...
  BHASHINI_API_KEY=...          (ulcaApiKey from your BHASHINI profile)
  BHASHINI_PIPELINE_ID=64392f96daac500b55c543cd   (MeitY default pipeline)
  SARVAM_API_KEY=...            (dashboard.sarvam.ai; the same key the AI chat uses)
  SARVAM_TTS_MODEL=bulbul:v3    SARVAM_TTS_SPEAKER=anushka   SARVAM_ASR_MODEL=saaras:v4
"""
from __future__ import annotations

import base64
import hashlib
import io
import os
import re
import time
import wave
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .languages import REGISTERED_LANGUAGES, is_selectable_language

router = APIRouter(prefix="/api/voice", tags=["voice"])

CONFIG_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline"
SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
SARVAM_ASR_URL = "https://api.sarvam.ai/speech-to-text"
SARVAM_MAX_CHARS = 450  # Sarvam limits text per request, so long lessons are spoken in parts and joined
LOCALE = {code: item["locale"] for code, item in REGISTERED_LANGUAGES.items()}
# Bulbul v3 accepts 11 languages, uses od-IN for Odia, and does not support Assamese.
SARVAM_TTS_LOCALE = {code: ("od-IN" if code == "or" else locale)
                     for code, locale in LOCALE.items() if code != "as"}
SARVAM_SPEAKERS = {"bn": ("roopa", "rehan"), "ta": ("ishita", "ratan"),
                   "te": ("neha", "ratan"), "gu": ("priya", "ratan"),
                   "kn": ("neha", "ratan"), "ml": ("pooja", "shubh"),
                   "pa": ("roopa", "mani"), "or": ("ritu", "shubh")}
COOLDOWN_S = 120

_cache: dict[str, tuple[float, dict]] = {}
_failed: dict[str, float] = {}
# generated speech is kept on disk so the same lesson or message is synthesised once
TTS_DIR = Path(os.environ.get("RAAH_TTS_CACHE", Path(__file__).resolve().parents[1] / "data" / "tts"))


class VoiceError(RuntimeError):
    pass


def _tts_path(text: str, lang: str, gender: str) -> Path:
    return TTS_DIR / (hashlib.sha256(f"{lang}|{gender}|{text}".encode()).hexdigest()[:32] + ".wav")


def _has_keys(name: str) -> bool:
    if name == "bhashini":
        return bool(os.environ.get("BHASHINI_USER_ID") and os.environ.get("BHASHINI_API_KEY"))
    if name == "sarvam":
        return bool(os.environ.get("SARVAM_API_KEY"))
    return False


def configured() -> list[str]:
    """Providers with keys, in the order they will be tried."""
    order = [p.strip().lower() for p in os.environ.get("VOICE_PROVIDERS", "bhashini,sarvam").split(",") if p.strip()]
    return [p for p in order if _has_keys(p)]


def _try_order() -> list[str]:
    """Configured providers, recently failed ones last (still tried if nothing else works)."""
    now = time.time()
    names = configured()
    return [p for p in names if now - _failed.get(p, 0) > COOLDOWN_S] + [p for p in names if now - _failed.get(p, 0) <= COOLDOWN_S]


def _supports(name: str, task: str, lang: str) -> bool:
    # BHASHINI availability is resolved by its configured pipeline for each language and task.
    return lang in LOCALE if name == "bhashini" else (lang in SARVAM_TTS_LOCALE if task == "tts" else lang in LOCALE)


# ------------------------------------------------------------------ BHASHINI (ULCA pipeline)
def _pipeline(task: str, lang: str) -> dict:
    ck = f"{task}:{lang}"
    if ck in _cache and time.time() - _cache[ck][0] < 3600:
        return _cache[ck][1]
    uid, key = os.environ["BHASHINI_USER_ID"], os.environ["BHASHINI_API_KEY"]
    pid = os.environ.get("BHASHINI_PIPELINE_ID", "64392f96daac500b55c543cd")
    r = httpx.post(CONFIG_URL, timeout=20, headers={"userID": uid, "ulcaApiKey": key}, json={
        "pipelineTasks": [{"taskType": task, "config": {"language": {"sourceLanguage": lang}}}],
        "pipelineRequestConfig": {"pipelineId": pid}})
    r.raise_for_status()
    j = r.json()
    ep = j["pipelineInferenceAPIEndPoint"]
    cfg = {"url": ep["callbackUrl"], "auth": {ep["inferenceApiKey"]["name"]: ep["inferenceApiKey"]["value"]},
           "service_id": j["pipelineResponseConfig"][0]["config"][0]["serviceId"]}
    _cache[ck] = (time.time(), cfg)
    return cfg


def _bhashini_tts(text: str, lang: str, gender: str) -> bytes:
    cfg = _pipeline("tts", lang)
    r = httpx.post(cfg["url"], timeout=30, headers=cfg["auth"], json={
        "pipelineTasks": [{"taskType": "tts", "config": {"language": {"sourceLanguage": lang},
                                                        "serviceId": cfg["service_id"], "gender": gender}}],
        "inputData": {"input": [{"source": text}]}})
    if r.status_code != 200:
        raise VoiceError(f"BHASHINI TTS returned {r.status_code}")
    return base64.b64decode(r.json()["pipelineResponse"][0]["audio"][0]["audioContent"])


def _bhashini_asr(audio: bytes, lang: str, fmt: str, sample_rate: int) -> str:
    cfg = _pipeline("asr", lang)
    r = httpx.post(cfg["url"], timeout=30, headers=cfg["auth"], json={
        "pipelineTasks": [{"taskType": "asr", "config": {"language": {"sourceLanguage": lang},
                                                        "serviceId": cfg["service_id"], "audioFormat": fmt,
                                                        "samplingRate": sample_rate}}],
        "inputData": {"audio": [{"audioContent": base64.b64encode(audio).decode()}]}})
    if r.status_code != 200:
        raise VoiceError(f"BHASHINI ASR returned {r.status_code}")
    return r.json()["pipelineResponse"][0]["output"][0]["source"]


# ------------------------------------------------------------------ Sarvam AI (Bulbul TTS, Saarika ASR)
def _sarvam_headers() -> dict:
    return {"api-subscription-key": os.environ["SARVAM_API_KEY"]}


def _chunks(text: str, limit: int = SARVAM_MAX_CHARS) -> list[str]:
    """Split at sentence ends (। . ? ! newline) so no part is longer than the limit."""
    parts, cur = [], ""
    for s in re.split(r"(?<=[।.?!\n])\s*", text.strip()):
        while len(s) > limit:  # one very long sentence: cut at the last space before the limit
            cut = s.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            if cur:
                parts.append(cur)
                cur = ""
            parts.append(s[:cut].strip())
            s = s[cut:].strip()
        if cur and len(cur) + 1 + len(s) > limit:
            parts.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        parts.append(cur)
    return [p for p in parts if p]


def _join_wavs(wavs: list[bytes]) -> bytes:
    if len(wavs) == 1:
        return wavs[0]
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        for i, b in enumerate(wavs):
            with wave.open(io.BytesIO(b), "rb") as r:
                if i == 0:
                    w.setparams(r.getparams())
                w.writeframes(r.readframes(r.getnframes()))
    return out.getvalue()


def _sarvam_tts(text: str, lang: str, gender: str) -> bytes:
    defaults = SARVAM_SPEAKERS.get(lang, ("anushka", "abhilash"))
    speaker = os.environ.get("SARVAM_TTS_SPEAKER" if gender != "male" else "SARVAM_TTS_SPEAKER_MALE",
                             defaults[0] if gender != "male" else defaults[1])
    wavs = []
    for part in _chunks(text):
        r = httpx.post(SARVAM_TTS_URL, timeout=30, headers=_sarvam_headers(), json={
            "text": part, "target_language_code": SARVAM_TTS_LOCALE[lang], "speaker": speaker,
            "model": os.environ.get("SARVAM_TTS_MODEL", "bulbul:v3"), "pace": 0.95})
        if r.status_code != 200:
            raise VoiceError(f"Sarvam TTS returned {r.status_code}")
        wavs.append(base64.b64decode(r.json()["audios"][0]))
    return _join_wavs(wavs)


def _sarvam_asr(audio: bytes, lang: str, fmt: str, sample_rate: int) -> dict:
    r = httpx.post(SARVAM_ASR_URL, timeout=30, headers=_sarvam_headers(),
                   data={"model": os.environ.get("SARVAM_ASR_MODEL", "saaras:v4"), "mode": "transcribe"},
                   files={"file": (f"speech.{fmt}", audio, f"audio/{fmt}")})
    if r.status_code != 200:
        raise VoiceError(f"Sarvam ASR returned {r.status_code}")
    result = r.json()
    return {"text": result.get("transcript", ""), "language_code": result.get("language_code"),
            "language_probability": result.get("language_probability")}


def _run(task: str, *args):
    """Try each configured provider in turn; returns (result, provider name)."""
    names = [name for name in _try_order() if _supports(name, task, args[1])]
    if not names:
        raise HTTPException(503, "No speech service configured (BHASHINI or Sarvam keys); use the phone's voice")
    errors = []
    for name in names:
        try:
            out = globals()[f"_{name}_{task}"](*args)
            _failed.pop(name, None)
            return out, name
        except Exception as e:  # network error, bad key, quota, unexpected reply
            _failed[name] = time.time()
            errors.append(f"{name}: {e}")
    raise HTTPException(502, "Speech services failed (" + "; ".join(errors) + "); use the phone's voice")


# ------------------------------------------------------------------ endpoints
class TTSIn(BaseModel):
    text: str
    lang: str = "mr"
    gender: str = "female"


class ASRIn(BaseModel):
    audio_b64: str
    lang: str = "mr"
    sample_rate: int = 16000
    format: str = "wav"


@router.get("/status")
def status(lang: str | None = None):
    names = configured()
    if lang is not None:
        names = [name for name in names if _supports(name, "tts", lang) or _supports(name, "asr", lang)]
    return {"bhashini": _has_keys("bhashini"), "sarvam": _has_keys("sarvam"), "providers": names,
            "tts": any(_supports(name, "tts", lang) for name in names) if lang else bool(names),
            "asr": any(_supports(name, "asr", lang) for name in names) if lang else bool(names)}


@router.post("/tts")
def tts(body: TTSIn):
    if not is_selectable_language(body.lang) or body.lang not in LOCALE:
        raise HTTPException(422, "unsupported speech language")
    path = _tts_path(body.text, body.lang, body.gender)
    if path.exists():  # served even when keys are gone or the service is down
        return {"audio_b64": base64.b64encode(path.read_bytes()).decode(), "mime": "audio/wav", "cached": True}
    audio, provider = _run("tts", body.text, body.lang, body.gender)
    TTS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)
    return {"audio_b64": base64.b64encode(audio).decode(), "mime": "audio/wav", "cached": False, "provider": provider}


@router.post("/asr")
def asr(body: ASRIn):
    if not is_selectable_language(body.lang) or body.lang not in LOCALE:
        raise HTTPException(422, "unsupported speech language")
    try:
        audio = base64.b64decode(body.audio_b64, validate=True)
    except Exception:
        raise HTTPException(400, "audio_b64 is not valid base64")
    if not audio:
        raise HTTPException(400, "empty recording")
    result, provider = _run("asr", audio, body.lang, body.format, body.sample_rate)
    if isinstance(result, dict):
        text = result.get("text", "")
        language_code = result.get("language_code")
        confidence = result.get("language_probability")
    else:  # BHASHINI returns text only; keep its explicitly selected language.
        text = result
        language_code = LOCALE[body.lang]
        confidence = None
    detected_lang = next((short for short, code in LOCALE.items()
                          if language_code and (language_code.lower() == code.lower()
                                                or short == "or" and language_code.lower() == "od-in")), body.lang)
    return {"text": text.strip(), "provider": provider, "detected_lang": detected_lang,
            "language_code": language_code, "language_probability": confidence}
