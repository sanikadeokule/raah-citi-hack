"""AI layer: validated profile extraction, grounded explanations, fallbacks."""
import json
import os
import tempfile

os.environ.setdefault("RAAH_DB", os.path.join(tempfile.mkdtemp(), "t.db"))

from fastapi.testclient import TestClient  # noqa: E402

from raah import chat, llm  # noqa: E402
from raah.main import app  # noqa: E402

c = TestClient(app)


def fake(reply):
    def _chat(messages, json_mode=False, **kw):
        return (json.dumps(reply) if isinstance(reply, dict) else reply), "test"
    return _chat


def test_turn_keeps_valid_fields_and_drops_bad_ones(monkeypatch):
    monkeypatch.setattr(llm, "chat", fake({
        "reply": "तू कोणत्या तालुक्यात राहतेस?",
        "profile": {"name": "Priya", "age": 15, "class": 10, "gender": "F", "marks_pct": 140,
                    "category": "obc", "taluka": "junnar", "interests": ["helping people", "biology"],
                    "documents": ["caste_certificate", "passport"]},
        "done": False}))
    r = c.post("/api/chat/turn", json={"messages": [{"role": "user", "content": "मी प्रिया"}], "lang": "mr"}).json()
    p = r["profile"]
    assert r["fallback"] is False and r["reply"].startswith("तू")
    assert p["name"] == "Priya" and p["class"] == 10 and p["category"] == "OBC" and p["taluka"] == "Junnar"
    assert "marks_pct" not in p and "marks_pct" in r["rejected"]
    assert p["documents"] == ["caste_certificate"]
    assert p["lat"] and p["lon"]


def test_turn_falls_back_when_no_model(monkeypatch):
    def down(*a, **k):
        raise llm.LLMUnavailable("ollama: ConnectError")
    monkeypatch.setattr(llm, "chat", down)
    r = c.post("/api/chat/turn", json={"messages": [], "lang": "en"}).json()
    assert r["fallback"] is True


def test_turn_handles_json_wrapped_in_prose(monkeypatch):
    monkeypatch.setattr(llm, "chat", fake('Sure! ```json\n{"reply": "How old are you?", "profile": {"name": "Rohan"}, "done": false}\n```'))
    r = c.post("/api/chat/turn", json={"messages": [{"role": "user", "content": "I am Rohan"}]}).json()
    assert r["profile"]["name"] == "Rohan"


def _priya():
    return c.get("/api/data").json()["students"][0]


def test_explain_rejects_invented_numbers(monkeypatch):
    monkeypatch.setattr(llm, "chat", fake("ANM pays ₹99,999 a month, perfect for you."))
    r = c.post("/api/chat/explain", json={"profile": _priya(), "career_id": "CAR25"}).json()
    assert r["fallback"] is True and "Fits you" in r["text"]


def test_explain_accepts_grounded_text(monkeypatch):
    monkeypatch.setattr(llm, "chat", fake("You love helping people and biology, and ANM nursing is all about caring for patients."))
    r = c.post("/api/chat/explain", json={"profile": _priya(), "career_id": "CAR25"}).json()
    assert r["fallback"] is False and "helping people" in r["text"]


def test_grounded_helper():
    assert chat.grounded("costs 4,160", '{"net_cost_rupees": 4160}')
    assert not chat.grounded("costs 5000", '{"net_cost_rupees": 4160}')
