"""The agent graph: look, decide, check, log, as a LangGraph state machine.

Today's step runs on it. The model first looks at the student with the same MCP tools Ask Raah uses (it chooses which,
up to MAX_LOOKS rounds). Raah then builds the list of steps that are true for this student today. The model picks one
and says why. A check node refuses anything not on that list and sends the model back once; after that, or when no
model is reachable, the rule's first choice is used. The graph keeps a trace of every node it passed, which the
app shows, so nothing the agent did is hidden.
"""
from __future__ import annotations

import json
import operator
import os
from pathlib import Path
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from . import agent, llm, today

MAX_LOOKS = 3
LANG_NAME = {"en": "English", "hi": "Hindi", "mr": "Marathi"}
_EN: dict = {}


def _words(key: str, vars: dict) -> str:
    """English wording of a step, so the model reads what the student would read."""
    if not _EN:
        try:
            _EN.update(json.loads((Path(__file__).resolve().parents[2] / "web" / "locales" / "en.json").read_text(encoding="utf-8")))
        except OSError:
            pass
    s = _EN.get(key, key)
    for a, b in (vars or {}).items():
        s = s.replace("{" + a + "}", str(b))
    return s


class State(TypedDict, total=False):
    user_id: int
    profile: dict
    lang: str
    msgs: list
    rounds: int
    offline: bool
    looked: list
    cache: dict
    options: list
    pick: dict
    reason: str
    tries: int
    feedback: str
    mode: str
    provider: str
    trace: Annotated[list, operator.add]


def _look(state: State):
    return today.make_look(state["user_id"], state["profile"], state["looked"], state["cache"])


# ------------------------------------------------------------------ nodes

def observe(state: State) -> dict:
    """The model decides which tools to look with. No tool call means it has seen enough."""
    msgs = state["msgs"]
    try:
        msg, provider = llm.chat_tools(msgs, agent.tool_specs(True))
    except llm.LLMUnavailable:
        return {"offline": True, "trace": ["observe: no model, using the rule"]}
    calls = (msg.get("tool_calls") or [])[:3] if state["rounds"] < MAX_LOOKS else []
    if not calls:
        return {"provider": provider, "rounds": MAX_LOOKS, "trace": ["observe: enough looked at"]}
    msgs = msgs + [{"role": "assistant", "content": msg.get("content") or "", "tool_calls": msg["tool_calls"][:3]}]
    look, names = _look(state), []
    for c in calls:
        try:
            args = json.loads(c["function"].get("arguments") or "{}")
        except ValueError:
            args = {}
        name = c["function"]["name"]
        res = look(name, args if isinstance(args, dict) else {}) if name in {t["function"]["name"] for t in agent.tool_specs(True)} else {"error": "unknown tool"}
        names.append(name)
        msgs.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(res, ensure_ascii=False)[:1500]})
    return {"msgs": msgs, "rounds": state["rounds"] + 1, "provider": provider, "trace": ["observe: looked with " + ", ".join(names)]}


def options(state: State) -> dict:
    """Raah's own list of what is true today. Tools the model skipped are called here, so the facts are never missing."""
    opts = today.candidates(state["user_id"], state["profile"], _look(state), state["looked"])
    return {"options": opts, "trace": [f"options: {len(opts)} steps are true today"]}


def decide(state: State) -> dict:
    opts = state["options"]
    if state.get("offline") or len(opts) == 1:
        why = "only one step applies" if len(opts) == 1 and not state.get("offline") else "no model reachable"
        return {"pick": opts[0], "mode": "rule", "reason": "", "trace": [f"decide: {opts[0]['key']} ({why})"]}
    listing = "\n".join(f"{i + 1}. {o['key']}: {_words(o['key'], o['vars'])}" for i, o in enumerate(opts))
    lang = LANG_NAME.get(state.get("lang", "en"), "English")
    prompt = ("Pick the ONE step this student should do today. Choose only from this list, using the key exactly:\n"
              f"{listing}\n\nReply with JSON only: {{\"step\": \"<key>\", \"reason\": \"<one short sentence in {lang} saying why this, "
              "using only facts you saw>\"}}." + (f"\nYour last answer was refused: {state['feedback']}" if state.get("feedback") else ""))
    try:
        text, provider = llm.chat(state["msgs"] + [{"role": "user", "content": prompt}], json_mode=True, max_tokens=300)
        data = llm.parse_json(text)
    except (llm.LLMUnavailable, ValueError):
        return {"pick": opts[0], "mode": "rule", "reason": "", "trace": ["decide: model gave no usable answer, using the rule"]}
    chosen = next((o for o in opts if o["key"] == str(data.get("step", ""))), None)
    return {"pick": chosen or {"key": str(data.get("step", "")), "bad": True}, "mode": "model", "provider": provider,
            "reason": str(data.get("reason") or "")[:240], "tries": state.get("tries", 0) + 1,
            "trace": [f"decide: model chose {data.get('step')}"]}


def check(state: State) -> dict:
    pick = state["pick"]
    if not pick.get("bad"):
        return {"trace": ["check: step is on the list"]}
    if state.get("tries", 0) < 2:
        return {"feedback": f"{pick['key']!r} is not on the list", "trace": ["check: refused, asking again"]}
    return {"pick": state["options"][0], "mode": "rule", "reason": "", "trace": ["check: refused twice, using the rule"]}


def route_observe(state: State) -> str:
    return "options" if state.get("offline") or state["rounds"] >= MAX_LOOKS else "observe"


def route_check(state: State) -> str:
    return "decide" if state["pick"].get("bad") else END


def build():
    g = StateGraph(State)
    for name, fn in (("observe", observe), ("options", options), ("decide", decide), ("check", check)):
        g.add_node(name, fn)
    g.add_edge(START, "observe")
    g.add_conditional_edges("observe", route_observe, {"observe": "observe", "options": "options"})
    g.add_edge("options", "decide")
    g.add_edge("decide", "check")
    g.add_conditional_edges("check", route_check, {"decide": "decide", END: END})
    return g.compile()


_GRAPH = None


def run_today(user_id: int) -> dict:
    """Today's step through the graph. Returns the step plus how it was chosen and the trace."""
    global _GRAPH
    _GRAPH = _GRAPH or build()
    profile = today._stored_profile(user_id)
    lang = profile.get("language") or "en"
    agent.mcp_client.start()
    system = ("You are Raah's planner for one Indian student. Decide what they should do today. First look with the tools "
              "(a few calls at most: their profile, alerts, scholarships, exams as you judge useful). When you have seen enough, "
              "reply with the word DONE and nothing else. Never invent facts.\n"
              f"What the app already knows: {json.dumps(agent._clean_profile(profile), ensure_ascii=False)}")
    out = _GRAPH.invoke({"user_id": user_id, "profile": profile, "lang": lang, "msgs": [{"role": "system", "content": system},
                         {"role": "user", "content": "What should I do today?"}], "rounds": 0, "looked": [], "cache": {},
                         "options": [], "tries": 0, "trace": []}, {"recursion_limit": 25})
    step = {**out["pick"], "looked": out["looked"]}
    step["agent"] = {"mode": out.get("mode", "rule"), "reason": out.get("reason", ""), "trace": out["trace"], "framework": "langgraph"}
    return step
