"""Voice: BHASHINI ASR / TTS when keys exist, otherwise 503 so the app falls back
to the browser's Web Speech API (mr-IN / hi-IN / en-IN).

Keys go in backend/.env (never in code):
  BHASHINI_USER_ID=...
  BHASHINI_API_KEY=...          (ulcaApiKey from your BHASHINI profile)
  BHASHINI_PIPELINE_ID=64392f96daac500b55c543cd   (MeitY default pipeline)
"""
from __future__ import annotations

import base64
import hashlib
import os
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/voice", tags=["voice"])

CONFIG_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline"
_cache: dict[str, tuple[float, dict]] = {}
# generated speech is kept on disk so the same lesson or message is synthesised once
TTS_DIR = Path(os.environ.get("RAAH_TTS_CACHE", Path(__file__).resolve().parents[1] / "data" / "tts"))


def _tts_path(text: str, lang: str, gender: str) -> Path:
    return TTS_DIR / (hashlib.sha256(f"{lang}|{gender}|{text}".encode()).hexdigest()[:32] + ".wav")


def _keys():
    uid, key = os.environ.get("BHASHINI_USER_ID"), os.environ.get("BHASHINI_API_KEY")
    if not uid or not key:
        raise HTTPException(503, "BHASHINI keys not set; use browser speech")
    return uid, key, os.environ.get("BHASHINI_PIPELINE_ID", "64392f96daac500b55c543cd")


def _pipeline(task: str, lang: str) -> dict:
    ck = f"{task}:{lang}"
    if ck in _cache and time.time() - _cache[ck][0] < 3600:
        return _cache[ck][1]
    uid, key, pid = _keys()
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
def status():
    return {"bhashini": bool(os.environ.get("BHASHINI_USER_ID") and os.environ.get("BHASHINI_API_KEY"))}


@router.post("/tts")
def tts(body: TTSIn):
    _keys()
    path = _tts_path(body.text, body.lang, body.gender)
    if path.exists():
        return {"audio_b64": base64.b64encode(path.read_bytes()).decode(), "mime": "audio/wav", "cached": True}
    cfg = _pipeline("tts", body.lang)
    r = httpx.post(cfg["url"], timeout=30, headers=cfg["auth"], json={
        "pipelineTasks": [{"taskType": "tts", "config": {"language": {"sourceLanguage": body.lang},
                                                        "serviceId": cfg["service_id"], "gender": body.gender}}],
        "inputData": {"input": [{"source": body.text}]}})
    if r.status_code != 200:
        raise HTTPException(502, "BHASHINI TTS failed")
    audio = r.json()["pipelineResponse"][0]["audio"][0]["audioContent"]
    TTS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(base64.b64decode(audio))
    return {"audio_b64": audio, "mime": "audio/wav", "cached": False}


@router.post("/asr")
def asr(body: ASRIn):
    cfg = _pipeline("asr", body.lang)
    r = httpx.post(cfg["url"], timeout=30, headers=cfg["auth"], json={
        "pipelineTasks": [{"taskType": "asr", "config": {"language": {"sourceLanguage": body.lang},
                                                        "serviceId": cfg["service_id"], "audioFormat": body.format,
                                                        "samplingRate": body.sample_rate}}],
        "inputData": {"audio": [{"audioContent": body.audio_b64}]}})
    if r.status_code != 200:
        raise HTTPException(502, "BHASHINI ASR failed")
    return {"text": r.json()["pipelineResponse"][0]["output"][0]["source"]}
