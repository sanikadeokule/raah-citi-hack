"""Application tracker (Raah Pro): a Kanban board for college and scholarship applications.

Columns (in order): researching → applied → docs_submitted → waiting → result

The board is seeded from the student's roadmap on first use:
  - scholarships from the dataset whose eligibility status is eligible or eligible_missing_docs
  - colleges / training centres from nearest_centres for the plan's centre_type (optional, best-effort)

Each card has: title, kind (college/scholarship), notes (free text), deadline (ISO date), column.

Endpoints
---------
GET  /api/tracker          — list all cards for the signed-in student
POST /api/tracker          — add a card (or returns existing if ref_id already exists)
PATCH /api/tracker/{id}    — update column, notes or deadline
DELETE /api/tracker/{id}   — remove a card
POST /api/tracker/seed     — pre-populate from the roadmap (idempotent)
"""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from . import db
from .auth import current_user, has_pro

router = APIRouter(prefix="/api/tracker", tags=["tracker"])

COLUMNS = ("researching", "applied", "docs_submitted", "waiting", "result")


def _require_pro(user: dict) -> None:
    if not has_pro(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Raah Pro required")


# ── schemas ───────────────────────────────────────────────────────────────────

class CardIn(BaseModel):
    kind: str           # "college" | "scholarship"
    title: str
    ref_id: str | None = None
    column: str = "researching"
    notes: str = ""
    deadline: str | None = None


class CardPatch(BaseModel):
    column: str | None = None
    notes: str | None = None
    deadline: str | None = None
    title: str | None = None


def _fmt(row: dict) -> dict:
    return {"id": row["id"], "kind": row["kind"], "ref_id": row["ref_id"], "title": row["title"],
            "column": row["column"], "notes": row["notes"] or "", "deadline": row["deadline"],
            "created_at": row["created_at"], "updated_at": row["updated_at"]}


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("")
def list_cards(user: dict = Depends(current_user)):
    _require_pro(user)
    with db.connect() as con:
        rows = con.execute("SELECT * FROM applications WHERE user_id = ? ORDER BY id", (user["id"],)).fetchall()
    return [_fmt(r) for r in rows]


@router.post("", status_code=201)
def add_card(body: CardIn, user: dict = Depends(current_user)):
    _require_pro(user)
    if body.column not in COLUMNS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"column must be one of {COLUMNS}")
    now = int(time.time())
    with db.connect() as con:
        # prevent duplicate ref_ids for the same user
        if body.ref_id:
            existing = con.execute(
                "SELECT id FROM applications WHERE user_id = ? AND ref_id = ?", (user["id"], body.ref_id)
            ).fetchone()
            if existing:
                row = con.execute("SELECT * FROM applications WHERE id = ?", (existing["id"],)).fetchone()
                return _fmt(row)
        con.execute(
            "INSERT INTO applications (user_id, kind, ref_id, title, column, notes, deadline, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user["id"], body.kind, body.ref_id, body.title, body.column, body.notes, body.deadline, now, now),
        )
        row = con.execute(
            "SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user["id"],)
        ).fetchone()
    return _fmt(row)


@router.patch("/{card_id}")
def update_card(card_id: int, body: CardPatch, user: dict = Depends(current_user)):
    _require_pro(user)
    if body.column is not None and body.column not in COLUMNS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"column must be one of {COLUMNS}")
    with db.connect() as con:
        row = con.execute("SELECT * FROM applications WHERE id = ? AND user_id = ?", (card_id, user["id"])).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "card not found")
        updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
        if not updates:
            return _fmt(row)
        updates["updated_at"] = int(time.time())
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        con.execute(f"UPDATE applications SET {set_clause} WHERE id = ?", (*updates.values(), card_id))
        row = con.execute("SELECT * FROM applications WHERE id = ?", (card_id,)).fetchone()
    return _fmt(row)


@router.delete("/{card_id}", status_code=200)
def delete_card(card_id: int, user: dict = Depends(current_user)):
    _require_pro(user)
    with db.connect() as con:
        cur = con.execute("DELETE FROM applications WHERE id = ? AND user_id = ?", (card_id, user["id"]))
    if cur.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "card not found")
    return {"ok": True}


# ── seed from roadmap ─────────────────────────────────────────────────────────

@router.post("/seed", status_code=200)
def seed(user: dict = Depends(current_user)):
    """Pre-populate the board from the student's roadmap. Skips cards that already exist (by ref_id)."""
    _require_pro(user)
    from . import dataset, engine as eng_mod

    data = dataset.get()
    with db.connect() as con:
        prof_row = con.execute("SELECT data FROM profiles WHERE user_id = ?", (user["id"],)).fetchone()
    profile = json.loads(prof_row["data"]) if prof_row else {}
    career_id = profile.get("roadmap_career")

    cards: list[dict] = []

    # scholarships the student qualifies for
    eligible = eng_mod.eligibility(data, {**profile, "user_id": user["id"]})
    for e in eligible:
        if e.get("status") not in ("eligible", "eligible_missing_docs"):
            continue
        s = next((x for x in data.get("scholarships", []) if x["id"] == e["id"]), None)
        if s:
            cards.append({"kind": "scholarship", "ref_id": s["id"], "title": s["name"]})

    # colleges / training centres for the student's plan
    plan = next((p for p in data.get("plans", []) if p["career_id"] == career_id), None) if career_id else None
    # only a few careers have a plan; the others still get the colleges nearest to the student
    if profile.get("lat") is not None and profile.get("lon") is not None:
        centres = eng_mod.nearest_centres(
            data, {"lat": profile.get("lat"), "lon": profile.get("lon")},
            (plan or {}).get("centre_type"), 5
        )
        for c in centres:
            cards.append({"kind": "college", "ref_id": c["id"], "title": c["name"]})

    added = 0
    now = int(time.time())
    with db.connect() as con:
        for card in cards:
            existing = con.execute(
                "SELECT id FROM applications WHERE user_id = ? AND ref_id = ?", (user["id"], card["ref_id"])
            ).fetchone()
            if existing:
                continue
            con.execute(
                "INSERT INTO applications (user_id, kind, ref_id, title, column, notes, deadline, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 'researching', '', NULL, ?, ?)",
                (user["id"], card["kind"], card["ref_id"], card["title"], now, now),
            )
            added += 1

    return {"seeded": added, "total": len(cards)}
