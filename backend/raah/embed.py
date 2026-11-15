"""Interest matching: free-text interests in any language -> the dataset's career tags.

A student may say "fixing bikes", "मला गाड्या दुरुस्त करायला आवडतं" or "मुझे सिलाई पसंद है".
The career ranking works on the spreadsheet's tags, so the text is first mapped to the
closest tags with a multilingual embedding model, tried in this order (EMBED_PROVIDERS):
  ollama                 Ollama /api/embed (OLLAMA_EMBED_MODEL, default bge-m3)
  sentence-transformers  local model (EMBED_MODEL, default intfloat/multilingual-e5-small)
With neither available, words in the text are matched against the tags (English only).
Tag embeddings are cached per model and per set of tags, so editing tags in the
spreadsheet re-embeds them on the next request.
"""
from __future__ import annotations

import math
import os
import re
import time

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

from . import dataset

router = APIRouter(prefix="/api/interests", tags=["ai"])

MIN_SCORE = float(os.environ.get("EMBED_MIN_SCORE", "0.45"))
TOP_K = 3
_tag_cache: dict[tuple, list[list[float]]] = {}
_down: dict[str, float] = {}
_st_model = None


class EmbedUnavailable(RuntimeError):
    pass


def _prefixed(texts: list[str], model: str, kind: str) -> list[str]:
    # E5 models expect "query: " / "passage: " prefixes; other models take the text as is
    return [f"{kind}: {t}" for t in texts] if "e5" in model.lower() else texts


def _ollama(texts: list[str], kind: str) -> tuple[list[list[float]], str]:
    model = os.environ.get("OLLAMA_EMBED_MODEL", "bge-m3")
    url = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/") + "/api/embed"
    r = httpx.post(url, json={"model": model, "input": _prefixed(texts, model, kind)}, timeout=30)
    r.raise_for_status()
    return r.json()["embeddings"], f"ollama:{model}"


def _sentence_transformers(texts: list[str], kind: str) -> tuple[list[list[float]], str]:
    global _st_model
    model = os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-small")
    if _st_model is None:
        from sentence_transformers import SentenceTransformer  # optional dependency
        _st_model = SentenceTransformer(model)
    return _st_model.encode(_prefixed(texts, model, kind), normalize_embeddings=True).tolist(), f"st:{model}"


PROVIDERS = {"ollama": _ollama, "sentence-transformers": _sentence_transformers}


def embed(texts: list[str], kind: str = "query") -> tuple[list[list[float]], str]:
    errors = []
    for name in [p.strip() for p in os.environ.get("EMBED_PROVIDERS", "ollama,sentence-transformers").split(",") if p.strip()]:
        fn = PROVIDERS.get(name)
        if fn is None or time.time() - _down.get(name, 0) < 60:
            continue
        try:
            return fn(texts, kind)
        except Exception as e:  # server down, model not pulled, package not installed...
            _down[name] = time.time()
            errors.append(f"{name}: {type(e).__name__}")
    raise EmbedUnavailable("; ".join(errors) or "no embedding provider")


def _cos(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def keyword_match(text: str, tags: list[str]) -> list[dict]:
    words = {w for w in re.findall(r"\w+", text.lower()) if len(w) > 2}
    out = []
    for t in tags:
        tw = {w for w in re.findall(r"\w+", t.lower()) if len(w) > 2}
        hit = len(words & tw) / len(tw) if tw else 0
        if t.lower() in text.lower():
            hit = 1.0
        if hit:
            out.append({"tag": t, "score": round(hit, 3)})
    return sorted(out, key=lambda x: -x["score"])[:TOP_K]


def match(text: str, tags: list[str]) -> dict:
    """Closest tags for the text, with the method used."""
    text = text.strip()
    if not text or not tags:
        return {"method": "none", "tags": []}
    try:
        (q,), model = embed([text], "query")
        key = (model, tuple(tags))
        if key not in _tag_cache:
            _tag_cache[key] = embed(tags, "passage")[0]
        scored = sorted(({"tag": t, "score": round(_cos(q, v), 3)} for t, v in zip(tags, _tag_cache[key])), key=lambda x: -x["score"])
        best = [s for s in scored[:TOP_K] if s["score"] >= MIN_SCORE]
        return {"method": "embedding", "model": model, "tags": best}
    except EmbedUnavailable:
        return {"method": "keyword", "tags": keyword_match(text, tags)}


def all_tags(d: dict) -> list[str]:
    return sorted({t for c in d["careers"] for t in c["tags"]})


class MatchIn(BaseModel):
    text: str = Field(..., max_length=500)


@router.post("/match")
def match_endpoint(body: MatchIn):
    return match(body.text, all_tags(dataset.get()))
