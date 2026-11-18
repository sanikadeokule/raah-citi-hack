"""MCP client for the Ask Raah agent.

At startup the backend launches the raah-data MCP server (backend/mcp_servers/data_server.py) as a child
process over stdio, keeps one session open, and lists its tools once. agent.py then calls
`tools()` and `call(name, args)`; both are plain synchronous functions, because the session lives on its
own asyncio loop in a background thread.

RAAH_MCP_TRANSPORT picks how the server is reached:
  stdio   (default) a real child process, exactly how Claude Desktop or any MCP client would run it
  memory  the same server and MCP protocol over in-memory streams (no child process; used by the tests)
  direct  no MCP at all, the tool functions are called in-process (only if the mcp package is missing)
If stdio cannot start (for example a laptop policy blocks the child process), memory is tried, then direct,
so Ask Raah keeps working.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import os
import sys
import threading
import time
import typing
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
CALL_TIMEOUT = float(os.environ.get("RAAH_MCP_TIMEOUT", "40"))


class _State:
    def __init__(self):
        self.lock = threading.Lock()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.session = None
        self.stop: asyncio.Event | None = None
        self.thread: threading.Thread | None = None
        self.tools: list[dict] = []
        self.transport: str | None = None
        self.error: str | None = None
        self.started_at: float | None = None
        self.calls = 0


_s = _State()


def _tool_dict(t) -> dict:
    return {"name": t.name, "description": t.description or "", "input_schema": t.inputSchema or {"type": "object"}}


async def _serve(transport: str, ready: threading.Event) -> None:
    from mcp import ClientSession

    _s.stop = asyncio.Event()
    if transport == "stdio":
        from mcp.client.stdio import StdioServerParameters, stdio_client

        params = StdioServerParameters(command=sys.executable, args=["-m", "mcp_servers.data_server"],
                                       env={**os.environ, "RAG_WARM": "0", "PYTHONIOENCODING": "utf-8"}, cwd=str(BACKEND))
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                await _ready(session, transport, ready)
    else:
        from mcp.shared.memory import create_connected_server_and_client_session

        from mcp_servers.data_server import build_server

        async with create_connected_server_and_client_session(build_server()) as session:
            await _ready(session, transport, ready)


async def _ready(session, transport: str, ready: threading.Event) -> None:
    listed = await session.list_tools()
    _s.session, _s.tools, _s.transport, _s.error = session, [_tool_dict(t) for t in listed.tools], transport, None
    _s.started_at = time.time()
    ready.set()
    await _s.stop.wait()


def _run_thread(transport: str, ready: threading.Event) -> None:
    loop = asyncio.new_event_loop()
    _s.loop = loop
    try:
        loop.run_until_complete(_serve(transport, ready))
    except BaseException as e:  # noqa: BLE001 - reported through status()
        _s.error = f"{transport}: {type(e).__name__} {str(e)[:160]}"
    finally:
        _s.session = None
        ready.set()
        loop.close()


def _try(transport: str, wait: float) -> bool:
    ready = threading.Event()
    t = threading.Thread(target=_run_thread, args=(transport, ready), name=f"mcp-{transport}", daemon=True)
    t.start()
    ready.wait(wait)
    if _s.session is not None:
        _s.thread = t
        return True
    return False


# ------------------------------------------------------------------ direct fallback (no mcp package)

def _json_type(ann) -> dict:
    origin = typing.get_origin(ann)
    if ann in (int,):
        return {"type": "integer"}
    if ann in (float,):
        return {"type": "number"}
    if ann in (bool,):
        return {"type": "boolean"}
    if ann is dict or origin is dict:
        return {"type": "object"}
    if ann is list or origin is list:
        return {"type": "array"}
    return {"type": "string"}


def _direct_tools() -> list[dict]:
    from mcp_servers.data_server import TOOLS

    out = []
    for fn in TOOLS:
        hints = typing.get_type_hints(fn)
        props, required = {}, []
        for name, prm in inspect.signature(fn).parameters.items():
            props[name] = _json_type(hints.get(name, str))
            if prm.default is inspect.Parameter.empty:
                required.append(name)
        out.append({"name": fn.__name__, "description": fn.__doc__ or "",
                    "input_schema": {"type": "object", "properties": props, "required": required}})
    return out


# ------------------------------------------------------------------ public API

def start(wait: float = 20) -> str:
    """Connect once (idempotent). Returns the transport in use."""
    with _s.lock:
        if _s.transport and (_s.transport == "direct" or _s.session is not None):
            return _s.transport
        want = os.environ.get("RAAH_MCP_TRANSPORT", "stdio").strip().lower()
        order = {"stdio": ["stdio", "memory"], "memory": ["memory"], "direct": []}.get(want, ["stdio", "memory"])
        errors = []
        for transport in order:
            try:
                import mcp  # noqa: F401
            except ImportError:
                errors.append("mcp package not installed (pip install -r requirements.txt)")
                break
            if _try(transport, wait):
                return transport
            errors.append(_s.error or f"{transport}: did not start in {wait:.0f}s")
        _s.tools, _s.transport, _s.started_at = _direct_tools(), "direct", time.time()
        _s.error = "; ".join(errors) or None
        return "direct"


def start_background() -> None:
    threading.Thread(target=start, name="mcp-connect", daemon=True).start()


def stop() -> None:
    if _s.loop and _s.stop and _s.session is not None:
        _s.loop.call_soon_threadsafe(_s.stop.set)
        if _s.thread:
            _s.thread.join(5)
    _s.session, _s.transport, _s.tools = None, None, []


def tools() -> list[dict]:
    start()
    return list(_s.tools)


def _parse(result) -> dict:
    if getattr(result, "structuredContent", None):
        sc = result.structuredContent
        return sc.get("result", sc) if isinstance(sc, dict) and set(sc) == {"result"} else sc
    text = "".join(getattr(c, "text", "") for c in result.content or [])
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return {"text": text}


def call(name: str, args: dict) -> dict:
    """Call one tool. Errors come back as {"error": ...} so the agent can tell the model and carry on."""
    start()
    _s.calls += 1
    if _s.transport == "direct" or _s.session is None:
        from mcp_servers.data_server import TOOLS

        fn = next((f for f in TOOLS if f.__name__ == name), None)
        if fn is None:
            return {"error": f"unknown tool {name}"}
        try:
            return fn(**args)
        except Exception as e:  # noqa: BLE001
            return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    try:
        fut = asyncio.run_coroutine_threadsafe(_s.session.call_tool(name, args), _s.loop)
        res = fut.result(CALL_TIMEOUT)
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    out = _parse(res)
    if getattr(res, "isError", False):
        return {"error": out.get("text") if isinstance(out, dict) else str(out)}
    return out


def status() -> dict:
    return {"server": "raah-data", "transport": _s.transport, "connected": _s.transport == "direct" or _s.session is not None,
            "tools": [t["name"] for t in _s.tools], "calls": _s.calls, "error": _s.error,
            "since": int(_s.started_at) if _s.started_at else None}
