"""The scholarship application as a LangGraph that pauses for people.

    check_documents -> wait_for_student -> (under 18? wait_for_parent) -> wait_for_submit -> done

The graph stops at every "wait" node and keeps its state in a checkpoint, so it can sit for days and carry on exactly
where it stopped when the student or the parent answers. An event that does not fit where the graph is waiting (a
parent's yes before the student's, a submit before both) is refused. Raah never moves an application on its own.
"""
from __future__ import annotations

from typing import TypedDict

from fastapi import HTTPException, status
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

WAITS = {"wait_for_student": "student_approve", "wait_for_parent": "parent_agree", "wait_for_submit": "student_submit"}
LABELS = {"check_documents": "Check documents", "wait_for_student": "Wait for the student's yes",
          "wait_for_parent": "Wait for the parent's yes", "wait_for_submit": "Wait for the student to submit", "done": "Done"}


class Chain(TypedDict, total=False):
    app_id: int
    minor: bool
    missing: int
    path: list


def check_documents(state: Chain) -> dict:
    return {"path": (state.get("path") or []) + ["check_documents"]}


def wait_for_student(state: Chain) -> dict:
    interrupt({"waiting_for": "student_approve"})
    return {"path": state["path"] + ["wait_for_student"]}


def route_after_student(state: Chain) -> str:
    return "wait_for_parent" if state.get("minor") else "wait_for_submit"


def wait_for_parent(state: Chain) -> dict:
    interrupt({"waiting_for": "parent_agree"})
    return {"path": state["path"] + ["wait_for_parent"]}


def wait_for_submit(state: Chain) -> dict:
    interrupt({"waiting_for": "student_submit"})
    return {"path": state["path"] + ["wait_for_submit"]}


def done(state: Chain) -> dict:
    return {"path": state["path"] + ["done"]}


def build(checkpointer=None):
    g = StateGraph(Chain)
    for name, fn in (("check_documents", check_documents), ("wait_for_student", wait_for_student), ("wait_for_parent", wait_for_parent),
                     ("wait_for_submit", wait_for_submit), ("done", done)):
        g.add_node(name, fn)
    g.add_edge(START, "check_documents")
    g.add_edge("check_documents", "wait_for_student")
    g.add_conditional_edges("wait_for_student", route_after_student, {"wait_for_parent": "wait_for_parent", "wait_for_submit": "wait_for_submit"})
    g.add_edge("wait_for_parent", "wait_for_submit")
    g.add_edge("wait_for_submit", "done")
    g.add_edge("done", END)
    return g.compile(checkpointer=checkpointer)


def graph():
    """The root graph; the application flow is its subgraph, so its pauses are saved with the root's checkpoint."""
    from . import raah_graph
    return raah_graph.root()


def _cfg(app_id: int) -> dict:
    return {"configurable": {"thread_id": f"application-{app_id}"}}


def waiting_for(app_id: int) -> str | None:
    snap = graph().get_state(_cfg(app_id))
    for task in snap.tasks:
        for it in task.interrupts:
            return (it.value or {}).get("waiting_for")
    return None


def ensure(app_id: int, minor: bool, approved: bool, parent_agreed: bool, submitted: bool) -> None:
    """Start the graph for an application, or catch an older one up to what the database already records."""
    g, cfg = graph(), _cfg(app_id)
    if g.get_state(cfg).values:
        return
    g.invoke({"intent": "application", "app_id": app_id, "minor": minor, "path": []}, cfg)
    for flag, event in ((approved, "student_approve"), (parent_agreed and minor, "parent_agree"), (submitted, "student_submit")):
        if flag and waiting_for(app_id) == event:
            g.invoke(Command(resume=True), cfg)


def advance(app_id: int, event: str) -> None:
    """Resume the graph with an event. Refuses an event the graph is not waiting for."""
    have = waiting_for(app_id)
    if have != event:
        detail = {"student_submit": "A parent must agree before this is submitted" if have == "parent_agree" else "Review and approve the application first",
                  "parent_agree": "The student has not approved yet", "student_approve": "Already approved"}.get(event, "Not ready for that step")
        raise HTTPException(status.HTTP_409_CONFLICT, detail)
    graph().invoke(Command(resume=True), _cfg(app_id))


def status_of(app_id: int) -> dict:
    snap = graph().get_state(_cfg(app_id))
    return {"waiting_for": waiting_for(app_id), "path": (snap.values or {}).get("path", []), "framework": "langgraph"}
