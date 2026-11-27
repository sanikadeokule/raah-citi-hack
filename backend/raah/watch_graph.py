"""The exam date agent: cron still reads the official sites; when a date changes, this graph decides what each student hears.

    gather -> draft -> verify -> send

For every student who asked to be told about the exam, the model reads a few facts about them (class, language, chosen
career) and writes one short message in their language, marking it urgent when a deadline is close. The verify node keeps a
message only if every date in it appears in the lines the site actually published; otherwise that student gets the plain
published lines. With no model reachable everyone gets the plain published lines, which is what the watcher always did.
"""
from __future__ import annotations

import json
import operator
import re
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from . import db, llm
from .auth import notify
from .languages import language_name

MAX_DRAFTS = 30  # one model call per student, so a very popular exam falls back to the plain text beyond this
_DATEISH = re.compile(r"\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?\s*\d{0,4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4}")


class Watch(TypedDict, total=False):
    exam: dict
    lines: list
    user_ids: list
    students: dict
    drafts: dict
    plain: str
    mode: str
    sent: int
    trace: Annotated[list, operator.add]


def gather(state: Watch) -> dict:
    out = {}
    with db.connect() as con:
        for uid in state["user_ids"]:
            row = con.execute("SELECT data FROM profiles WHERE user_id = ?", (uid,)).fetchone()
            p = json.loads(row["data"]) if row else {}
            out[uid] = {"class": p.get("class"), "language": p.get("language") or "en", "career": p.get("roadmap_career")}
    return {"students": out, "plain": " · ".join(state["lines"][:3]), "drafts": {}, "mode": "rule",
            "trace": [f"gather: {len(out)} students asked to be told"]}


def draft(state: Watch) -> dict:
    """The model writes each student's message. A failure for one student, or no model at all, leaves them on the plain text."""
    drafts, mode = {}, "rule"
    published = "\n".join(state["lines"][:5])
    for uid in state["user_ids"][:MAX_DRAFTS]:
        s = state["students"][uid]
        lang = language_name(s["language"])
        prompt = (f"An official site just published these lines about {state['exam']['name']}:\n{published}\n\n"
                  f"Student: class {s['class']}, chosen career {s['career'] or 'not chosen yet'}.\n"
                  f"Write one short message in {lang} telling them what changed. Use only dates and facts from the lines above. "
                  'Reply with JSON only: {"urgent": true|false, "message": "..."}. urgent is true only if a date in the lines is within 14 days.')
        try:
            text, _ = llm.chat([{"role": "system", "content": "You write short exam alerts for Indian students. Never invent a date."},
                                {"role": "user", "content": prompt}], json_mode=True, max_tokens=200)
            d = llm.parse_json(text)
            if str(d.get("message", "")).strip():
                drafts[uid] = {"message": str(d["message"]).strip()[:300], "urgent": bool(d.get("urgent"))}
                mode = "model"
        except (llm.LLMUnavailable, ValueError):
            break  # no model: stop asking, everyone else gets the plain text
    return {"drafts": drafts, "mode": mode, "trace": [f"draft: {len(drafts)} messages written by the model"]}


def _dates(text: str) -> set:
    return {re.sub(r"[\s,.]+", "", m.group(0).lower()) for m in _DATEISH.finditer(text)}


def verify(state: Watch) -> dict:
    """A drafted message stays only if each date it mentions was in the published lines."""
    allowed = _dates("\n".join(state["lines"]))
    kept, dropped = {}, 0
    for uid, d in state["drafts"].items():
        if _dates(d["message"]) <= allowed:
            kept[uid] = d
        else:
            dropped += 1
    return {"drafts": kept, "trace": [f"verify: {len(kept)} kept, {dropped} dropped for a date the site did not publish"]}


def send(state: Watch) -> dict:
    from .today import log_activity
    exam = state["exam"]
    for uid in state["user_ids"]:
        d = state["drafts"].get(uid)
        payload = {"exam_id": exam["id"], "exam_name": exam["name"], "site": exam["site"], "body": d["message"] if d else state["plain"]}
        if d:
            payload["agent"] = "model"
            if d["urgent"]:
                payload["urgent"] = True
        notify([uid], "exam_update", payload)
        log_activity(uid, "learned", "act_exam_alert", {"exam": exam["name"]}, "/notifications/")
    return {"sent": len(state["user_ids"]), "trace": [f"send: {len(state['user_ids'])} notified"]}


def build():
    g = StateGraph(Watch)
    for name, fn in (("gather", gather), ("draft", draft), ("verify", verify), ("send", send)):
        g.add_node(name, fn)
    g.add_edge(START, "gather")
    g.add_edge("gather", "draft")
    g.add_edge("draft", "verify")
    g.add_edge("verify", "send")
    g.add_edge("send", END)
    return g.compile()


_GRAPH = None


def run(exam: dict, new_lines: list[str], user_ids: list[int]) -> dict:
    global _GRAPH
    _GRAPH = _GRAPH or build()
    out = _GRAPH.invoke({"exam": exam, "lines": new_lines, "user_ids": user_ids, "trace": []})
    return {"notified": out["sent"], "mode": out["mode"], "trace": out["trace"]}
