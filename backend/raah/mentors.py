"""Mentors from the spreadsheet. A mentor's phone number is sent only after the student
accepts sharing their first name and class with that mentor (two-way, recorded consent)."""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import auth, dataset

router = APIRouter(prefix="/api/mentors", tags=["student"])


class MentorRequest(BaseModel):
    accept_sharing: bool
    # what the app shows as the student's profile, used when nothing is saved on the server yet
    name: str | None = Field(None, max_length=60)
    class_: int | None = Field(None, alias="class", ge=1, le=12)
    taluka: str | None = Field(None, max_length=40)


def _contact(d: dict, mentor_id: str) -> dict:
    return d["_private"]["mentor_contacts"].get(mentor_id, {})


@router.post("/{mentor_id}/request")
def request_mentor(mentor_id: str, body: MentorRequest, user: dict = Depends(auth.require_role("student"))):
    d = dataset.get()
    mentor = next((m for m in d["mentors"] if m["id"] == mentor_id), None)
    if mentor is None:
        raise HTTPException(404, "mentor not found")
    if not body.accept_sharing:
        raise HTTPException(400, "the mentor's number is shared only after you agree to share your name and class")
    with auth._lock:
        con = auth._db()
        row = con.execute("SELECT data FROM profiles WHERE user_id = ?", (user["id"],)).fetchone()
        prof = json.loads(row["data"]) if row else {}
        shared = {"first_name": (prof.get("name") or body.name or user.get("name") or "").split(" ")[0],
                  "class": prof.get("class") or body.class_, "taluka": prof.get("taluka") or body.taluka}
        con.execute("INSERT INTO mentor_requests (user_id, mentor_id, shared, created_at) VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(user_id, mentor_id) DO NOTHING",
                    (user["id"], mentor_id, json.dumps(shared, ensure_ascii=False), int(time.time())))
        con.commit()
    return {"mentor_id": mentor_id, "contact": _contact(d, mentor_id), "shared_with_mentor": shared}


@router.get("/mine")
def my_mentors(user: dict = Depends(auth.current_user)):
    d = dataset.get()
    with auth._lock:
        rows = auth._db().execute("SELECT mentor_id, created_at FROM mentor_requests WHERE user_id = ?", (user["id"],)).fetchall()
    return [{"mentor_id": r["mentor_id"], "contact": _contact(d, r["mentor_id"]), "since": r["created_at"]} for r in rows]


@router.get("/requests", dependencies=[Depends(auth.teacher_only)])
def all_requests():
    """For the teacher: which students connected with which mentor, and what they shared."""
    names = {m["id"]: m["name"] for m in dataset.get()["mentors"]}
    with auth._lock:
        rows = auth._db().execute("SELECT mentor_id, shared, created_at FROM mentor_requests ORDER BY id DESC LIMIT 100").fetchall()
    return [{"mentor_id": r["mentor_id"], "mentor": names.get(r["mentor_id"], r["mentor_id"]),
             "student": json.loads(r["shared"]), "at": r["created_at"]} for r in rows]
