"""AI layer: validated profile extraction, grounded explanations, fallbacks."""
import json
import os


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


def test_marks_percentage_comes_from_obtained_and_total(monkeypatch):
    # the model's own arithmetic is ignored; 412 out of 500 is 82.4%
    monkeypatch.setattr(llm, "chat", fake({"reply": "ok", "done": False, "profile": {
        "marks_exam": "class9_final", "marks_obtained": 412, "marks_total": 500, "marks_pct": 90}}))
    r = c.post("/api/chat/turn", json={"messages": [{"role": "user", "content": "500 पैकी 412"}], "lang": "mr"}).json()
    p = r["profile"]
    assert p["marks_exam"] == "class9_final" and p["marks_pct"] == 82.4


def test_unit_test_marks_are_refused(monkeypatch):
    # 25/25 in a unit test must not become 100%
    monkeypatch.setattr(llm, "chat", fake({"reply": "ok", "done": False, "profile": {
        "marks_exam": "unit_test", "marks_obtained": 25, "marks_total": 25, "marks_pct": 100}}))
    r = c.post("/api/chat/turn", json={"messages": [{"role": "user", "content": "25/25"}]}).json()
    p = r["profile"]
    assert "marks_pct" not in p and "marks_exam" not in p
    assert {"marks_total", "marks_pct", "marks_exam"} <= set(r["rejected"])
    assert r["missing"][:2] == ["name", "age"] and "marks_pct" in r["missing"]


def test_marks_obtained_above_total_is_refused():
    clean, rejected = chat.validate_profile({"marks_obtained": 520, "marks_total": 500}, [], [])
    assert "marks_pct" not in clean and "marks_total" in rejected


def test_missing_fields_respects_dont_remember_and_no_documents():
    m = chat.missing_fields({"marks_exam": "unknown", "documents": [], "documents_none": True})
    assert "marks_pct" not in m and "documents" not in m and "marks_exam" not in m
    assert chat.missing_fields({})[:7] == ["name", "age", "gender", "class", "interests", "marks_exam", "marks_pct"]


def test_prompt_names_the_exam_and_skips_known_name(monkeypatch):
    seen = {}

    def spy(messages, json_mode=False, **kw):
        seen["system"] = messages[0]["content"]
        return json.dumps({"reply": "ok", "profile": {}, "done": False}), "test"
    monkeypatch.setattr(llm, "chat", spy)
    prof = {"name": "Sanika", "age": 15, "gender": "F", "class": 10, "interests": ["farming"]}
    c.post("/api/chat/turn", json={"messages": [], "profile": prof})
    s = seen["system"]
    assert "Next question to ask: marks_exam" in s and "unit test" in s
    assert "Sanika. Do not ask it again" in s


def test_typed_taluka_not_in_list_is_kept_without_map_point():
    clean, rejected = chat.validate_profile({"taluka": "sangamner"}, ["Junnar", "Ambegaon"], [])
    assert clean["taluka"] == "Sangamner" and not rejected
    clean, _ = chat.validate_profile({"taluka": "junnar taluka"}, ["Junnar", "Ambegaon"], [])
    assert clean["taluka"] == "Junnar"
    _, rejected = chat.validate_profile({"taluka": "12345"}, ["Junnar"], [])
    assert rejected == ["taluka"]


def test_age_that_does_not_fit_class_is_questioned():
    assert chat.age_fits_class(16, 11) and chat.age_fits_class(14, 10) and chat.age_fits_class(17, 10)
    assert not chat.age_fits_class(16, 8) and not chat.age_fits_class(12, 10)
    p = {"name": "S", "age": 16, "gender": "F", "class": 8}
    assert chat.missing_fields(p)[0] == "age_class_ok"
    assert "age_class_ok" not in chat.missing_fields({**p, "age_class_ok": True})
    assert "age_class_ok" not in chat.missing_fields({**p, "class": 11})


def test_plain_answers_are_read_before_the_model():
    from raah import chat
    base = {"name": "S", "age": 15, "gender": "F"}
    assert chat.pre_extract(base, "im in ckass 10, ill go to 11", "")["class"] == 10
    p = {**base, "class": 10, "interests": ["computers"]}
    q = "Now, tell me about your Class 10 Board exam. How many marks out of 400?"
    r = chat.pre_extract(p, "in hsc class 10 i got 68%", q)
    assert (r["marks_exam"], r["marks_pct"]) == ("class10_board", 68.0)
    r = chat.pre_extract(p, "340 out of 400", q)
    assert r["marks_pct"] == 85.0 and r["marks_total"] == 400
    assert "marks_pct" not in chat.pre_extract(p, "25 out of 25", q)
