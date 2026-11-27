"""Today's step on the LangGraph agent: the model looks and picks, the check refuses anything off the list, the rule is the safety net."""
import json
import time

import pytest

from raah import auth, db, graph, llm, raah_graph


def _student(name):
    with db.connect() as con:
        return con.execute("INSERT INTO users (phone, name, role, pin_hash, created_at) VALUES (?, ?, 'student', 'x', ?) RETURNING id",
                           (f"9{abs(hash(name)) % 10**9:09d}", name, int(time.time()))).fetchone()["id"]


@pytest.fixture
def chosen_student():
    uid = _student("GraphAsha")
    auth.save_profile(uid, {"class": 10, "category": "OBC", "family_income_annual": 150000, "interests": ["computers"],
                            "roadmap_career": "CAR01", "roadmap_at": "2026-11-26"})
    with db.connect() as con:
        con.execute("INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, 'exam_date', ?, ?)",
                    (uid, json.dumps({"exam_name": "MHT CET"}), int(time.time())))
    yield uid
    with db.connect() as con:
        con.execute("DELETE FROM users WHERE id = ?", (uid,))


def _fake_model(monkeypatch, answers):
    """A model that looks at the profile once, then answers each decide call from `answers` in turn."""
    turn = {"n": 0}

    def chat_tools(messages, tools, **kw):
        if turn["n"] == 0:
            turn["n"] = 1
            return {"content": "", "tool_calls": [{"id": "c1", "function": {"name": "get_student_profile", "arguments": "{}"}}]}, "fake"
        return {"content": "DONE"}, "fake"

    seen = []

    def chat(messages, **kw):
        seen.append(messages[-1]["content"])
        return json.dumps(answers.pop(0)), "fake"

    monkeypatch.setattr(llm, "chat_tools", chat_tools)
    monkeypatch.setattr(llm, "chat", chat)
    return seen


def test_model_chooses_among_true_steps_and_the_trace_is_kept(monkeypatch, chosen_student):
    seen = _fake_model(monkeypatch, [{"step": "step_notice", "reason": "MHT CET date changed"}])
    step = raah_graph.run("today", user_id=chosen_student)
    assert step["key"] == "step_notice" and step["agent"]["mode"] == "model"
    assert step["agent"]["reason"] == "MHT CET date changed" and step["agent"]["framework"] == "langgraph"
    assert any("looked with get_student_profile" in t for t in step["agent"]["trace"])
    assert "step_notice" in seen[0] and "step_find_career" not in seen[0], "only steps that are true are offered"


def test_a_step_off_the_list_is_refused_then_the_rule_is_used(monkeypatch, chosen_student):
    _fake_model(monkeypatch, [{"step": "step_find_career"}, {"step": "step_invented"}])
    step = raah_graph.run("today", user_id=chosen_student)
    assert step["agent"]["mode"] == "rule" and step["key"] == "step_notice"
    assert sum(t.startswith("check: refused") for t in step["agent"]["trace"]) == 2


def test_no_model_means_the_rule_decides(monkeypatch, chosen_student):
    def down(*a, **kw):
        raise llm.ToolsUnsupported("no provider")
    monkeypatch.setattr(llm, "chat_tools", down)
    step = raah_graph.run("today", user_id=chosen_student)
    assert step["agent"]["mode"] == "rule" and step["key"] == "step_notice"


def test_graph_exports_a_diagram():
    mermaid = graph.build().get_graph().draw_mermaid()
    assert "observe" in mermaid and "check" in mermaid


def test_one_root_graph_routes_to_every_flow_and_leaves_no_checkpoints_behind(monkeypatch, chosen_student):
    from raah import raah_graph
    raah_graph.reset()
    g = raah_graph.build().get_graph()
    assert {"route", "today", "ask", "application", "alert"} <= set(g.nodes)
    monkeypatch.setattr(llm, "chat_tools", lambda *a, **k: (_ for _ in ()).throw(llm.ToolsUnsupported("none")))
    step = raah_graph.run("today", user_id=chosen_student)
    assert step["key"] == "step_notice"
    count = raah_graph.saver().conn.execute("SELECT COUNT(*) FROM checkpoints").fetchone()[0]
    assert count == 0, "one-shot runs are not kept"
    with pytest.raises(Exception):
        raah_graph.run("nonsense")


def test_combined_diagram_names_every_flow():
    from raah import raah_graph
    m = raah_graph.diagram()
    for word in ("Today's step", "Ask Raah", "Scholarship application", "Exam date agent", "Route by intent", "Shared:"):
        assert word in m
