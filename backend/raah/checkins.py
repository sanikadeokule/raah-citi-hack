"""Follow-up check-ins: Raah asks "Did you do it?" a few days after something happened, and acts on the answer.

Where the questions come from (each one at most once per student, by a stable key):
  - a tracker card still in "researching"       -> "Did you apply for {item}?"          Yes moves it to "applied"
  - a tracker card in "applied"                  -> "Did you send the documents for {item}?"  Yes moves it to "docs_submitted"
  - a mentor whose number the student asked for  -> "Did you talk to {item}?"
  - Today's step said "get documents" / "apply" / "check the exam" -> "Did you ...?"

Answers: "yes" closes it (and moves the tracker card, and writes to What Raah did for you), "later" asks again in
3 days, "help" also asks again later and the app opens Ask Raah with the question filled in.
An open check-in that is due becomes Today's step on Home (see today.py), so Home still shows one step.

The wait before asking is RAAH_CHECKIN_AFTER_DAYS (default 3). POST /api/checkins/refresh?soon=1 skips the wait for
the signed-in student only, for demos.
"""
from __future__ import annotations

import json
import os
import threading
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import dataset, db
from .auth import current_user

router = APIRouter(prefix="/api/checkins", tags=["agent"])

DAY = 86400
ASK_AGAIN_DAYS = 3
# Today's steps worth following up, and the question each one becomes
STEP_QUESTIONS = {"step_docs": ("ci_step_docs", "/eligibility/"),
                  "step_apply": ("ci_step_apply", "/eligibility/"),
                  "step_exam": ("ci_step_exam", "/exams/")}
# what "yes" does to a tracker card
CARD_NEXT = {"applied": "applied", "docs": "docs_submitted"}


def after_days() -> float:
    try:
        return max(0.0, float(os.environ.get("RAAH_CHECKIN_AFTER_DAYS", "3")))
    except ValueError:
        return 3.0


def _candidates(user_id: int | None, wait_s: float, now: int) -> list[dict]:
    """Everything that happened long enough ago to ask about. user_id=None means every student."""
    out: list[dict] = []
    who, args = ("AND user_id = ?", (user_id,)) if user_id else ("", ())
    cutoff = now - wait_s
    mentors = {m["id"]: m["name"] for m in dataset.get().get("mentors", [])}
    with db.connect() as con:
        cards = con.execute(f"SELECT id, user_id, title, \"column\", updated_at FROM applications "
                            f"WHERE \"column\" IN ('researching', 'applied') AND updated_at <= ? {who}", (cutoff, *args)).fetchall()
        reqs = con.execute(f"SELECT user_id, mentor_id, created_at FROM mentor_requests WHERE created_at <= ? {who}",
                           (cutoff, *args)).fetchall()
        steps = con.execute(f"SELECT user_id, text_key, vars, MIN(created_at) AS first FROM agent_activity "
                            f"WHERE kind = 'today' AND text_key IN ('step_docs', 'step_apply', 'step_exam') AND created_at <= ? {who} "
                            f"GROUP BY user_id, text_key, vars", (cutoff, *args)).fetchall()
    for r in cards:
        stage = "applied" if r["column"] == "researching" else "docs"
        out.append({"user_id": r["user_id"], "key": f"card:{r['id']}:{stage}", "text_key": f"ci_{stage}",
                    "vars": {"item": r["title"], "card": r["id"], "since": r["updated_at"]}, "href": "/tracker/"})
    for r in reqs:
        out.append({"user_id": r["user_id"], "key": f"mentor:{r['mentor_id']}", "text_key": "ci_mentor",
                    "vars": {"item": mentors.get(r["mentor_id"], r["mentor_id"]), "since": r["created_at"]}, "href": "/opportunity/"})
    for r in steps:
        text_key, href = STEP_QUESTIONS[r["text_key"]]
        v = json.loads(r["vars"] or "{}")
        item = str(v.get("exam") or "")
        out.append({"user_id": r["user_id"], "key": f"step:{r['text_key']}:{item}"[:80], "text_key": text_key,
                    "vars": {"item": item, "since": r["first"]}, "href": href})
    return out


def run_once(user_id: int | None = None, wait_days: float | None = None, now: int | None = None) -> int:
    """Create the check-ins that are due and do not exist yet. Returns how many were created."""
    now = now or int(time.time())
    wait = (after_days() if wait_days is None else wait_days) * DAY
    made = 0
    with db.connect() as con:
        for c in _candidates(user_id, wait, now):
            cur = con.execute("INSERT INTO checkins (user_id, key, text_key, vars, href, status, due_at, asked, created_at) "
                              "VALUES (?, ?, ?, ?, ?, 'open', ?, 0, ?) ON CONFLICT(user_id, key) DO NOTHING",
                              (c["user_id"], c["key"], c["text_key"], json.dumps(c["vars"], ensure_ascii=False), c["href"], now, now))
            made += cur.rowcount or 0
    return made


def _row(r) -> dict:
    v = json.loads(r["vars"] or "{}")
    days = max(1, int((time.time() - int(v.get("since") or r["created_at"])) // DAY))
    return {"id": r["id"], "key": r["key"], "text_key": r["text_key"], "vars": {**v, "days": days, "checkin": r["id"]},
            "href": r["href"] or "", "asked": r["asked"]}


def due(user_id: int, now: int | None = None) -> list[dict]:
    """Open check-ins whose time has come, oldest first."""
    now = now or int(time.time())
    with db.connect() as con:
        rows = con.execute("SELECT * FROM checkins WHERE user_id = ? AND status = 'open' AND due_at <= ? ORDER BY due_at, id",
                           (user_id, now)).fetchall()
    return [_row(r) for r in rows]


@router.get("")
def my_checkins(user: dict = Depends(current_user)):
    return due(user["id"])


@router.post("/refresh")
def refresh(soon: bool = False, user: dict = Depends(current_user)):
    """Look for new check-ins for this student now. soon=1 skips the waiting days (demo)."""
    made = run_once(user["id"], wait_days=0 if soon else None)
    return {"created": made, "due": due(user["id"])}


class Answer(BaseModel):
    answer: str  # yes | later | help


@router.post("/{cid}")
def answer(cid: int, body: Answer, user: dict = Depends(current_user)):
    if body.answer not in ("yes", "later", "help"):
        raise HTTPException(422, "answer must be yes, later or help")
    now = int(time.time())
    with db.connect() as con:
        r = con.execute("SELECT * FROM checkins WHERE id = ? AND user_id = ?", (cid, user["id"])).fetchone()
        if r is None:
            raise HTTPException(404, "check-in not found")
        v = json.loads(r["vars"] or "{}")
        if body.answer != "yes":
            con.execute("UPDATE checkins SET due_at = ?, asked = asked + 1 WHERE id = ?", (now + ASK_AGAIN_DAYS * DAY, cid))
            return {"status": "open", "ask_again_days": ASK_AGAIN_DAYS}
        con.execute("UPDATE checkins SET status = 'done', answered_at = ? WHERE id = ?", (now, cid))
        moved = None
        stage = r["key"].rsplit(":", 1)[-1] if r["key"].startswith("card:") else None
        if stage in CARD_NEXT and v.get("card"):
            # only from the column the question was about, so a card the student already moved on never goes back
            was = "researching" if stage == "applied" else "applied"
            cur = con.execute("UPDATE applications SET \"column\" = ?, updated_at = ? WHERE id = ? AND user_id = ? AND \"column\" = ?",
                              (CARD_NEXT[stage], now, int(v["card"]), user["id"], was))
            moved = CARD_NEXT[stage] if cur.rowcount else None
    from .today import log_activity  # today.py imports this module, so import here
    log_activity(user["id"], "checkin", f"act_{r['text_key']}", {"item": v.get("item", "")}, r["href"] or "")
    return {"status": "done", "moved_to": moved}


_started = threading.Event()


def start_background(interval_hours: float | None = None) -> bool:
    """Look for new check-ins every 6 hours. RAAH_CHECKIN_INTERVAL_HOURS=0 turns it off."""
    hours = float(os.environ.get("RAAH_CHECKIN_INTERVAL_HOURS", "6")) if interval_hours is None else interval_hours
    if hours <= 0 or _started.is_set():
        return False
    _started.set()

    def loop() -> None:
        time.sleep(120)
        while True:
            try:
                run_once()
            except Exception:
                pass
            time.sleep(hours * 3600)

    threading.Thread(target=loop, name="checkins", daemon=True).start()
    return True
