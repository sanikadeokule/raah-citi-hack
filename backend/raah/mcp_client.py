"""MCP client for the Ask Raah agent.

At startup the backend launches Raah's MCP servers as child processes over stdio, keeps one session open to
each, and lists their tools once:
  raah-data     backend/mcp_servers/data_server.py     the verified dataset + engine (careers, costs, schemes ...)
  raah-notices  backend/mcp_servers/notices_server.py  live notices from official sites (NTA, CET Cell, MahaDBT ...)
agent.py then calls `tools()` (every server's tools together) and `call(name, args)` (sent to the server that
has that tool); both are plain synchronous functions, because each session lives on its own asyncio loop in a
background thread.

RAAH_MCP_TRANSPORT picks how the servers are reached:
  stdio   (default) real child processes, exactly how Claude Desktop or any MCP client would run them
  memory  the same servers and MCP protocol over in-memory streams (no child process; used by the tests)
  direct  no MCP at all, the tool functions are called in-process (only if the mcp package is missing)
If stdio cannot start (for example a laptop policy blocks the child process), memory is tried, then direct,
so Ask Raah keeps working. Each server falls back on its own.
"""
from __future__ import annotations

import asyncio
import importlib
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

# (server name, python module); the module has build_server() and TOOLS
SERVERS = [("raah-data", "mcp_servers.data_server"), ("raah-notices", "mcp_servers.notices_server")]


class _Server:
    def __init__(self, name: str, module: str):
        self.name, self.module = name, module
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

    # -------------------------------------------------------------- connecting

    async def _serve(self, transport: str, ready: threading.Event) -> None:
        from mcp import ClientSession

        self.stop = asyncio.Event()
        if transport == "stdio":
            from mcp.client.stdio import StdioServerParameters, stdio_client

            params = StdioServerParameters(command=sys.executable, args=["-m", self.module],
                                           env={**os.environ, "RAG_WARM": "0", "PYTHONIOENCODING": "utf-8"}, cwd=str(BACKEND))
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    await self._ready(session, transport, ready)
        else:
            from mcp.shared.memory import create_connected_server_and_client_session

            build_server = importlib.import_module(self.module).build_server
            async with create_connected_server_and_client_session(build_server()) as session:
                await self._ready(session, transport, ready)

    async def _ready(self, session, transport: str, ready: threading.Event) -> None:
        listed = await session.list_tools()
        self.session, self.tools, self.transport, self.error = session, [_tool_dict(t) for t in listed.tools], transport, None
        self.started_at = time.time()
        ready.set()
        await self.stop.wait()

    def _run_thread(self, transport: str, ready: threading.Event) -> None:
        loop = asyncio.new_event_loop()
        self.loop = loop
        try:
            loop.run_until_complete(self._serve(transport, ready))
        except BaseException as e:  # noqa: BLE001 - reported through status()
            self.error = f"{transport}: {type(e).__name__} {str(e)[:160]}"
        finally:
            self.session = None
            ready.set()
            loop.close()

    def _try(self, transport: str, wait: float) -> bool:
        ready = threading.Event()
        t = threading.Thread(target=self._run_thread, args=(transport, ready), name=f"mcp-{self.name}-{transport}", daemon=True)
        t.start()
        ready.wait(wait)
        if self.session is not None:
            self.thread = t
            return True
        return False

    def start(self, wait: float = 20) -> str:
        with self.lock:
            if self.transport and (self.transport == "direct" or self.session is not None):
                return self.transport
            want = os.environ.get("RAAH_MCP_TRANSPORT", "stdio").strip().lower()
            order = {"stdio": ["stdio", "memory"], "memory": ["memory"], "direct": []}.get(want, ["stdio", "memory"])
            errors = []
            for transport in order:
                try:
                    import mcp  # noqa: F401
                except ImportError:
                    errors.append("mcp package not installed (pip install -r requirements.txt)")
                    break
                if self._try(transport, wait):
                    return transport
                errors.append(self.error or f"{transport}: did not start in {wait:.0f}s")
            self.tools, self.transport, self.started_at = _direct_tools(self.module), "direct", time.time()
            self.error = "; ".join(errors) or None
            return "direct"

    def stop_session(self) -> None:
        if self.loop and self.stop and self.session is not None:
            self.loop.call_soon_threadsafe(self.stop.set)
            if self.thread:
                self.thread.join(5)
        self.session, self.transport, self.tools = None, None, []

    # -------------------------------------------------------------- calling

    def call(self, name: str, args: dict) -> dict:
        self.calls += 1
        if self.transport == "direct" or self.session is None:
            fn = next((f for f in importlib.import_module(self.module).TOOLS if f.__name__ == name), None)
            if fn is None:
                return {"error": f"unknown tool {name}"}
            try:
                return fn(**args)
            except Exception as e:  # noqa: BLE001
                return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
        try:
            fut = asyncio.run_coroutine_threadsafe(self.session.call_tool(name, args), self.loop)
            res = fut.result(CALL_TIMEOUT)
        except Exception as e:  # noqa: BLE001
            return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
        out = _parse(res)
        if getattr(res, "isError", False):
            return {"error": out.get("text") if isinstance(out, dict) else str(out)}
        return out

    def status(self) -> dict:
        return {"server": self.name, "transport": self.transport,
                "connected": self.transport == "direct" or self.session is not None,
                "tools": [t["name"] for t in self.tools], "calls": self.calls, "error": self.error,
                "since": int(self.started_at) if self.started_at else None}


_servers = [_Server(n, m) for n, m in SERVERS]


def _tool_dict(t) -> dict:
    return {"name": t.name, "description": t.description or "", "input_schema": t.inputSchema or {"type": "object"}}


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


def _direct_tools(module: str) -> list[dict]:
    out = []
    for fn in importlib.import_module(module).TOOLS:
        hints = typing.get_type_hints(fn)
        props, required = {}, []
        for name, prm in inspect.signature(fn).parameters.items():
            props[name] = _json_type(hints.get(name, str))
            if prm.default is inspect.Parameter.empty:
                required.append(name)
        out.append({"name": fn.__name__, "description": fn.__doc__ or "",
                    "input_schema": {"type": "object", "properties": props, "required": required}})
    return out


def _parse(result) -> dict:
    if getattr(result, "structuredContent", None):
        sc = result.structuredContent
        return sc.get("result", sc) if isinstance(sc, dict) and set(sc) == {"result"} else sc
    text = "".join(getattr(c, "text", "") for c in result.content or [])
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return {"text": text}


# ------------------------------------------------------------------ public API

def start(wait: float = 20) -> str:
    """Connect every server once (idempotent). Returns raah-data's transport."""
    modes = [s.start(wait) for s in _servers]
    return modes[0]


def start_background() -> None:
    threading.Thread(target=start, name="mcp-connect", daemon=True).start()


def stop() -> None:
    for s in _servers:
        s.stop_session()


def tools() -> list[dict]:
    """Every server's tools; a name two servers share goes to the first one."""
    start()
    out, seen = [], set()
    for s in _servers:
        for t in s.tools:
            if t["name"] not in seen:
                seen.add(t["name"])
                out.append({**t, "server": s.name})
    return out


def call(name: str, args: dict) -> dict:
    """Call one tool on the server that has it. Errors come back as {"error": ...} so the agent can carry on."""
    start()
    for s in _servers:
        if any(t["name"] == name for t in s.tools):
            return s.call(name, args)
    return {"error": f"unknown tool {name}"}


def status() -> dict:
    """raah-data's status at the top level (as before), every server under "servers"."""
    each = [s.status() for s in _servers]
    return {**each[0], "tools": [t for st in each for t in st["tools"]], "calls": sum(st["calls"] for st in each),
            "connected": all(st["connected"] for st in each), "servers": each}
