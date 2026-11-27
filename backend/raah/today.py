"""Today's step and the activity log: the first feature on the shared agent core.

The agent reads the student through the same MCP tools Ask Raah uses (profile, notifications, scholarships,
exams), picks the one most useful thing to do today, says why, and logs what it did. The pick is a plain rule over
what the tools returned, so it is the same every time for the same facts; a model can word it later.
Every action is written to agent_activity, which the "What Raah did for you" page lists.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from . import agent, db
from .auth import current_user

router = APIRouter(tags=["agent"])


def log_activity(user_id: int | None, kind: str, text_key: str, vars: dict | None = None, href: str = "", source: str = "") -> None:
    if not user_id:
        return
    try:
        with db.connect() as con:
            con.execute("INSERT INTO agent_activity (user_id, kind, text_key, vars, href, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (int(user_id), kind[:24], text_key[:48], json.dumps(vars or {}, ensure_ascii=False), href[:120], source, int(time.time())))
    except Exception:  # the log must never break the feature that wrote to it
        pass


def _stored_profile(user_id: int) -> dict:
    with db.connect() as con:
        row = con.execute("SELECT data FROM profiles WHERE user_id = ?", (int(user_id),)).fetchone()
    return json.loads(row["data"]) if row else {}


def make_look(user_id: int, profile: dict, looked: list, cache: dict | None = None):
    """A tool caller that records what was looked at and never asks the same question twice."""
    cache = {} if cache is None else cache

    def look(tool: str, args: dict | None = None) -> dict:
        key = (tool, json.dumps(args or {}, sort_keys=True))
        if key in cache:
            return cache[key]
        t0 = time.time()
        res = agent.run_tool(tool, args or {}, profile, user_id)
        cache[key] = res
        looked.append({"tool": tool, "label": agent.labels().get(tool, tool), "summary": agent._short(res), "ms": int((time.time() - t0) * 1000)})
        return res
    return look


def candidates(user_id: int, profile: dict, look, looked: list) -> list[dict]:
    """Every step that makes sense for this student today, best first. The first one is the rule's pick;
    the agent graph lets the model choose among them, so it can never choose something that is not true."""
    out: list[dict] = []
    known = look("get_student_profile").get("profile") or {}
    chosen = bool(profile.get("roadmap_career")) or bool(profile.get("roadmap_at"))
    said = bool((known.get("ikigai") or {}).get("love")) or bool(known.get("interests"))

    # nothing about what they want yet: Discover is the one thing that unlocks the rest
    if not chosen and not said:
        return [_step("step_find_career", "/discover/", looked=looked)]

    # a follow-up that is due ("Did you apply for X?"): the answer changes what the next step should be
    from . import checkins
    t0 = time.time()
    open_ = checkins.due(user_id)
    looked.append({"tool": "get_checkins", "label": "Follow-ups", "summary": f"{len(open_)} due", "ms": int((time.time() - t0) * 1000)})
    if open_:
        c = open_[0]
        out.append(_step(c["text_key"], c["href"], c["vars"], looked=looked))

    notes = look("get_notifications", {"unread_only": True})
    unread = notes.get("unread", 0)
    if unread:
        first = (notes.get("notifications") or [{}])[0]
        out.append(_step("step_notice", "/notifications/", {"n": str(unread), "what": str(first.get("exam_name") or first.get("title") or "")}, looked=looked))

    if not chosen:  # told Raah what they like but never picked a path
        out.append(_step("step_pick_path", "/discover/", looked=looked))
        return out

    schol = look("get_scholarships")
    ready, docs = len(schol.get("eligible") or []), len(schol.get("eligible_missing_docs") or [])
    if ready:
        out.append(_step("step_apply", "/eligibility/", {"n": str(ready)}, looked=looked))
    if docs:
        out.append(_step("step_docs", "/eligibility/", {"n": str(docs)}, looked=looked))

    career = profile.get("roadmap_career") or ""
    exams = look("list_exams", {"career": career}).get("exams") or []
    if exams:
        out.append(_step("step_exam", "/exams/", {"exam": str(exams[0].get("name", "")), "career": career}, source=str(exams[0].get("source") or ""), looked=looked))
    out.append(_step("step_scholarships", "/eligibility/", {"career": career}, looked=looked))
    return out


def decide(user_id: int) -> dict:
    """The rule: look with the tools, then take the first candidate. Used when no model is available."""
    profile = _stored_profile(user_id)
    looked: list[dict] = []
    return candidates(user_id, profile, make_look(user_id, profile, looked), looked)[0]


def _step(key: str, href: str, vars: dict | None = None, source: str = "", looked: list | None = None) -> dict:
    return {"key": key, "href": href, "vars": vars or {}, "source": source, "looked": looked or []}


@router.post("/api/agent/today")
def today(user: dict = Depends(current_user)):
    """Today's step for the signed-in student, decided with the agent's tools. Logged once a day per step."""
    try:
        from . import graph
        step = graph.run_today(user["id"])
    except Exception:  # the graph must never take Today's step down: the rule is always there
        step = decide(user["id"])
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with db.connect() as con:
        last = con.execute("SELECT text_key, vars, created_at FROM agent_activity WHERE user_id = ? AND kind = 'today' ORDER BY id DESC LIMIT 1",
                           (user["id"],)).fetchone()
    same_day = last and datetime.fromtimestamp(last["created_at"], timezone.utc).strftime("%Y-%m-%d") == day
    if not (same_day and last["text_key"] == step["key"] and json.loads(last["vars"] or "{}") == step["vars"]):
        log_activity(user["id"], "today", step["key"], step["vars"], step["href"], step["source"])
    return step


@router.get("/api/activity")
def activity(limit: int = 50, user: dict = Depends(current_user)):
    """What Raah did for this student, newest first. A student sees only their own."""
    limit = max(1, min(limit, 100))
    with db.connect() as con:
        rows = con.execute("SELECT id, kind, text_key, vars, href, source, created_at FROM agent_activity WHERE user_id = ? ORDER BY id DESC LIMIT ?",
                           (user["id"], limit)).fetchall()
    return [{**dict(r), "vars": json.loads(r["vars"] or "{}")} for r in rows]


@router.get("/api/agent/graphs")
def graphs():
    """The agent graphs as Mermaid text, drawn from the code that runs them."""
    from . import chain_graph, graph
    from langgraph.checkpoint.memory import InMemorySaver
    from . import ask_graph, watch_graph
    return {"today": graph.build().get_graph().draw_mermaid(),
            "application": chain_graph.build(InMemorySaver()).get_graph().draw_mermaid(),
            "ask": ask_graph.build().get_graph().draw_mermaid(),
            "exam_alert": watch_graph.build().get_graph().draw_mermaid()}
