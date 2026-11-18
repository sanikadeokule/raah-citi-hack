"""Thin client for open-source LLMs behind OpenAI-compatible chat APIs.

Providers are tried in the order given by LLM_PROVIDERS (default "openai,groq"):
  openai  OpenAI cloud          (OPENAI_API_KEY, OPENAI_MODEL; default gpt-4o-mini)
  ollama  local Ollama server   (OLLAMA_URL, OLLAMA_MODEL; default gemma4:12b)
  groq    Groq cloud, Llama     (GROQ_API_KEY, GROQ_MODEL; default llama-3.3-70b-versatile)
  sarvam  Sarvam AI, Sarvam-M   (SARVAM_API_KEY, SARVAM_MODEL; default sarvam-m)
If none answers, callers fall back to the scripted flow and template sentences.
"""
from __future__ import annotations

import json
import os
import re
import time

import httpx


class LLMUnavailable(RuntimeError):
    pass


def _providers() -> list[dict]:
    out = []
    for name in [p.strip() for p in os.environ.get("LLM_PROVIDERS", "openai,groq").split(",") if p.strip()]:
        if name == "openai" and os.environ.get("OPENAI_API_KEY"):
            out.append({"name": "openai", "url": "https://api.openai.com/v1/chat/completions",
                        "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                        "headers": {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}, "timeout": 30})
        elif name == "ollama":
            out.append({"name": "ollama", "url": os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/") + "/v1/chat/completions",
                        "model": os.environ.get("OLLAMA_MODEL", "gemma4:12b"), "headers": {}, "timeout": 120})
        elif name == "groq" and os.environ.get("GROQ_API_KEY"):
            out.append({"name": "groq", "url": "https://api.groq.com/openai/v1/chat/completions",
                        "model": os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
                        "headers": {"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"}, "timeout": 30})
        elif name == "sarvam" and os.environ.get("SARVAM_API_KEY"):
            out.append({"name": "sarvam", "url": "https://api.sarvam.ai/v1/chat/completions",
                        "model": os.environ.get("SARVAM_MODEL", "sarvam-m"),
                        "headers": {"api-subscription-key": os.environ["SARVAM_API_KEY"]}, "timeout": 30})
    return out


# remember providers that just failed so a dead local Ollama doesn't slow every request
_down: dict[str, float] = {}
DOWN_SECONDS = 60


def status() -> dict:
    ps = _providers()
    return {"configured": [p["name"] for p in ps],
            "available": any(time.time() - _down.get(p["name"], 0) > DOWN_SECONDS for p in ps)}


def chat(messages: list[dict], json_mode: bool = False, temperature: float = 0.3, max_tokens: int = 600) -> tuple[str, str]:
    """Returns (text, provider_name). Raises LLMUnavailable when every provider fails."""
    errors = []
    for p in _providers():
        if time.time() - _down.get(p["name"], 0) < DOWN_SECONDS:
            continue
        body = {"model": p["model"], "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        if p["name"] == "ollama":
            # gemma4 is a "thinking" model: its reasoning can use up the whole token budget and leave an empty answer
            body["reasoning_effort"] = "none"
            body["max_tokens"] = max(max_tokens, 2000)
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        try:
            r = httpx.post(p["url"], json=body, headers=p["headers"], timeout=p["timeout"])
            r.raise_for_status()
            text = re.sub(r"<think>.*?</think>", "", r.json()["choices"][0]["message"]["content"] or "", flags=re.S).strip()
            if not text:
                raise ValueError("empty answer (the model used its tokens thinking)")
            return text, p["name"]
        except Exception as e:  # network down, model missing, rate limit...
            _down[p["name"]] = time.time()
            errors.append(f"{p['name']}: {type(e).__name__} {str(e)[:80]}".strip())
    raise LLMUnavailable("; ".join(errors) or "no LLM provider configured")


def parse_json(text: str) -> dict:
    """Models sometimes wrap JSON in prose or ``` fences; take the outermost object."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("no JSON object in model output")
    return json.loads(m.group(0))
