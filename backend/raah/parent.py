"""Parent / family dashboard (Raah Pro).

A parent visits /parent, enters the student's mobile number and a family PIN the student
chose, and gets a read-only view of the student's roadmap, watched exams, scholarship
applications in progress, recent lessons and unread notifications.

The family PIN is separate from the student's login PIN: it is a 4–8 digit code the
student sets specifically for a parent or guardian. It produces a short-lived JWT with
audience "raah-family" so it cannot be used on any student endpoint that checks "raah-app".

Endpoints
---------
POST /api/parent/set-pin        — student sets (or resets) their family PIN
DELETE /api/parent/pin          — student removes the family PIN
POST /api/parent/token          — parent exchanges phone + family PIN for a read-only JWT
GET  /api/parent/summary        — parent reads the student's data (family JWT required)
"""
from __future__ import annotations

import json
import time

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from . import db
from .auth import SIGNING_KEY, current_user

router = APIRouter(prefix="/api/parent", tags=["parent"])

_ph = PasswordHasher()
FAMILY_TOKEN_TTL = 60 * 60 * 8  # 8 hours; a school-day visit window


# ── student-side: set / remove the family PIN ─────────────────────────────────

class SetPinIn(BaseModel):
    family_pin: str  # 4–8 digits

class TokenIn(BaseModel):
    phone: str
    family_pin: str


def _require_family_pin(family_pin: str) -> None:
    if not family_pin.isdigit() or not (4 <= len(family_pin) <= 8):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "family PIN must be 4 to 8 digits")


@router.post("/set-pin", status_code=200)
def set_pin(body: SetPinIn, user: dict = Depends(current_user)):
    if user.get("role") != "student":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only students can set a family PIN")
    _require_family_pin(body.family_pin)
    hashed = _ph.hash(body.family_pin)
    with db.connect() as con:
        con.execute("UPDATE users SET family_pin_hash = ? WHERE id = ?", (hashed, user["id"]))
    return {"ok": True}


@router.delete("/pin", status_code=200)
def remove_pin(user: dict = Depends(current_user)):
    if user.get("role") != "student":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only students can remove their family PIN")
    with db.connect() as con:
        con.execute("UPDATE users SET family_pin_hash = NULL WHERE id = ?", (user["id"],))
    return {"ok": True}


# ── parent-side: exchange phone + PIN for a family JWT ────────────────────────

@router.post("/token")
def family_token(body: TokenIn):
    phone = body.phone.strip()[-10:]
    with db.connect() as con:
        row = con.execute(
            "SELECT id, name, is_pro, family_pin_hash FROM users WHERE phone = ? AND role = 'student'",
            (phone,),
        ).fetchone()
    if row is None or not row["family_pin_hash"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "no student found or family PIN not set")
    try:
        _ph.verify(row["family_pin_hash"], body.family_pin)
    except (VerificationError, InvalidHashError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong family PIN")
    now = int(time.time())
    token = jwt.encode(
        {"sub": str(row["id"]), "role": "parent", "name": row.get("name"),
         "is_pro": bool(row["is_pro"]), "iat": now, "exp": now + FAMILY_TOKEN_TTL,
         "aud": "raah-family"},
        SIGNING_KEY, algorithm="HS256",
    )
    return {"access_token": token, "token_type": "bearer", "expires_in": FAMILY_TOKEN_TTL,
            "student_name": row["name"]}


# ── parent view: read the student's data ─────────────────────────────────────

_bearer = HTTPBearer(auto_error=False)


def _family_user(cred: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if cred is None or cred.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "family token required",
                            headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = jwt.decode(cred.credentials, SIGNING_KEY, algorithms=["HS256"], audience="raah-family")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired family token",
                            headers={"WWW-Authenticate": "Bearer"})
    return claims


@router.get("/summary")
def summary(claims: dict = Depends(_family_user)):
    student_id = int(claims["sub"])
    with db.connect() as con:
        # student identity and Pro status
        u = con.execute("SELECT name, is_pro FROM users WHERE id = ?", (student_id,)).fetchone()
        if u is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "student not found")

        # roadmap is stored in the profile JSON
        prof_row = con.execute("SELECT data FROM profiles WHERE user_id = ?", (student_id,)).fetchone()
        profile = json.loads(prof_row["data"]) if prof_row else {}

        # watched exams
        exam_rows = con.execute(
            "SELECT ref_id FROM interests WHERE user_id = ? AND kind = 'exam' ORDER BY id",
            (student_id,),
        ).fetchall()

        # unread notifications (last 20)
        notif_rows = con.execute(
            "SELECT id, kind, payload, created_at FROM notifications "
            "WHERE user_id = ? AND read_at IS NULL ORDER BY id DESC LIMIT 20",
            (student_id,),
        ).fetchall()

        # recent lesson completions (last 20)
        lesson_rows = con.execute(
            "SELECT payload, received_at FROM sync_log "
            "WHERE user_id = ? AND kind = 'lesson_done' ORDER BY id DESC LIMIT 20",
            (student_id,),
        ).fetchall()

    watched_exams = [r["ref_id"] for r in exam_rows]
    notifications = [
        {"id": r["id"], "kind": r["kind"],
         **json.loads(r["payload"]), "created_at": r["created_at"]}
        for r in notif_rows
    ]
    lessons_done = []
    for r in lesson_rows:
        try:
            p = json.loads(r["payload"])
        except Exception:
            p = {}
        lessons_done.append({**p, "received_at": r["received_at"]})

    return {
        "student_name": u["name"],
        "is_pro": bool(u["is_pro"]),
        "roadmap_career": profile.get("roadmap_career"),
        "roadmap_at": profile.get("roadmap_at"),
        "language": profile.get("language", "en"),
        "watched_exams": watched_exams,
        "notifications": notifications,
        "lessons_done": lessons_done,
    }
