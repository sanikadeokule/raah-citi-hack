"""Student-controlled scholarship applications: eligibility, documents, prefill and parent consent."""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from . import dataset, db, engine
from .auth import current_user

router = APIRouter(prefix="/api/scholarship-applications", tags=["scholarship applications"])
PREFILL_FIELDS = ("name", "age", "gender", "class", "taluka", "marks_pct", "category", "family_income_annual",
                  "school_type", "domicile", "documents", "religion", "parent_construction_worker", "parent_ex_serviceman")


def _student(user: dict) -> None:
    if user.get("role") != "student":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "student account required")


def _profile(user_id: int) -> dict:
    with db.connect() as con:
        row = con.execute("SELECT data FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    return json.loads(row["data"]) if row else {}


def _clean_prefill(value: dict | None, fallback: dict) -> dict:
    src = value if isinstance(value, dict) else fallback
    return {k: src[k] for k in PREFILL_FIELDS if k in src and src[k] not in (None, "", [])}


def _format(row) -> dict:
    return {"id": row["id"], "scheme_id": row["ref_id"], "title": row["title"], "stage": row["column"],
            "notes": row["notes"] or "", "deadline": row["deadline"],
            "checklist": json.loads(row["checklist"] or "[]"), "prefill": json.loads(row["prefill"] or "{}"),
            "parent_message": row["parent_message"], "parent_approved_at": row["parent_message_approved_at"],
            "created_at": row["created_at"], "updated_at": row["updated_at"]}


def _get_for_student(con, app_id: int, user_id: int):
    row = con.execute("SELECT * FROM applications WHERE id = ? AND user_id = ? AND kind = 'scholarship'",
                      (app_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "scholarship application not found")
    return row


class StartIn(BaseModel):
    scheme_id: str = Field(..., min_length=1, max_length=80)


class UpdateIn(BaseModel):
    stage: str | None = None
    checklist: list[dict] | None = None
    prefill: dict | None = None


class ParentMessageIn(BaseModel):
    message: str = Field(..., min_length=5, max_length=1000)


@router.get("")
def list_applications(user: dict = Depends(current_user)):
    _student(user)
    with db.connect() as con:
        rows = con.execute("SELECT * FROM applications WHERE user_id = ? AND kind = 'scholarship' ORDER BY updated_at DESC",
                           (user["id"],)).fetchall()
    return [_format(r) for r in rows]


@router.post("", status_code=201)
def start_application(body: StartIn, user: dict = Depends(current_user)):
    _student(user)
    data = dataset.get()
    scheme = next((s for s in data["scholarships"] if s["id"] == body.scheme_id), None)
    if not scheme:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "scholarship not found")
    profile = _profile(user["id"])
    result = next((e for e in engine.eligibility(data, profile) if e["id"] == scheme["id"]), None)
    if not result or result["status"] not in ("eligible", "eligible_missing_docs"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Complete the missing profile details before starting this application")

    doc_rules = {}
    for rule in scheme["rules"]:
        doc = rule.get("doc")
        if doc:
            doc_rules.setdefault(doc, rule.get("where") or "See the scholarship's official instructions")
    documents = profile.get("documents") or []
    checklist = [{"doc": doc, "where": where, "ready": doc in documents} for doc, where in doc_rules.items()]
    prefill = _clean_prefill(profile, profile)
    now = int(time.time())
    with db.connect() as con:
        existing = con.execute("SELECT * FROM applications WHERE user_id = ? AND kind = 'scholarship' AND ref_id = ?",
                               (user["id"], scheme["id"])).fetchone()
        if existing:
            con.execute("UPDATE applications SET prefill = ?, updated_at = ? WHERE id = ?",
                        (json.dumps(prefill, ensure_ascii=False), now, existing["id"]))
            return _format(con.execute("SELECT * FROM applications WHERE id = ?", (existing["id"],)).fetchone())
        con.execute(
            "INSERT INTO applications (user_id, kind, ref_id, title, \"column\", notes, deadline, checklist, prefill, created_at, updated_at) "
            "VALUES (?, 'scholarship', ?, ?, 'researching', '', NULL, ?, ?, ?, ?)",
            (user["id"], scheme["id"], scheme["name"], json.dumps(checklist, ensure_ascii=False),
             json.dumps(prefill, ensure_ascii=False), now, now),
        )
        row = con.execute("SELECT * FROM applications WHERE user_id = ? AND kind = 'scholarship' AND ref_id = ?",
                          (user["id"], scheme["id"])).fetchone()
    return _format(row)


@router.patch("/{app_id}")
def update_application(app_id: int, body: UpdateIn, user: dict = Depends(current_user)):
    _student(user)
    allowed = {"researching", "applied", "docs_submitted", "waiting", "result"}
    patch = body.model_dump(exclude_none=True)
    if "stage" in patch and patch["stage"] not in allowed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown application stage")
    with db.connect() as con:
        row = _get_for_student(con, app_id, user["id"])
        updates: dict = {}
        if "stage" in patch:
            updates["column"] = patch["stage"]
        if "checklist" in patch:
            scheme = next((s for s in dataset.get()["scholarships"] if s["id"] == row["ref_id"]), None)
            allowed_docs = {r.get("doc") for r in (scheme or {}).get("rules", []) if r.get("doc")}
            seen, clean = set(), []
            for item in patch["checklist"]:
                doc = str(item.get("doc", ""))
                if doc not in allowed_docs or doc in seen:
                    continue
                seen.add(doc)
                clean.append({"doc": doc, "where": str(item.get("where", ""))[:300], "ready": bool(item.get("ready"))})
            updates["checklist"] = json.dumps(clean, ensure_ascii=False)
        if "prefill" in patch:
            updates["prefill"] = json.dumps(_clean_prefill(patch["prefill"], {}), ensure_ascii=False)
        if updates:
            updates["updated_at"] = int(time.time())
            fields = ", ".join(f'"{k}" = ?' for k in updates)
            con.execute(f"UPDATE applications SET {fields} WHERE id = ? AND user_id = ?",
                        (*updates.values(), app_id, user["id"]))
        return _format(con.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone())


@router.post("/{app_id}/share-with-parent")
def share_with_parent(app_id: int, body: ParentMessageIn, user: dict = Depends(current_user)):
    _student(user)
    now = int(time.time())
    with db.connect() as con:
        _get_for_student(con, app_id, user["id"])
        account = con.execute("SELECT family_pin_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not account or not account["family_pin_hash"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "Set a family PIN in Parent mode before sharing a message")
        con.execute("UPDATE applications SET parent_message = ?, parent_message_approved_at = ?, updated_at = "
                    "? WHERE id = ? AND user_id = ?", (body.message.strip(), now, now, app_id, user["id"]))
        return _format(con.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone())

