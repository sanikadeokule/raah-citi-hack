"""Agentic Ask Raah: raah-data MCP tools, the tool-calling loop, grounding, fallbacks and the SSE endpoint."""
import json
import os

os.environ["RAAH_MCP_TRANSPORT"] = "memory"  # real MCP protocol, no child process in tests

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mcp_servers import data_server as ds  # noqa: E402
from raah import agent, embed, llm, mcp_client  # noqa: E402
from raah.main import app  # noqa: E402

c = TestClient(app)
PROFILE = {"name": "Priya", "class": 10, "gender": "F", "category": "OBC", "family_income_annual": 150000,
           "interests": ["machines"], "taluka": "Junnar", "marks_pct": 72}


@pytest.fixture(autouse=True)
def _no_embeddings(monkeypatch):
    def edown(*a, **k):
        raise embed.EmbedUnavailable("no embedder in tests")
    monkeypatch.setattr(embed, "embed", edown)


def events(r) -> list[dict]:
    return [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]


def ask(question, token=None):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    r = c.post("/api/agent/ask", json={"question": question, "lang": "en", "profile": PROFILE}, headers=h)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    return events(r)


def scripted(turns):
    """A fake tool-calling model: each turn is a list of (tool, args) to call, or a final answer string."""
    seen = []

    def _chat_tools(messages, tools, **kw):
        seen.append({"messages": messages, "tools": tools})
        turn = turns[min(len(seen) - 1, len(turns) - 1)]
        if isinstance(turn, str) or callable(turn):
            return {"role": "assistant", "content": turn(messages) if callable(turn) else turn}, "test"
        return {"role": "assistant", "content": "", "tool_calls": [
            {"id": f"call_{len(seen)}_{i}", "type": "function", "function": {"name": t, "arguments": json.dumps(a)}}
            for i, (t, a) in enumerate(turn)]}, "test"
    return _chat_tools, seen


# ------------------------------------------------------------------ the MCP server

def test_mcp_server_lists_all_tools():
    names = {t["name"] for t in mcp_client.tools()}
    assert {"search_dataset", "rank_careers", "compute_plan", "check_eligibility", "get_scholarships", "nearest_centres",
            "get_colleges", "list_exams", "get_notifications"} <= names
    assert mcp_client.status()["transport"] == "memory" and mcp_client.status()["connected"]


def test_tools_return_dataset_figures():
    top = mcp_client.call("rank_careers", {"profile": PROFILE, "n": 3})["careers"]
    assert len(top) == 3 and top[0]["fit"] == "direct"
    exams = ds.list_exams("electrician")
    assert exams["career"]["name"] == "Electrician" and exams["exams"][0]["official_site"].startswith("http")
    plan = ds.compute_plan(PROFILE, career="electrician")
    assert isinstance(plan["net_cost"], (int, float)) and "payback_months_after_training" in plan
    one = ds.check_eligibility(PROFILE, scheme_id="SCH06")
    assert one["id"] == "SCH06" and one["rules"]
    assert ds.list_exams("zzzz-not-a-career")["error"]


def test_profile_and_user_id_are_never_model_arguments():
    specs = agent.tool_specs(signed_in=False)
    names = {s["function"]["name"] for s in specs}
    assert "get_notifications" not in names  # signed out: no notifications tool at all
    for s in specs:
        assert "profile" not in s["function"]["parameters"].get("properties", {})
    assert "get_notifications" in {s["function"]["name"] for s in agent.tool_specs(signed_in=True)}


# ------------------------------------------------------------------ the loop

def test_agent_calls_tools_streams_steps_and_grounds_answer(monkeypatch):
    def final(messages):
        res = json.loads(messages[-1]["content"].split(" ", 1)[1])
        name = res["exams"][0]["name"]
        return f"First pass Class 10, then apply to {name} [2]."
    fake, seen = scripted([[("rank_careers", {"n": 3})], [("list_exams", {"career": "electrician"})], final])
    monkeypatch.setattr(llm, "chat_tools", fake)
    ev = ask("Which career suits me and when is the admission?")
    assert not [e for e in ev if e["type"] == "error"], ev
    kinds = [e["type"] for e in ev]
    assert kinds[0] == "start" and kinds[-1] == "done"
    steps = [e for e in ev if e["type"] == "step"]
    assert [s["tool"] for s in steps] == ["rank_careers", "list_exams"]
    assert steps[0]["label"] == "Ranking careers" and steps[1]["label"] == "Checking exam dates"
    ans = next(e for e in ev if e["type"] == "answer")
    assert ans["mode"] == "agent/tools" and ans["grounded"] and not ans["fallback"]
    assert ans["citations"][0]["n"] == 2 and ans["citations"][0]["source"].startswith("http")
    # the server, not the model, passed the student's profile to the tool
    tool_msg = next(m for m in seen[1]["messages"] if m["role"] == "tool")
    assert "CAR" in tool_msg["content"]


def test_invented_figure_falls_back_to_rag(monkeypatch):
    fake, _ = scripted([[("get_scholarships", {})], "You will get ₹99,99,999 every year [1]."])
    monkeypatch.setattr(llm, "chat_tools", fake)
    monkeypatch.setattr(llm, "chat", lambda *a, **k: (_ for _ in ()).throw(llm.LLMUnavailable("down")))
    ans = next(e for e in ask("Which scholarship can I get?") if e["type"] == "answer")
    assert ans["mode"] == "rag" and ans["agent_fallback"].startswith("model used a figure")
    assert "99,99,999" not in ans["answer"] and ans["steps"]


def test_stops_after_six_steps(monkeypatch):
    fake, seen = scripted([[("search_dataset", {"query": "iti"})]])  # never answers on its own
    monkeypatch.setattr(llm, "chat_tools", fake)
    monkeypatch.setattr(llm, "chat", lambda *a, **k: ("Raah's data lists ITI admission [1].", "test"))
    ev = ask("tell me about ITI")
    assert len([e for e in ev if e["type"] == "step"]) == agent.MAX_STEPS
    assert len(seen) == agent.MAX_STEPS


def test_json_planner_when_no_function_calling(monkeypatch):
    def no_tools(*a, **k):
        raise llm.ToolsUnsupported("sarvam only")
    replies = iter(['{"tool": "get_scholarships", "args": {}}', '{"answer": "Check the schemes Raah found for you [1]."}'])
    monkeypatch.setattr(llm, "chat_tools", no_tools)
    monkeypatch.setattr(llm, "chat", lambda *a, **k: (next(replies), "sarvam"))
    ans = next(e for e in ask("scholarships for me?") if e["type"] == "answer")
    assert ans["mode"] == "agent/planner" and ans["steps"][0]["tool"] == "get_scholarships" and ans["grounded"]


def test_fixed_workflow_without_any_model(monkeypatch):
    def down(*a, **k):
        raise llm.LLMUnavailable("no provider")
    monkeypatch.setattr(llm, "chat_tools", down)
    monkeypatch.setattr(llm, "chat", down)
    ev = ask("Which colleges are near me for my career?")
    tools = [e["tool"] for e in ev if e["type"] == "step"]
    assert tools[:2] == ["rank_careers", "get_colleges"]
    ans = next(e for e in ev if e["type"] == "answer")
    assert ans["mode"] == "rag" and ans["fallback"] and ans["answer"]


def test_notifications_only_for_signed_in_student(monkeypatch):
    c.post("/api/auth/register", json={"phone": "9812345670", "pin": "4826", "role": "student", "name": "Asha"})
    token = c.post("/api/auth/login", json={"phone": "9812345670", "pin": "4826", "role": "student"}).json()["access_token"]
    fake, _ = scripted([[("get_notifications", {"user_id": 999999})], "You have no new alerts."])
    monkeypatch.setattr(llm, "chat_tools", fake)
    ev = ask("any alerts for me?", token)
    done = next(e for e in ev if e["type"] == "step_done")
    assert done["tool"] == "get_notifications" and done["summary"].startswith("0 notifications")
    # the run is in the audit log for this student
    runs = c.get("/api/agent/runs", headers={"Authorization": f"Bearer {token}"}).json()
    assert runs and runs[0]["question"] == "any alerts for me?" and runs[0]["steps"][0]["tool"] == "get_notifications"
    # signed out, the model cannot read anyone's notifications even if it asks
    assert agent.run_tool("get_notifications", {"user_id": 1}, {}, None)["error"]


def test_mcp_status_endpoint():
    s = c.get("/api/mcp/status").json()
    assert s["server"] == "raah-data" and s["max_steps"] == 6 and "rank_careers" in s["tools"]
