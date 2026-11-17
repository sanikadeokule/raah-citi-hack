"""A 'thinking' Ollama model (gemma4) must not break the AI chat."""
import pytest

from raah import llm


class Resp:
    def __init__(self, content):
        self._c = content
    def raise_for_status(self): pass
    def json(self): return {"choices": [{"message": {"content": self._c}}]}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDERS", "ollama")
    llm._down.clear()


def test_ollama_request_turns_off_thinking_and_allows_more_tokens(monkeypatch):
    seen = {}
    def post(url, json, **kw):
        seen.update(json); return Resp("hello")
    monkeypatch.setattr(llm.httpx, "post", post)
    assert llm.chat([{"role": "user", "content": "hi"}], max_tokens=600)[0] == "hello"
    assert seen["reasoning_effort"] == "none" and seen["max_tokens"] >= 2000


def test_think_tags_are_stripped(monkeypatch):
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: Resp("<think>plan</think>{\"a\": 1}"))
    assert llm.parse_json(llm.chat([{"role": "user", "content": "x"}], json_mode=True)[0]) == {"a": 1}


def test_empty_answer_reports_reason(monkeypatch):
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: Resp(""))
    with pytest.raises(llm.LLMUnavailable, match="empty answer"):
        llm.chat([{"role": "user", "content": "x"}])
