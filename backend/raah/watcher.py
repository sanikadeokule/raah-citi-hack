"""Exam date watcher.

A student taps "Notify me" on an exam. A background job then re-reads that exam's official site (the
'Official site' cell of the Exams sheet, never a hardcoded address) and, when a new line carrying a date
appears on the page, sends the interested students a notification. The first read of a page only
records a baseline, so nobody is told about dates that were already public.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from lxml import html as lxml_html

from . import dataset, db
from .auth import current_user, notify, teacher_only

router = APIRouter(prefix="/api/watch", tags=["exam watcher"])

_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*"
DATE_RE = re.compile(
    rf"\b\d{{1,2}}[\s/.\-](?:\d{{1,2}}|{_MONTH})[\s/.\-,]*\d{{2,4}}\b|\b{_MONTH}\.?\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+\d{{4}})?\b",
    re.I)
KEYWORD_RE = re.compile(
    r"registration|last date|exam date|date of exam|notification|admit card|hall ticket|result|schedule|"
    r"application|counselling|counseling|cut-?off|merit list", re.I)
MAX_LINES = 300
KINDS = {"exam"}


def fetch_page(url: str) -> str:
    r = httpx.get(url, follow_redirects=True, timeout=20, headers={"User-Agent": "RaahWatcher/0.1 (student exam alerts)"})
    r.raise_for_status()
    return r.text


def page_lines(markup: str) -> list[str]:
    """The lines of a page that talk about dates or the application process, whitespace-normalised."""
    tree = lxml_html.fromstring(markup)
    for bad in tree.xpath("//script|//style|//noscript"):
        bad.drop_tree()
    for block in tree.iter("p", "li", "tr", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "td", "th"):
        block.text = "\n" + (block.text or "")
        block.tail = "\n" + (block.tail or "")
    seen: dict[str, None] = {}
    for raw in tree.text_content().splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if 8 <= len(line) <= 300 and (DATE_RE.search(line) or KEYWORD_RE.search(line)):
            seen.setdefault(line, None)
    return list(seen)[:MAX_LINES]


def _watched_exams() -> list[dict]:
    """Exams at least one student asked about, with the site read from the dataset."""
    with db.connect() as con:
        ids = {r["ref_id"] for r in con.execute("SELECT DISTINCT ref_id FROM interests WHERE kind = 'exam'").fetchall()}
    return [e for e in dataset.get()["exams"] if e["id"] in ids and e.get("site")]


def check_exam(exam: dict, fetch=fetch_page) -> dict:
    now = int(time.time())
    try:
        lines = page_lines(fetch(exam["site"]))
    except Exception as exc:  # a government site being down is routine; record it and move on
        with db.connect() as con:
            _record(con, exam, None, f"error: {type(exc).__name__}", now, changed=False)
        return {"exam": exam["id"], "status": "error", "error": str(exc)[:200], "notified": 0}

    with db.connect() as con:
        row = con.execute("SELECT lines FROM source_watch WHERE kind = 'exam' AND ref_id = ?", (exam["id"],)).fetchone()
        if row is None:
            _record(con, exam, lines, "baseline", now, changed=False)
            return {"exam": exam["id"], "status": "baseline", "notified": 0}
        before = set(json.loads(row["lines"]))
        new_dated = [ln for ln in lines if ln not in before and DATE_RE.search(ln)]
        _record(con, exam, lines, "changed" if new_dated else "unchanged", now, changed=bool(new_dated))
        users = [r["user_id"] for r in con.execute("SELECT user_id FROM interests WHERE kind = 'exam' AND ref_id = ?",
                                                    (exam["id"],)).fetchall()]
    if not new_dated or not users:
        return {"exam": exam["id"], "status": "unchanged", "notified": 0}
    notify(users, "exam_update", {"exam_id": exam["id"], "exam_name": exam["name"], "site": exam["site"],
                                  "body": " · ".join(new_dated[:3])})
    return {"exam": exam["id"], "status": "changed", "notified": len(users), "new_lines": new_dated[:5]}


def _record(con, exam: dict, lines: list[str] | None, status: str, now: int, changed: bool) -> None:
    exists = con.execute("SELECT id FROM source_watch WHERE kind = 'exam' AND ref_id = ?", (exam["id"],)).fetchone()
    payload = json.dumps(lines, ensure_ascii=False) if lines is not None else None
    if exists is None:
        con.execute("INSERT INTO source_watch (kind, ref_id, url, lines, status, last_checked, last_changed) VALUES ('exam', ?, ?, ?, ?, ?, NULL)",
                    (exam["id"], exam["site"], payload or "[]", status, now))
    elif payload is None:
        con.execute("UPDATE source_watch SET status = ?, last_checked = ? WHERE id = ?", (status, now, exists["id"]))
    else:
        con.execute("UPDATE source_watch SET url = ?, lines = ?, status = ?, last_checked = ?, last_changed = CASE WHEN ? = 1 THEN ? ELSE last_changed END WHERE id = ?",
                    (exam["site"], payload, status, now, 1 if changed else 0, now, exists["id"]))


def run_once(fetch=fetch_page) -> list[dict]:
    return [check_exam(e, fetch) for e in _watched_exams()]


_started = threading.Event()


def start_background(interval_hours: float | None = None) -> bool:
    """Start the daily-ish checker thread once. RAAH_WATCH_INTERVAL_HOURS=0 turns it off."""
    hours = float(os.environ.get("RAAH_WATCH_INTERVAL_HOURS", "6")) if interval_hours is None else interval_hours
    if hours <= 0 or _started.is_set():
        return False
    _started.set()

    def loop() -> None:
        time.sleep(60)
        while True:
            try:
                run_once()
            except Exception:
                pass
            time.sleep(hours * 3600)

    threading.Thread(target=loop, name="exam-watcher", daemon=True).start()
    return True


def _check_target(kind: str, ref_id: str) -> None:
    if kind not in KINDS:
        raise HTTPException(404, "Unknown kind")
    if not any(e["id"] == ref_id for e in dataset.get()["exams"]):
        raise HTTPException(404, "Unknown exam")


@router.get("/interests")
def my_interests(user: dict = Depends(current_user)):
    with db.connect() as con:
        rows = con.execute("SELECT kind, ref_id FROM interests WHERE user_id = ? ORDER BY id", (user["id"],)).fetchall()
    return [{"kind": r["kind"], "ref_id": r["ref_id"]} for r in rows]


@router.put("/interests/{kind}/{ref_id}")
def add_interest(kind: str, ref_id: str, user: dict = Depends(current_user)):
    _check_target(kind, ref_id)
    with db.connect() as con:
        if con.execute("SELECT id FROM interests WHERE user_id = ? AND kind = ? AND ref_id = ?", (user["id"], kind, ref_id)).fetchone() is None:
            con.execute("INSERT INTO interests (user_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?)", (user["id"], kind, ref_id, int(time.time())))
    return {"kind": kind, "ref_id": ref_id, "watching": True}


@router.delete("/interests/{kind}/{ref_id}")
def remove_interest(kind: str, ref_id: str, user: dict = Depends(current_user)):
    with db.connect() as con:
        con.execute("DELETE FROM interests WHERE user_id = ? AND kind = ? AND ref_id = ?", (user["id"], kind, ref_id))
    return {"kind": kind, "ref_id": ref_id, "watching": False}


@router.post("/run")
def run_now(_: dict = Depends(teacher_only)):
    return {"results": run_once()}


@router.get("/status")
def status(_: dict = Depends(teacher_only)):
    with db.connect() as con:
        rows = con.execute("SELECT ref_id, url, status, last_checked, last_changed FROM source_watch WHERE kind = 'exam' ORDER BY ref_id").fetchall()
    return [dict(r) for r in rows]
