"""Ask Raah as a LangGraph: plan (the model picks tools), tools, answer, check, and a retry when the check fails.

    plan -> tools -> plan ... -> answer -> check -> done
                                   ^          |
                                   +-- retry -+   (once, when a figure in the answer came from no tool)

Events (step, step_done) are streamed from inside the nodes, so the page shows each tool call as it happens.
The same fallbacks as before are kept: JSON planner for providers without function calling, the fixed workflow
when no model answers, and the one-shot RAG answer when the check still fails after the retry.
"""
from __future__ import annotations

import json
import time
from typing import Any, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from . import agent, llm, mcp_client, rag


class Ask(TypedDict, total=False):
    body: Any
    lang: str
    profile: dict
    user_id: int | None
    signed_in: bool
    specs: list
    msgs: list
    steps: list
    results: list
    mode: str          # tools | planner | fixed
    provider: str | None
    answer: str | None
    last_answer: str | None
    feedback: str | None
    rounds: int
    retries: int
    out: dict
    trace: list


def _do_step(state: Ask, name: str, args: dict):
    steps, results = state["steps"], state["results"]
    n = len(steps) + 1
    label = agent.labels().get(name, name)
    ev = {"type": "step", "n": n, "tool": name, "label": label, "args": {k: v for k, v in args.items() if k not in agent.INJECTED}}
    started = time.time()
    res = agent.run_tool(name, args, state["profile"], state["user_id"])
    step = {**ev, "summary": agent._short(res), "ms": int((time.time() - started) * 1000), "source": agent._first_source(res)}
    steps.append(step)
    results.append(res)
    return ev, {**step, "type": "step_done"}, res


def plan(state: Ask) -> dict:
    """One model turn. Tool calls run here and stream their events; no tool call means the model has answered."""
    write, msgs, mode = get_stream_writer(), state["msgs"], state["mode"]
    t = lambda note: state.get("trace", []) + [note]  # noqa: E731
    try:
        if mode == "tools":
            msg, provider = llm.chat_tools(msgs, state["specs"])
            calls = msg.get("tool_calls") or []
            if not calls:
                return {"answer": msg.get("content") or "", "provider": provider, "trace": t("plan: the model answered")}
            msgs.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
            for c in calls[:4]:
                try:
                    args = json.loads(c["function"].get("arguments") or "{}")
                except ValueError:
                    args = {}
                ev, done, res = _do_step(state, c["function"]["name"], args if isinstance(args, dict) else {})
                write(ev), write(done)
                msgs.append({"role": "tool", "tool_call_id": c["id"], "content": f"[{done['n']}] " + json.dumps(res, ensure_ascii=False)[:agent.RESULT_CHARS]})
            return {"rounds": state["rounds"] + 1, "provider": provider, "trace": t("plan: called " + ", ".join(c["function"]["name"] for c in calls[:4]))}
        text, provider = llm.chat(agent._planner_messages(msgs, state["specs"]), json_mode=True, max_tokens=700)
        step = llm.parse_json(text)
        if step.get("answer") or not step.get("tool"):
            return {"answer": str(step.get("answer") or ""), "provider": provider, "trace": t("plan: the model answered")}
        ev, done, res = _do_step(state, str(step["tool"]), step.get("args") if isinstance(step.get("args"), dict) else {})
        write(ev), write(done)
        msgs.append({"role": "assistant", "content": json.dumps({"tool": step["tool"], "args": step.get("args", {})})})
        msgs.append({"role": "user", "content": f"Result [{done['n']}]: " + json.dumps(res, ensure_ascii=False)[:agent.RESULT_CHARS]})
        return {"rounds": state["rounds"] + 1, "provider": provider, "trace": t(f"plan: called {step['tool']}")}
    except llm.ToolsUnsupported:
        return {"mode": "planner", "trace": t("plan: no function calling, planning in JSON")}
    except (llm.LLMUnavailable, ValueError, json.JSONDecodeError):
        return {"mode": "fixed", "trace": t("plan: no model, using the fixed workflow")}


def route_plan(state: Ask) -> str:
    if state["mode"] == "fixed":
        return "fixed"
    if state.get("answer") is not None:
        return "check"
    return "answer" if state["rounds"] >= agent.MAX_STEPS else "plan"


def answer(state: Ask) -> dict:
    """The step budget is used up, or the check sent the model back: answer from what the tools found, no more tools."""
    msgs = state["msgs"]
    msgs.append({"role": "user", "content": state.get("feedback") or "Answer the question now from the tool results above, with [n] numbers."})
    try:
        text, provider = llm.chat(agent._flatten(msgs), temperature=0.2, max_tokens=600)
        return {"answer": text, "provider": provider, "feedback": None, "trace": state.get("trace", []) + ["answer: asked for the answer from the tool results"]}
    except llm.LLMUnavailable:
        if state.get("last_answer"):  # the retry could not run: judge the first answer as it was
            return {"answer": state["last_answer"], "feedback": None, "trace": state.get("trace", []) + ["answer: model gone on retry, keeping the first answer"]}
        return {"mode": "fixed", "answer": None, "trace": state.get("trace", []) + ["answer: no model, using the fixed workflow"]}


def fixed(state: Ask) -> dict:
    write = get_stream_writer()
    for name, args in agent.fixed_plan(state["body"].question, state["signed_in"]):
        if len(state["steps"]) >= agent.MAX_STEPS:
            break
        ev, done, _ = _do_step(state, name, args)
        write(ev), write(done)
    return {"answer": None, "trace": state.get("trace", []) + ["fixed: ran the fixed workflow"]}


def check(state: Ask) -> dict:
    """Is every figure in the answer one a tool returned? If not, the model gets one more go with that said plainly."""
    ans = (state.get("answer") or "").strip()
    context = "\n".join(json.dumps(r, ensure_ascii=False) for r in state["results"]) + f"\n{state['body'].question}\n{json.dumps(state['profile'])}"
    if ans and not rag.grounded(ans, context) and state.get("retries", 0) < 1 and state["mode"] != "fixed":
        return {"retries": 1, "answer": None, "last_answer": ans, "feedback": "Your answer used a figure that no tool returned. Answer again using only figures from the tool results above, with [n] numbers.",
                "trace": state.get("trace", []) + ["check: a figure came from no tool, asking again"]}
    return {"trace": state.get("trace", []) + ["check: answer is grounded" if ans else "check: nothing to ground"]}


def route_check(state: Ask) -> str:
    return "answer" if state.get("feedback") and state.get("answer") is None and state["mode"] != "fixed" else "finish"


def finish(state: Ask) -> dict:
    out = agent.finish(state["body"], state.get("answer") if state["mode"] != "fixed" else None, state["results"], state["steps"],
                       state["profile"], state["mode"], state.get("provider"))
    out["graph"] = {"framework": "langgraph", "trace": state.get("trace", []) + ["finish: " + out["mode"]]}
    return {"out": out}


def build():
    g = StateGraph(Ask)
    for name, fn in (("plan", plan), ("answer", answer), ("fixed", fixed), ("check", check), ("finish", finish)):
        g.add_node(name, fn)
    g.add_edge(START, "plan")
    g.add_conditional_edges("plan", route_plan, {"plan": "plan", "answer": "answer", "check": "check", "fixed": "fixed"})
    g.add_edge("answer", "check")
    g.add_edge("fixed", "finish")
    g.add_conditional_edges("check", route_check, {"answer": "answer", "finish": "finish"})
    g.add_edge("finish", END)
    return g.compile()


_GRAPH = None


def run(body, profile: dict, user_id: int | None, signed_in: bool, msgs: list, specs: list):
    """Stream the graph: yields the step events as they happen, then ('out', result) at the end."""
    global _GRAPH
    _GRAPH = _GRAPH or build()
    init = {"body": body, "profile": profile, "user_id": user_id, "signed_in": signed_in, "specs": specs, "msgs": msgs,
            "steps": [], "results": [], "mode": "tools", "provider": None, "answer": None, "rounds": 0, "retries": 0, "trace": []}
    final: dict = {}
    for kind, data in _GRAPH.stream(init, {"recursion_limit": 40}, stream_mode=["custom", "values"]):
        if kind == "custom":
            yield data
        else:
            final = data
    yield {"type": "_out", "out": final["out"]}
