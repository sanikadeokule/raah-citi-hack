"""Deadline guardian: tells a student before a deadline runs out.

Two sources of deadlines:
  - the student's own tracker cards that have a deadline set
  - official notices (read by notices.py) that were matched to the student's roadmap or schemes

A "deadline_alert" notification goes out once per deadline at each of 7, 3, 1 and 0 days to go. Past alerts are
looked up in the notifications table, so a restart or a repeat run never sends the same alert twice.
"""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import date

from . import db
from .auth import notify

BUCKETS = (0, 1, 3, 7)  # days to go; the alert for a deadline is the smallest bucket that still covers it


def bucket_for(days: int) -> int | None:
    """The alert bucket for `days` to go, or None when the deadline is passed or more than a week away."""
    if days < 0 or days > BUCKETS[-1]:
        return None
    return next(b for b in BUCKETS if days <= b)


def _days_to(iso: str, today: date) -> int | None:
    try:
        return (date.fromisoformat(iso[:10]) - today).days
    except (TypeError, ValueError):
        return None


def _deadlines(today: date) -> list[dict]:
    """Every (student, deadline) pair that could need an alert, with a stable key for de-duplication."""
    out: list[dict] = []
    with db.connect() as con:
        cards = con.execute("SELECT id, user_id, title, deadline FROM applications "
                            "WHERE deadline IS NOT NULL AND \"column\" != 'result'").fetchall()
        notices = con.execute("SELECT un.user_id, n.id, n.title, n.url, n.deadline FROM user_notices un "
                              "JOIN notices n ON n.id = un.notice_id WHERE n.deadline IS NOT NULL AND n.hidden = 0").fetchall()
    for r in cards:
        out.append({"user_id": r["user_id"], "key": f"card:{r['id']}", "title": r["title"], "deadline": r["deadline"],
                    "source": "tracker", "url": None})
    for r in notices:
        out.append({"user_id": r["user_id"], "key": f"notice:{r['id']}", "title": r["title"], "deadline": r["deadline"],
                    "source": "notice", "url": r["url"]})
    return out


def _already_sent(user_ids: set[int]) -> set[tuple[int, str, int, str]]:
    if not user_ids:
        return set()
    with db.connect() as con:
        rows = con.execute("SELECT user_id, payload FROM notifications WHERE kind = 'deadline_alert'").fetchall()
    sent = set()
    for r in rows:
        if r["user_id"] in user_ids:
            p = json.loads(r["payload"])
            sent.add((r["user_id"], p.get("key"), p.get("bucket"), p.get("deadline")))
    return sent


def run_once(today: date | None = None) -> int:
    """Send every alert that is due and not yet sent. Returns how many went out."""
    today = today or date.today()
    due = []
    for d in _deadlines(today):
        days = _days_to(d["deadline"], today)
        b = bucket_for(days) if days is not None else None
        if b is not None:
            due.append({**d, "days": days, "bucket": b})
    sent = _already_sent({d["user_id"] for d in due})
    count = 0
    for d in due:
        if (d["user_id"], d["key"], d["bucket"], d["deadline"]) in sent:
            continue
        when = "today" if d["days"] == 0 else "tomorrow" if d["days"] == 1 else f"in {d['days']} days"
        notify([d["user_id"]], "deadline_alert", {
            "key": d["key"], "bucket": d["bucket"], "title": f"Deadline {when}: {d['title']}",
            "item": d["title"], "deadline": d["deadline"], "days": d["days"], "source": d["source"], "url": d["url"]})
        count += 1
    return count


_started = threading.Event()


def start_background(interval_hours: float | None = None) -> bool:
    """Check once an hour. RAAH_GUARDIAN_INTERVAL_HOURS=0 turns it off."""
    hours = float(os.environ.get("RAAH_GUARDIAN_INTERVAL_HOURS", "1")) if interval_hours is None else interval_hours
    if hours <= 0 or _started.is_set():
        return False
    _started.set()

    def loop() -> None:
        time.sleep(90)
        while True:
            try:
                run_once()
            except Exception:
                pass
            time.sleep(hours * 3600)

    threading.Thread(target=loop, name="deadline-guardian", daemon=True).start()
    return True
