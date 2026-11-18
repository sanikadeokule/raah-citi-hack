"""raah-notices: an MCP server over live notices from official sites (NTA, JEE Main, NEET, State CET Cell, MahaDBT).

Run it on its own with  `python -m mcp_servers.notices_server`  (from backend/) and it works in any MCP client,
for example Claude Desktop. Inside Raah the Ask agent starts it next to raah-data (raah/mcp_client.py).

Tools that read the sites live (fetch_notices, read_notice) only open official government pages. The notices
Raah's background watcher already stored, with their exam/scheme tags and deadlines, come from latest_notices.
"""
from __future__ import annotations

from raah import notices

SERVER_NAME = "raah-notices"
INSTRUCTIONS = ("Live notices from official Indian exam and scholarship sites (NTA, JEE Main, NEET, Maharashtra State CET "
                "Cell, MahaDBT). Use latest_notices for news, deadlines and updates; read_notice to open one notice's page "
                "or PDF. Quote titles, dates and links exactly as returned and always give the official link.")


def list_sources() -> dict:
    """The official sites Raah reads notices from, and when each was last checked."""
    return {"sources": notices.source_status()}


def fetch_notices(source: str) -> dict:
    """Read one official site's latest-notices list right now. source is one of: nta, jee, neet, cetcell, mahadbt."""
    src = notices.SOURCE_BY_ID.get(str(source or "").strip().lower())
    if not src:
        return {"error": f"unknown source '{source}'", "sources": [s["id"] for s in notices.SOURCES]}
    page, status, snap_at = notices.read_source(src)
    if page is None:
        return {"source": src["id"], "status": status, "notices": [], "note": "The site could not be reached."}
    items = notices.parse_items(src, page)
    return {"source": src["id"], "name": src["name"], "status": status, "snapshot_at": snap_at,
            "notices": [{"title": i["title"], "url": i["url"], "published": notices.published_from_url(i["url"]),
                         "dates": notices.extract_dates(i["title"])} for i in items[:20]]}


def read_notice(url: str) -> dict:
    """Open one official notice (web page or PDF) and return its text and the dates in it (deadline, start ...)."""
    return notices.read_notice(url, max_chars=5000)


def extract_dates(text: str) -> dict:
    """Find every date in a text (English, Hindi or Marathi, including Devanagari digits) and label each one as a
    deadline, start date or plain date from the words around it."""
    return {"dates": notices.extract_dates(text)}


def latest_notices(query: str = "", exam_id: str = "", scheme_id: str = "", limit: int = 8) -> dict:
    """Notices Raah has already read from official sites, newest first, with deadlines and the exams/scholarships they
    concern. Filter by words (e.g. 'CET', 'NEET result', 'scholarship'), an exam ID (EX03) or a scheme ID (SCH16)."""
    try:
        items = notices.search_notices(query, exam_id, scheme_id, max(1, min(int(limit or 8), 20)))
    except Exception as e:  # noqa: BLE001 - no database when the server is run on its own
        return {"error": f"stored notices are not available ({type(e).__name__}); use fetch_notices instead"}
    status = notices.source_status()
    checked = [s["last_checked"] for s in status if s["last_checked"]]
    return {"notices": [{k: n[k] for k in ("title", "url", "source_name", "published", "category", "deadline", "days_left",
                                           "verified")} | {"exams": [e["name"] for e in n["exams"]]} for n in items],
            "last_checked": max(checked) if checked else None,
            "note": None if items else "No stored notice matches; try fetch_notices for a live read."}


TOOLS = [latest_notices, read_notice, fetch_notices, list_sources, extract_dates]

LABELS = {"latest_notices": "Checking the latest official notices", "read_notice": "Reading an official notice",
          "fetch_notices": "Reading an official site", "list_sources": "Listing official sources",
          "extract_dates": "Finding the dates"}


def build_server():
    from mcp.server.fastmcp import FastMCP

    server = FastMCP(SERVER_NAME, instructions=INSTRUCTIONS, log_level="WARNING")
    for fn in TOOLS:
        server.add_tool(fn, name=fn.__name__, description=fn.__doc__)
    return server


if __name__ == "__main__":
    import os

    os.environ.setdefault("RAG_WARM", "0")
    build_server().run()  # stdio transport
