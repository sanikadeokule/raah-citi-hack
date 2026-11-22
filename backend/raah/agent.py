"""Agentic Ask Raah: a tool-calling loop over the raah-data MCP server.

    question + profile + tool list  ->  LLM  ->  tool call (through MCP)  ->  result back to the LLM  ->  ...
    stop when the model answers or after MAX_STEPS tool rounds, then check every number in the answer
    against the tool results ("AI explains, data decides").

Each step is streamed to the Ask page as a Server-Sent Event, so the student (and the judges) see Raah
work: "Checking eligibility... Ranking careers...". Three ways to run, so Ask Raah never breaks:
  1. tools     the model uses OpenAI-style function calling (OpenAI, Groq, Ollama)
  2. planner   a model without function calling replies {"tool": ..., "args": ...} or {"answer": ...} as JSON
  3. fixed     no model answers: a fixed tool chain picked from the question's words, then the matching
               dataset rows (the one-shot RAG fallback) as the answer
If the model's answer has a figure that no tool returned, the one-shot RAG answer (/api/ask) is used instead.
"""
from __future__ import annotations

import json
import re
import time
from typing import Iterator

import jwt
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials

from . import db, llm, mcp_client, rag
from .auth import SIGNING_KEY, bearer, current_user

router = APIRouter(tags=["ai"])

MAX_STEPS = 6
RESULT_CHARS = 6000  # a tool result longer than this is cut before it goes back to the model
LANG_NAME = {"mr": "Marathi", "hi": "Hindi", "en": "English"}
PROFILE_FIELDS = ("name", "class", "age", "gender", "category", "family_income_annual", "taluka", "lat", "lon", "marks_pct",
                  "interests", "can_stay_hostel", "max_commute_km", "documents", "exams_passed", "disability_pct")
# filled in by the server, never by the model: the student's own profile and account
INJECTED = ("profile", "user_id")


def labels() -> dict:
    from mcp_servers.data_server import LABELS
    from mcp_servers.notices_server import LABELS as NOTICE_LABELS
    return {**LABELS, **NOTICE_LABELS}


# ------------------------------------------------------------------ tool specs for the model

def tool_specs(signed_in: bool) -> list[dict]:
    """MCP tools as OpenAI function specs, without the arguments the server fills in itself."""
    out = []
    for t in mcp_client.tools():
        if t["name"] == "get_notifications" and not signed_in:
            continue
        schema = json.loads(json.dumps(t["input_schema"]))
        for k in INJECTED:
            schema.get("properties", {}).pop(k, None)
        schema["required"] = [r for r in schema.get("required", []) if r not in INJECTED]
        for prop in schema.get("properties", {}).values():
            prop.pop("title", None)
        schema.pop("title", None)
        out.append({"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": schema}})
    return out


def system_prompt(lang: str, profile: dict, signed_in: bool) -> str:
    return (f"You are Raah, a career guide for rural students, parents and teachers in Maharashtra. Answer in "
            f"{LANG_NAME.get(lang, 'English')} in short, simple sentences a Class 9 student understands.\n"
            + llm.off_topic_rule(lang) +
            "Read the whole conversation and the student's profile first. If they already told you something that "
            "answers your question (even in passing or with spelling mistakes), use it; never ask them to repeat it. "
            "Ask a question back only when a needed fact is truly missing, and ask just one.\n"
            "You have tools over Raah's verified dataset. Before answering anything about careers, costs, scholarships, "
            "colleges, training centres or exams, call the tools you need (one or several, in any order); for any other "
            "fact use search_dataset. The student's profile is passed to every tool automatically.\n"
            "For news, new dates, deadlines or updates from official sites (NTA, JEE, NEET, CET Cell, MahaDBT) use "
            "latest_notices, and read_notice to open one notice; give the official link.\n"
            f"Use at most {MAX_STEPS} rounds of tool calls, then answer.\n"
            "Each tool result is numbered [1], [2]... in the order you called them. After each fact write the number "
            "of the result it came from, like [2].\n"
            "Copy every amount, date, percentage and limit exactly as a tool returned it (same digits); never add up, "
            "convert, round or estimate. If the tools do not have the answer, say Raah's data does not have it and "
            "suggest asking the teacher. Call a figure marked 'Estimate' an estimate.\n"
            + ("" if signed_in else "The student is not signed in, so their notifications cannot be read.\n")
            + f"Student profile: {json.dumps(profile, ensure_ascii=False)}")


# ------------------------------------------------------------------ running one tool

def _short(result: dict) -> str:
    """One line for the step bubble: what the tool found."""
    if not isinstance(result, dict):
        return ""
    if result.get("error"):
        return "no match"
    for key, word in (("careers", "careers"), ("schemes", "schemes"), ("centres", "centres"), ("exams", "exams"),
                      ("rows", "rows"), ("notifications", "notifications"), ("notices", "notices"), ("dates", "dates")):
        if isinstance(result.get(key), list):
            n = len(result[key])
            names = [x.get("name") or x.get("title") for x in result[key][:2] if isinstance(x, dict)]
            names = [s for s in names if s]
            return f"{n} {word}" + (f": {', '.join(names)}" if names else "")
    if "eligible" in result:
        return f"{len(result['eligible'])} eligible, {len(result['eligible_missing_docs'])} need documents"
    if "net_cost" in result:
        return f"net cost ₹{result['net_cost']:,}" if isinstance(result["net_cost"], (int, float)) else "plan worked out"
    if result.get("status"):
        return str(result["status"])
    return "done"


def _first_source(result) -> str:
    text = json.dumps(result, ensure_ascii=False)
    m = re.search(r"https?://[^\s\"';]+", text)
    return m.group(0) if m else ""


def run_tool(name: str, args: dict, profile: dict, user_id: int | None) -> dict:
    args = {k: v for k, v in (args or {}).items() if k not in INJECTED}
    if name == "get_notifications":
        if not user_id:
            return {"error": "the student is not signed in"}
        args["user_id"] = user_id
    else:
        tool = next((t for t in mcp_client.tools() if t["name"] == name), None)
        if tool is None:
            return {"error": f"unknown tool {name}"}
        if "profile" in tool["input_schema"].get("properties", {}):
            args["profile"] = profile
    return mcp_client.call(name, args)


# ------------------------------------------------------------------ fixed workflow (no model)

FIXED = [  # (words in the question, tool, args)
    (r"scholar|शिष्यवृत्ती|छात्रवृत्ति|स्कॉलरशिप|scheme|योजना", "get_scholarships", {}),
    (r"eligib|पात्र|qualif", "check_eligibility", {}),
    (r"college|centre|center|iti|polytechnic|कॉलेज|महाविद्यालय|केंद्र", "get_colleges", {}),
    (r"exam|cet|neet|jee|परीक्षा|admission|प्रवेश", "list_exams", {}),
    (r"cost|fee|payback|afford|खर्च|फी|शुल्क", "compute_plan", {}),
    (r"career|job|करिअर|करियर|नोकरी|नौकरी|work|become", "rank_careers", {"n": 5}),
    (r"notification|alert|सूचना|update", "get_notifications", {}),
    (r"notice|news|latest|deadline|last date|update|परिपत्रक|अंतिम तारीख|शेवटची तारीख|ताज्या|नवीनतम", "latest_notices", {}),
]


def fixed_plan(question: str, signed_in: bool) -> list[tuple[str, dict]]:
    q = question.lower()
    picks = [(tool, dict(args)) for pat, tool, args in FIXED if re.search(pat, q)]
    picks = [(t, a) for t, a in picks if signed_in or t != "get_notifications"]
    if any(t in ("compute_plan", "get_colleges", "list_exams", "check_eligibility") for t, _ in picks):
        # these need a career: start from the student's top match
        picks = [("rank_careers", {"n": 3})] + [(t, a) for t, a in picks if t != "rank_careers"]
    return picks[:3]


# ------------------------------------------------------------------ the loop

class AskBody(rag.AskIn):
    pass


def _clean_profile(profile: dict | None) -> dict:
    return {k: v for k, v in (profile or {}).items() if k in PROFILE_FIELDS and v not in (None, "", [])}


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _planner_messages(msgs: list[dict], specs: list[dict]) -> list[dict]:
    listing = "\n".join(f"- {s['function']['name']}({', '.join(s['function']['parameters'].get('properties', {}))}): "
                        f"{s['function']['description']}" for s in specs)
    rule = ("\nYou cannot call functions directly. Reply with JSON only, either "
            '{"tool": "<name>", "args": {...}} to use one tool, or {"answer": "<your answer to the student>"} when done.'
            f"\nTools:\n{listing}")
    out = [dict(m) for m in msgs]
    out[0]["content"] += rule
    return out


def run(body: AskBody, user_id: int | None = None) -> Iterator[dict]:
    """The agent loop as a stream of events: start, step, step_done ..., answer."""
    t0 = time.time()
    lang = body.lang if body.lang in LANG_NAME else "en"
    profile = _clean_profile(body.profile)
    signed_in = bool(user_id)
    transport = mcp_client.start()
    yield {"type": "start", "mcp": transport, "max_steps": MAX_STEPS}

    specs = tool_specs(signed_in)
    msgs = [{"role": "system", "content": system_prompt(lang, profile, signed_in)}]
    msgs += [{"role": m["role"], "content": str(m.get("content", ""))[:600]} for m in body.history[-4:]
             if m.get("role") in ("user", "assistant")]
    msgs.append({"role": "user", "content": body.question})

    steps: list[dict] = []
    results: list = []
    mode, provider, answer = "tools", None, None

    def do_step(name: str, args: dict):
        n = len(steps) + 1
        label = labels().get(name, name)
        ev = {"type": "step", "n": n, "tool": name, "label": label, "args": {k: v for k, v in args.items() if k not in INJECTED}}
        started = time.time()
        res = run_tool(name, args, profile, user_id)
        step = {**ev, "summary": _short(res), "ms": int((time.time() - started) * 1000), "source": _first_source(res)}
        steps.append(step)
        results.append(res)
        return ev, {**step, "type": "step_done"}, res

    for _round in range(MAX_STEPS):
        try:
            if mode == "tools":
                msg, provider = llm.chat_tools(msgs, specs)
                calls = msg.get("tool_calls") or []
                if not calls:
                    answer = msg.get("content") or ""
                    break
                msgs.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
                for c in calls[:4]:
                    try:
                        args = json.loads(c["function"].get("arguments") or "{}")
                    except ValueError:
                        args = {}
                    ev, done, res = do_step(c["function"]["name"], args if isinstance(args, dict) else {})
                    yield ev
                    yield done
                    msgs.append({"role": "tool", "tool_call_id": c["id"],
                                 "content": f"[{done['n']}] " + json.dumps(res, ensure_ascii=False)[:RESULT_CHARS]})
            else:  # JSON planner
                text, provider = llm.chat(_planner_messages(msgs, specs), json_mode=True, max_tokens=700)
                plan = llm.parse_json(text)
                if plan.get("answer") or not plan.get("tool"):
                    answer = str(plan.get("answer") or "")
                    break
                ev, done, res = do_step(str(plan["tool"]), plan.get("args") if isinstance(plan.get("args"), dict) else {})
                yield ev
                yield done
                msgs.append({"role": "assistant", "content": json.dumps({"tool": plan["tool"], "args": plan.get("args", {})})})
                msgs.append({"role": "user", "content": f"Result [{done['n']}]: " + json.dumps(res, ensure_ascii=False)[:RESULT_CHARS]})
        except llm.ToolsUnsupported:
            mode = "planner"  # no provider takes function calling: let the model plan in JSON instead
            continue
        except (llm.LLMUnavailable, ValueError, json.JSONDecodeError):
            mode = "fixed"
            break

    if answer is None and mode != "fixed":
        # step budget used up: ask for the answer from what was found, with no more tools
        try:
            msgs.append({"role": "user", "content": "Answer the question now from the tool results above, with [n] numbers."})
            answer, provider = llm.chat(_flatten(msgs), temperature=0.2, max_tokens=600)
        except llm.LLMUnavailable:
            mode = "fixed"

    if mode == "fixed":
        for name, args in fixed_plan(body.question, signed_in):
            if len(steps) >= MAX_STEPS:
                break
            ev, done, _ = do_step(name, args)
            yield ev
            yield done

    out = finish(body, answer if mode != "fixed" else None, results, steps, profile, mode, provider)
    out["ms"] = int((time.time() - t0) * 1000)
    log_run(user_id, body.question, out)
    yield {"type": "answer", **out}


def _flatten(msgs: list[dict]) -> list[dict]:
    """A plain chat transcript (tool calls and results as text) for providers called without tools."""
    out = []
    for m in msgs:
        if m["role"] == "tool":
            out.append({"role": "user", "content": "Tool result " + m["content"]})
        elif m.get("tool_calls"):
            names = ", ".join(c["function"]["name"] for c in m["tool_calls"])
            out.append({"role": "assistant", "content": (m.get("content") or "") + f" (called: {names})"})
        else:
            out.append({"role": m["role"], "content": m["content"]})
    return out


def finish(body: AskBody, answer: str | None, results: list, steps: list[dict], profile: dict, mode: str,
           provider: str | None) -> dict:
    """Ground the answer in what the tools returned; otherwise fall back to the one-shot RAG answer."""
    answer = (answer or "").strip()
    context = "\n".join(json.dumps(r, ensure_ascii=False) for r in results) + f"\n{body.question}\n{json.dumps(profile)}"
    if answer and rag.grounded(answer, context):
        cited = sorted({int(n) for n in re.findall(r"\[(\d+)\]", answer) if 1 <= int(n) <= len(steps)})
        cites = [{"n": n, "sheet": "MCP · " + steps[n - 1]["tool"], "row_id": "", "title": steps[n - 1]["label"],
                  "excel_rows": [], "source": steps[n - 1]["source"], "summary": steps[n - 1]["summary"]} for n in cited]
        return {"mode": f"agent/{mode}", "answer": answer, "citations": cites, "steps": steps, "fallback": False,
                "grounded": True, "provider": provider}
    reason = "model used a figure that no tool returned" if answer else ("no model answered" if mode == "fixed" else "empty answer")
    rows = rag.answer(rag.AskIn(question=body.question, lang=body.lang, history=body.history, profile=body.profile))
    return {"mode": "rag", "answer": rows["answer"], "citations": rows["citations"], "steps": steps,
            "fallback": rows.get("fallback", False), "grounded": rows.get("grounded", True),
            "provider": rows.get("provider") or provider, "agent_fallback": reason}


def log_run(user_id: int | None, question: str, out: dict) -> None:
    try:
        with db.connect() as con:
            con.execute("INSERT INTO agent_runs (user_id, question, mode, provider, steps, answer, grounded, ms, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (user_id, question[:500], out["mode"][:16], out.get("provider"),
                         json.dumps([{k: s[k] for k in ("tool", "args", "summary", "ms")} for s in out["steps"]], ensure_ascii=False),
                         (out.get("answer") or "")[:2000], 1 if out.get("grounded") else 0, out.get("ms"), int(time.time())))
    except Exception:  # the audit log must never break an answer
        pass


# ------------------------------------------------------------------ endpoints

def optional_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> int | None:
    """The signed-in user's id if a valid token came with the request; Ask Raah also works signed out."""
    if cred is None:
        return None
    try:
        claims = jwt.decode(cred.credentials, SIGNING_KEY, algorithms=["HS256"], audience="raah-app")
        return int(claims["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


@router.post("/api/agent/ask")
def agent_ask(body: AskBody, user_id: int | None = Depends(optional_user)):
    """Agentic Ask Raah over Server-Sent Events. /api/ask (one-shot RAG) stays as the fallback."""
    def stream():
        try:
            for ev in run(body, user_id):
                yield _sse(ev)
        except Exception as e:  # noqa: BLE001 - the page then calls /api/ask
            yield _sse({"type": "error", "error": f"{type(e).__name__}: {str(e)[:200]}"})
        yield _sse({"type": "done"})
    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/api/agent/runs")
def agent_runs(limit: int = 20, user: dict = Depends(current_user)):
    """Audit trail: a teacher sees every run, a student their own."""
    limit = max(1, min(limit, 100))
    with db.connect() as con:
        if user["role"] == "teacher":
            rows = con.execute("SELECT * FROM agent_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        else:
            rows = con.execute("SELECT * FROM agent_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?", (user["id"], limit)).fetchall()
    return [{**dict(r), "steps": json.loads(r["steps"] or "[]")} for r in rows]


@router.get("/api/mcp/status")
def mcp_status():
    return {**mcp_client.status(), "llm": llm.status(), "max_steps": MAX_STEPS}

