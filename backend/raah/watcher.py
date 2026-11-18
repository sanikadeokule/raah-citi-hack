"""Exam date watcher: tells students when an exam they follow publishes new dates.

A student follows an exam (the Follow button on an exam card, which also appears on
course and path pages). A background thread reads the official site of every followed
exam, pulls out dated lines such as "Last date to apply: 8 March 2027", and sends a
notification to the followers when a future date appears that was not seen before.

- The first successful read of a site is only a baseline, so old notices never alert anyone.
- Facts are stored with a unique key, so a date alerts once even with several server workers.
- A site that cannot be read never produces a notification; its status is recorded instead.

Settings: RAAH_EXAM_WATCH=0 turns the thread off, RAAH_EXAM_WATCH_HOURS sets how often it runs (default 6).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from collections import Counter
from datetime import date, timedelta
from typing import Callable
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx
from fastapi import APIRouter, Depends, HTTPException
from lxml import html as lxml_html

from . import dataset, db
from .auth import current_user, teacher_only

log = logging.getLogger("raah.watcher")
router = APIRouter(prefix="/api/exams", tags=["exams"])

USER_AGENT = "RaahExamWatcher/1.0 (student exam date alerts)"
MAX_PAGE_BYTES = 2_000_000
MAX_DATES_PER_ALERT = 5
MAX_YEARS_AHEAD = 2

_MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
_MONTH_WORD = (r"(?P<mon>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
               r"sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)")
_DATE = re.compile(
    r"\b(?P<d>\d{1,2})(?:st|nd|rd|th)?[\s\-./]*" + _MONTH_WORD + r"\b\.?(?:[\s\-./,]*(?P<y>\d{4})\b)?"
    r"|\b(?P<d2>\d{1,2})[\-/.](?P<m2>\d{1,2})[\-/.](?P<y2>\d{4})\b"
    r"|\b" + _MONTH_WORD.replace("?P<mon>", "?P<mon3>") + r"\.?\s+(?P<d3>\d{1,2})(?:st|nd|rd|th)?,?\s+(?P<y3>\d{4})\b",
    re.I)
_KINDS = (
    ("admit_card", r"admit\s*card|hall\s*ticket"),
    ("merit_list", r"merit\s*list"),
    ("counselling", r"counsell?ing|cap\s*round|choice\s*filling|option\s*form|seat\s*allotment"),
    ("result", r"results?\b|score\s*card|answer\s*key"),
    ("registration", r"registration|register|apply|application|online\s*form|last\s*date"),
    ("exam", r"exam(?:ination)?s?\b|\btest\b"),
)
_KIND_RE = re.compile("|".join(f"(?P<{k}>{p})" for k, p in _KINDS), re.I)
# dates in these lines describe the website, not the exam
_IGNORE = re.compile(r"last\s*(?:updated|modified|reviewed)|updated\s*on|posted\s*on|published\s*on|visitor|copyright", re.I)
# these departments post about many unrelated programmes, so only lines naming the exam count
BROAD_SITE_WORDS = {
    "EX02": {"polytechnic", "post-ssc", "post ssc", "post-10th", "diploma admission"},
    "EX06": {"nmms"},
    "EX07": {"apprentice", "apprentices"},
}
_BLOCKS = ("tr", "li", "p", "h1", "h2", "h3", "h4", "h5", "h6", "a", "marquee", "dd", "td", "div", "span")


def _to_date(m: re.Match, fallback_year: int | None) -> date | None:
    try:
        if m["y2"]:
            return date(int(m["y2"]), int(m["m2"]), int(m["d2"]))
        if m["y3"]:
            return date(int(m["y3"]), _MONTHS[m["mon3"][:3].lower()], int(m["d3"]))
        year = int(m["y"]) if m["y"] else fallback_year
        return date(year, _MONTHS[m["mon"][:3].lower()], int(m["d"])) if year else None
    except ValueError:
        return None


def _year_of(m: re.Match) -> int | None:
    y = m["y"] or m["y2"] or m["y3"]
    return int(y) if y else None


def _kind_near(line: str, start: int) -> str | None:
    """The kind of date is named by the closest keyword before it, or else the first one after it."""
    hits = list(_KIND_RE.finditer(line))
    before = [h for h in hits if h.start() < start]
    hit = before[-1] if before else (hits[0] if hits else None)
    return hit.lastgroup if hit else None


def extract_lines(page: str) -> list[str]:
    """The readable lines of a page: one per table row, list item, paragraph or innermost block."""
    doc = lxml_html.fromstring(page)
    for bad in doc.xpath("//script|//style|//noscript|//template"):
        if bad.getparent() is not None:
            bad.drop_tree()
    seen, out = set(), []
    for el in doc.iter(*_BLOCKS):
        # a table row is read whole so a label and its date stay together; other containers only when they are leaves
        if el.tag != "tr" and (el.xpath("ancestor::tr") or el.xpath("./tr|./li|./p|./div|./table|./ul|./ol")):
            continue
        line = " ".join(" ".join(el.xpath(".//text()")).split())  # text_content() would glue table cells together
        if 6 <= len(line) <= 400 and line not in seen:
            seen.add(line)
            out.append(line)
    return out


def extract_dates(page: str, must_mention: set[str] | None = None) -> list[dict]:
    """Every (kind, date) the page states. `must_mention` limits a site shared by several exams."""
    words = re.compile(r"\b(?:" + "|".join(map(re.escape, sorted(must_mention))) + r")\b", re.I) if must_mention else None
    found: dict[tuple[str, str], dict] = {}
    for line in extract_lines(page):
        if _IGNORE.search(line) or (words and not words.search(line)):
            continue
        matches = list(_DATE.finditer(line))
        for i, m in enumerate(matches):
            # "24 Jan - 24 Feb 2027": the first date takes its year from the next one
            later_year = next((y for y in (_year_of(n) for n in matches[i + 1:]) if y), None)
            when = _to_date(m, later_year)
            kind = _kind_near(line, m.start())
            if when and kind:
                found.setdefault((kind, when.isoformat()), {"kind": kind, "date": when.isoformat(), "text": line[:200]})
    return sorted(found.values(), key=lambda f: (f["date"], f["kind"]))


def distinctive_words(exam: dict, exams: list[dict]) -> set[str] | None:
    """Words a line must contain to be about this exam (None when the whole site is about it)."""
    if exam["id"] in BROAD_SITE_WORDS:
        return BROAD_SITE_WORDS[exam["id"]]
    tokens =lambda e: {w.lower() for w in re.findall(r"[A-Za-z]{3,}", e.get("name") or "")}
    others = [e for e in exams if e["id"] != exam["id"] and e.get("site") == exam.get("site")]
    if not others:
        return None
    return tokens(exam) - set().union(*map(tokens, others))


class Unreadable(Exception):
    """The page loaded but has no text to read, usually because a browser must run its scripts."""


def _other_www(url: str) -> str:
    parts = urlsplit(url)
    host = parts.netloc[4:] if parts.netloc.startswith("www.") else f"www.{parts.netloc}"
    return urlunsplit(parts._replace(netloc=host))


def fetch_page(url: str) -> str:
    """Download an official page, also trying the www / non-www twin when one has a broken certificate."""
    try:
        return _download(url)
    except httpx.ConnectError:
        return _download(_other_www(url))


def _download(url: str) -> str:
    """Download one page politely. Raises PermissionError when robots.txt disallows it."""
    headers ={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}
    with httpx.Client(timeout=20, follow_redirects=True, headers=headers) as client:
        try:
            robots = client.get(urljoin(url, "/robots.txt"))
            if robots.status_code == 200:
                rules = RobotFileParser()
                rules.parse(robots.text.splitlines())
                if not rules.can_fetch(USER_AGENT, url):
                    raise PermissionError("robots.txt disallows this page")
        except httpx.HTTPError:
            pass  # no readable robots.txt means no stated restriction
        with client.stream("GET", url) as r:
            r.raise_for_status()
            kind = r.headers.get("content-type", "")
            if "html" not in kind.lower():
                raise ValueError(f"not a web page ({kind or 'unknown type'})")
            body = bytearray()
            for chunk in r.iter_bytes():
                body.extend(chunk)
                if len(body) > MAX_PAGE_BYTES:
                    break
            return bytes(body).decode(r.encoding or "utf-8", errors="replace")


def _save_status(con: db.DB, exam: dict, status: str, detail: str, now: int, ok: bool, new_dates: int = 0) -> None:
    con.execute(
        "INSERT INTO exam_watch (exam_id, site, status, detail, last_checked, last_success, baseline_at, last_new_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (exam_id) DO UPDATE SET site = excluded.site, status = excluded.status, detail = excluded.detail, "
        "last_checked = excluded.last_checked, "
        "last_success = COALESCE(excluded.last_success, exam_watch.last_success), "
        "baseline_at = COALESCE(exam_watch.baseline_at, excluded.baseline_at), "
        "last_new_at = COALESCE(excluded.last_new_at, exam_watch.last_new_at)",
        (exam["id"], exam.get("site"), status, detail[:300], now, now if ok else None, now if ok else None,
         now if new_dates else None))


def check_exam(exam: dict, exams: list[dict] | None = None, fetch: Callable[[str], str] | None = None,
               today: date | None = None) -> dict:
    """Read one exam's official site, record what it says, and alert followers about new future dates."""
    exams = exams if exams is not None else dataset.get()["exams"]
    fetch = fetch or fetch_page
    today = today or date.today()
    now = int(time.time())
    url = exam.get("site")
    try:
        if not url:
            raise ValueError("no official site in the dataset")
        page = fetch(url)
        if not extract_lines(page):
            raise Unreadable("the page has no readable text without running its scripts")
        facts = extract_dates(page, distinctive_words(exam, exams))
    except PermissionError as e:
        status, detail = "blocked", str(e)
    except Unreadable as e:  # not a baseline: otherwise every date would look new once the page becomes readable
        status, detail = "unreadable", str(e)
    except Exception as e:  # any network or parsing failure is recorded; it must never alert anyone
        status, detail = "unreachable", f"{type(e).__name__}: {e}"
    else:
        status, detail = None, ""
    if status:
        with db.connect() as con:
            _save_status(con, exam, status, detail, now, ok=False)
        return {"exam_id": exam["id"], "status": status, "detail": detail, "dates_found": 0, "new_dates": 0, "notified": 0}

    latest = today + timedelta(days=366 * MAX_YEARS_AHEAD)
    with db.connect() as con:
        row = con.execute("SELECT baseline_at FROM exam_watch WHERE exam_id = ?", (exam["id"],)).fetchone()
        is_baseline = not (row and row["baseline_at"])
        fresh = []
        for f in facts:
            key = hashlib.sha256(f"{exam['id']}|{f['kind']}|{f['date']}".encode()).hexdigest()
            inserted = con.execute(
                "INSERT INTO exam_date_facts (exam_id, fact_key, kind, date, text, source_url, first_seen) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (exam_id, fact_key) DO NOTHING",
                (exam["id"], key, f["kind"], f["date"], f["text"], url, now)).rowcount
            if inserted and today < date.fromisoformat(f["date"]) <= latest:
                fresh.append(f)
        notified = 0
        if fresh and not is_baseline:
            followers = [r["user_id"] for r in con.execute("SELECT user_id FROM exam_follows WHERE exam_id = ?",
                                                             (exam["id"],)).fetchall()]
            payload = json.dumps({"exam_id": exam["id"], "exam_name": exam.get("name"), "source_url": url,
                                  "dates": [{"kind": f["kind"], "date": f["date"]} for f in fresh[:MAX_DATES_PER_ALERT]]},
                                 ensure_ascii=False)
            # same transaction as the facts: a date is never marked as seen without its alert
            con.executemany("INSERT INTO notifications (user_id, from_user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                            [(u, None, "exam_dates", payload, now) for u in followers])
            notified = len(followers)
        status = "baseline" if is_baseline else ("ok" if facts else "no_dates")
        new_dates = 0 if is_baseline else len(fresh)
        _save_status(con, exam, status, "", now, ok=True, new_dates=new_dates)
    return {"exam_id": exam["id"], "status": status, "detail": "", "dates_found": len(facts),
            "new_dates": new_dates, "notified": notified}


def followed_exam_ids() -> set[str]:
    with db.connect() as con:
        return {r["exam_id"] for r in con.execute("SELECT DISTINCT exam_id FROM exam_follows").fetchall()}


def run_once(fetch: Callable[[str], str] | None = None, today: date | None = None, pause: float = 2.0) -> list[dict]:
    """Check every exam someone follows, one at a time so official sites are not hammered."""
    exams = dataset.get()["exams"]
    wanted = followed_exam_ids()
    out = []
    for exam in (e for e in exams if e["id"] in wanted):
        if out and pause:
            time.sleep(pause)
        out.append(check_exam(exam, exams, fetch, today))
    return out


# ------------------------------------------------------------------ background thread

_stop = threading.Event()
_thread: threading.Thread | None = None


def _loop(hours: float) -> None:
    if _stop.wait(60):  # let the server finish starting first
        return
    while True:
        try:
            summary = Counter(r["status"] for r in run_once())
            log.info("exam watch finished: %s", dict(summary))
        except Exception:
            log.exception("exam watch run failed")
        if _stop.wait(hours * 3600):
            return


def start() -> None:
    global _thread
    if os.environ.get("RAAH_EXAM_WATCH", "1") == "0" or os.environ.get("RAAH_TESTING") == "1":
        return
    if _thread and _thread.is_alive():
        return
    try:
        hours = max(0.25, float(os.environ.get("RAAH_EXAM_WATCH_HOURS", "6")))
    except ValueError:
        hours = 6.0
    _stop.clear()
    _thread = threading.Thread(target=_loop, args=(hours,), name="exam-watcher", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()


# ------------------------------------------------------------------ API

def _exam_or_404(exam_id: str) -> dict:
    exam = next((e for e in dataset.get()["exams"] if e["id"] == exam_id), None)
    if exam is None:
        raise HTTPException(404, f"exam {exam_id} not in the Exams sheet")
    return exam


@router.get("/following")
def following(user: dict = Depends(current_user)):
    with db.connect() as con:
        rows = con.execute("SELECT exam_id FROM exam_follows WHERE user_id = ? ORDER BY id", (user["id"],)).fetchall()
    return {"exam_ids": [r["exam_id"] for r in rows]}


@router.put("/{exam_id}/follow")
def follow(exam_id: str, user: dict = Depends(current_user)):
    exam = _exam_or_404(exam_id)
    with db.connect() as con:
        con.execute("INSERT INTO exam_follows (user_id, exam_id, created_at) VALUES (?, ?, ?) "
                    "ON CONFLICT (user_id, exam_id) DO NOTHING", (user["id"], exam_id, int(time.time())))
        row = con.execute("SELECT baseline_at FROM exam_watch WHERE exam_id = ?", (exam_id,)).fetchone()
    # record what the site says today, so that only dates published after this count as new
    if not (row and row["baseline_at"]) and _thread and _thread.is_alive():
        threading.Thread(target=check_exam, args=(exam,), name=f"exam-baseline-{exam_id}", daemon=True).start()
    return {"exam_id": exam_id, "following": True}


@router.delete("/{exam_id}/follow")
def unfollow(exam_id: str, user: dict = Depends(current_user)):
    with db.connect() as con:
        con.execute("DELETE FROM exam_follows WHERE user_id = ? AND exam_id = ?", (user["id"], exam_id))
    return {"exam_id": exam_id, "following": False}


@router.get("/watch/status")
def watch_status(_: dict = Depends(teacher_only)):
    with db.connect() as con:
        rows = con.execute("SELECT exam_id, site, status, detail, last_checked, last_success, last_new_at "
                           "FROM exam_watch ORDER BY exam_id").fetchall()
    return [dict(r) for r in rows]


@router.post("/watch/run")
def watch_run(_: dict = Depends(teacher_only)):
    """Check followed exams now instead of waiting for the next scheduled run."""
    return {"results": run_once()}
