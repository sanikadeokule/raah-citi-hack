"""The one agent graph: every request enters here and is routed by intent to the flow that handles it.

                      +-> today        Today's step: look, options, decide, check
    START -> route ---+-> ask          Ask Raah: plan, tools, answer, check, retry
                      +-> application  Scholarship chain: pauses for the student and the parent
                      +-> alert        Exam date agent: gather, draft, verify, send

All four share the same MCP tools, the same model layer and the same activity log. The application branch is a real
subgraph with its own pauses, saved in one checkpoint file; the other three run to the end and leave nothing behind.
"""
from __future__ import annotations

import os
import sqlite3
import uuid
from typing import Any, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

INTENTS = ("today", "ask", "application", "alert")


class Root(TypedDict, total=False):
    intent: str
    args: dict
    result: Any
    app_id: int      # the application subgraph's own state, shared by name
    minor: bool
    path: list


def route(state: Root) -> dict:
    return {}


def pick(state: Root) -> str:
    intent = state.get("intent")
    if intent not in INTENTS:
        raise ValueError(f"unknown intent {intent!r}")
    return intent


def today_node(state: Root) -> dict:
    from . import graph
    return {"result": graph.run_today(state["args"]["user_id"])}


def ask_node(state: Root) -> dict:
    from . import ask_graph
    write, out = get_stream_writer(), None
    a = state["args"]
    for ev in ask_graph.run(a["body"], a["profile"], a["user_id"], a["signed_in"], a["msgs"], a["specs"]):
        if ev["type"] == "_out":
            out = ev["out"]
        else:
            write(ev)
    return {"result": out}


def alert_node(state: Root) -> dict:
    from . import watch_graph
    a = state["args"]
    return {"result": watch_graph.run(a["exam"], a["lines"], a["user_ids"])}


def build(checkpointer=None):
    from . import chain_graph
    g = StateGraph(Root)
    g.add_node("route", route)
    g.add_node("today", today_node)
    g.add_node("ask", ask_node)
    g.add_node("alert", alert_node)
    g.add_node("application", chain_graph.build())
    g.add_edge(START, "route")
    g.add_conditional_edges("route", pick, {i: i for i in INTENTS})
    for i in INTENTS:
        g.add_edge(i, END)
    return g.compile(checkpointer=checkpointer)


_root = None
_saver = None


def saver() -> SqliteSaver:
    global _saver
    if _saver is None:
        path = os.environ.get("RAAH_GRAPH_DB") or (":memory:" if os.environ.get("RAAH_TESTING") else
                                                    os.path.join(os.path.dirname(os.path.dirname(__file__)), "raah_graph.db"))
        _saver = SqliteSaver(sqlite3.connect(path, check_same_thread=False))
    return _saver


def root():
    global _root
    if _root is None:
        _root = build(saver())
    return _root


def reset() -> None:
    """Forget the compiled graph and the checkpoint connection (tests reuse application ids)."""
    global _root, _saver
    _root = _saver = None


def run(intent: str, **args) -> Any:
    """Run a one-shot flow (today, alert) through the root graph and return its result."""
    thread = f"run-{uuid.uuid4().hex}"
    try:
        return root().invoke({"intent": intent, "args": args}, {"configurable": {"thread_id": thread}})["result"]
    finally:
        saver().delete_thread(thread)


def stream(intent: str, **args):
    """Stream a flow through the root graph: yields its custom events, then {"type": "_out", "out": result}."""
    thread = f"run-{uuid.uuid4().hex}"
    out = None
    try:
        for kind, data in root().stream({"intent": intent, "args": args}, {"configurable": {"thread_id": thread}, "recursion_limit": 60},
                                        stream_mode=["custom", "values"]):
            if kind == "custom":
                yield data
            else:
                out = data.get("result", out)
        yield {"type": "_out", "out": out}
    finally:
        saver().delete_thread(thread)


def diagram() -> str:
    """One Mermaid diagram of the whole agent: the router, the four flows drawn from their own graphs, and what they share."""
    from . import ask_graph, chain_graph, graph, watch_graph
    flows = [("today", "Today's step", graph.build()), ("ask", "Ask Raah", ask_graph.build()),
             ("application", "Scholarship application", chain_graph.build()), ("alert", "Exam date agent", watch_graph.build())]
    lines = ["flowchart TD", '  req(["A request: student, parent or the exam watcher"])', "  route{{Route by intent}}", "  req --> route"]
    for key, title, g in flows:
        d = g.get_graph()
        lines.append(f'  subgraph {key.upper()}["{title}"]')
        for nid in d.nodes:
            if nid not in ("__start__", "__end__"):
                lines.append(f'    {key}__{nid}["{nid.replace("_", " ")}"]')
        lines.append("  end")
        for e in d.edges:
            a, b = e.source, e.target
            if a == "__start__":
                lines.append(f"  route --> {key}__{b}")
            elif b == "__end__":
                lines.append(f"  {key}__{a} --> done")
            else:
                lines.append(f"  {key}__{a} {'-.->' if e.conditional else '-->'} {key}__{b}")
    lines += ['  done(["Result, and a line in What Raah did for you"])',
              '  shared[["Shared: MCP tools, model layer with fallbacks, activity log"]]',
              "  shared -.-> TODAY", "  shared -.-> ASK", "  shared -.-> APPLICATION", "  shared -.-> ALERT"]
    return "\n".join(lines)
