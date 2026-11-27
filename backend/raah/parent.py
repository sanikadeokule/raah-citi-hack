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
import re
import time

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from . import dataset, db
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


class ParentAskIn(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    lang: str = "en"


def _career_card(career_id):
    """Plain facts about the chosen career, so a parent sees a name and the way in, not an id."""
    c = next((x for x in dataset.get()["careers"] if x["id"] == career_id), None) if career_id else None
    if c is None:
        return None
    return {"name": c["name"], "category": c.get("category"), "entry_path": c.get("entry_path"),
            "min_qualification": c.get("min_qualification"), "income": c.get("income_text")}


def _inr(value: float) -> str:
    """Format a rounded value with Indian digit grouping."""
    digits = str(int(round(value)))
    if len(digits) <= 3:
        return digits
    tail, head = digits[-3:], digits[:-3]
    groups = []
    while head:
        groups.append(head[-2:])
        head = head[:-2]
    return ",".join(reversed(groups)) + "," + tail


def _budget_from_question(question: str) -> float | None:
    q = question.lower().replace(",", "")
    match = re.search(r"(?:₹|rs\.?\s*)?\b(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l|thousands?|k)\b", q)
    if match:
        amount = float(match.group(1))
        unit = match.group(2)
        if unit.startswith(("crore", "cr")):
            return amount * 10_000_000
        if unit.startswith(("lakh", "lac", "l")):
            return amount * 100_000
        return amount * (1_000 if unit.startswith(("thousand", "k")) else 1)
    match = re.search(r"(?:under|below|within|less than|budget(?: of)?|limit(?: of)?)\s*(?:₹|rs\.?\s*)?(\d[\d ]{2,})\b", q)
    return float(match.group(1).replace(" ", "")) if match else None


def _saved_plan_cost_answer(question: str, lang: str, profile: dict) -> dict | None:
    """Answer cost/budget questions from the saved roadmap's calculator, not generic RAG snippets."""
    q = question.lower()
    cost_words = ("afford", "cost", "budget", "under", "below", "within", "fee", "price", "expensive",
                  "lakh", "lac", "crore", "rupee", "₹", "खर्च", "परवड", "किंमत", "बजेट")
    if not any(word in q for word in cost_words):
        return None
    career_id = profile.get("roadmap_career")
    if not career_id:
        return None
    data = dataset.get()
    plan = next((p for p in data["plans"] if p.get("career_id") == career_id), None)
    if not plan:
        return None
    from . import engine
    result = engine.compute_plan(data, profile, plan["id"])
    total = result["costs"]["total"]
    net = max(0, result["net_cost"])
    scholarship = result["scholarship"]["low"]
    budget = _budget_from_question(question)
    total_text, net_text = _inr(total), _inr(net)
    scholarship_text = _inr(scholarship)
    is_estimate = "estimate" in (plan.get("status") or "").lower()

    if lang == "hi":
        answer = (f"आपके सेव किए गए {plan['label']} के लिए Raah का अनुमानित कुल खर्च ₹{total_text} है। "
                  f"इसमें कोर्स फीस ₹{_inr(result['costs']['course_fees'])}, परीक्षा फीस ₹{_inr(result['costs']['exam_fees'])}, "
                  f"सामग्री ₹{_inr(result['costs']['materials'])} और अनुमानित यात्रा/रहने का खर्च ₹{_inr(result['costs']['living'])} शामिल है।")
        answer += f" सूची में शामिल छात्रवृत्ति घटाने के बाद अनुमानित खर्च ₹{net_text} है।" if scholarship else " इस योजना में कोई छात्रवृत्ति राशि नहीं जोड़ी गई है।"
        if budget is not None:
            answer += f" ₹{_inr(budget)} की सीमा के मुकाबले, छात्रवृत्ति के बाद का अनुमान इस सीमा के भीतर है।" if net <= budget else f" ₹{_inr(budget)} की सीमा के मुकाबले, छात्रवृत्ति के बाद का अनुमान इससे अधिक है।"
        answer += " यह Raah के उपलब्ध डेटा पर आधारित अनुमान है; कॉलेज से मौजूदा फीस पक्की करें।"
    elif lang == "mr":
        answer = (f"तुम्ही सेव केलेल्या {plan['label']} साठी Raah चा एकूण खर्चाचा अंदाज ₹{total_text} आहे. "
                  f"यात कोर्स फी ₹{_inr(result['costs']['course_fees'])}, परीक्षा फी ₹{_inr(result['costs']['exam_fees'])}, "
                  f"साहित्य ₹{_inr(result['costs']['materials'])} आणि अंदाजे प्रवास/राहण्याचा खर्च ₹{_inr(result['costs']['living'])} समाविष्ट आहे.")
        answer += f" योजनेतील शिष्यवृत्ती वजा केल्यावर अंदाजे खर्च ₹{net_text} आहे." if scholarship else " या अंदाजात शिष्यवृत्तीची रक्कम वजा केलेली नाही."
        if budget is not None:
            answer += f" ₹{_inr(budget)} च्या मर्यादेशी तुलना करता, शिष्यवृत्तीनंतरचा अंदाज मर्यादेत आहे." if net <= budget else f" ₹{_inr(budget)} च्या मर्यादेशी तुलना करता, शिष्यवृत्तीनंतरचा अंदाज त्यापेक्षा जास्त आहे."
        answer += " हा Raah मधील उपलब्ध माहितीवर आधारित अंदाज आहे; सध्याची फी कॉलेजकडून तपासा."
    else:
        answer = (f"For your saved {plan['label']} plan, Raah estimates total costs at ₹{total_text}. "
                  f"That includes course fees ₹{_inr(result['costs']['course_fees'])}, exam fees ₹{_inr(result['costs']['exam_fees'])}, "
                  f"materials ₹{_inr(result['costs']['materials'])}, and estimated travel/living costs ₹{_inr(result['costs']['living'])}.")
        answer += f" After the scholarship amount included in this plan, the estimated net cost is ₹{net_text}." if scholarship else " No scholarship amount is included in this plan."
        if budget is not None:
            answer += f" Compared with your ₹{_inr(budget)} limit, the estimated net cost is within the limit." if net <= budget else f" Compared with your ₹{_inr(budget)} limit, the estimated net cost is above the limit."
        answer += " This is a Raah estimate, not a guarantee; confirm current fees with the college."
    return {"answer": answer, "citations": [], "fallback": False, "grounded": True,
            "found": True, "provider": "raah_plan_calculator", "plan_id": plan["id"], "estimate": is_estimate}



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

        application_rows = con.execute(
            "SELECT id, title, \"column\", parent_message, parent_message_approved_at, parent_agreed_at, updated_at "
            "FROM applications WHERE user_id = ? AND kind = 'scholarship' ORDER BY updated_at DESC LIMIT 20",
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
        "career": _career_card(profile.get("roadmap_career")),
        "roadmap_career": profile.get("roadmap_career"),
        "roadmap_at": profile.get("roadmap_at"),
        "language": profile.get("language", "en"),
        "watched_exams": watched_exams,
        "notifications": notifications,
        "lessons_done": lessons_done,
        "applications": [{"id": r["id"], "parent_agreed_at": r["parent_agreed_at"], "title": r["title"], "stage": r["column"], "updated_at": r["updated_at"],
                           "student_approved_message": r["parent_message"] if r["parent_message_approved_at"] else None}
                          for r in application_rows],
    }


@router.post("/ask")
def parent_ask(body: ParentAskIn, claims: dict = Depends(_family_user)):
    """Answer a family question using the student's saved profile and verified Raah data."""
    if body.lang not in ("en", "hi", "mr"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "language must be en, hi or mr")
    student_id = int(claims["sub"])
    saved_profile = {}
    with db.connect() as con:
        row = con.execute("SELECT data FROM profiles WHERE user_id = ?", (student_id,)).fetchone()
    if row:
        saved_profile = json.loads(row["data"])
    allowed = ("class", "gender", "category", "family_income_annual", "taluka", "marks_pct", "can_stay_hostel",
               "school_type", "domicile", "religion", "parent_construction_worker", "parent_ex_serviceman")
    profile = {k: saved_profile[k] for k in allowed if k in saved_profile and saved_profile[k] not in (None, "", [])}
    plan_answer = _saved_plan_cost_answer(body.question, body.lang, saved_profile)
    if plan_answer:
        return plan_answer
    from .rag import AskIn, answer
    return answer(AskIn(question=body.question, lang=body.lang, profile=profile))


@router.post("/applications/{app_id}/agree")
def agree(app_id: int, claims: dict = Depends(_family_user)):
    """The parent's yes, given in Parent mode with the family token."""
    from .today import log_activity
    student_id = int(claims["sub"])
    now = int(time.time())
    with db.connect() as con:
        row = con.execute("SELECT id, title, parent_message_approved_at FROM applications WHERE id = ? AND user_id = ? "
                          "AND kind = 'scholarship'", (app_id, student_id)).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "application not found")
        if not row["parent_message_approved_at"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "The student has not asked yet")
        con.execute("UPDATE applications SET parent_agreed_at = ?, updated_at = ? WHERE id = ?", (now, now, app_id))
    log_activity(student_id, "chose", "act_parent_agreed", {"title": row["title"]}, "/apply/")
    return {"id": app_id, "parent_agreed_at": now}


@router.get("/plan-card")
def plan_card(claims: dict = Depends(_family_user)):
    """The numbers a parent asks about first, for the student's chosen path: per month, total, scholarships, payback."""
    from . import engine
    student_id = int(claims["sub"])
    with db.connect() as con:
        row = con.execute("SELECT data FROM profiles WHERE user_id = ?", (student_id,)).fetchone()
    profile = json.loads(row["data"]) if row else {}
    career_id = profile.get("roadmap_career")
    data = dataset.get()
    plan = next((p for p in data["plans"] if p.get("career_id") == career_id), None) if career_id else None
    if not plan:
        return {"plan": None}
    r = engine.compute_plan(data, profile, plan["id"])
    months = max(1, int(plan.get("course_months") or 1))
    net = max(0, r["net_cost"])
    return {"plan": {"label": plan["label"], "months": months, "total": round(r["costs"]["total"]),
                     "net": round(net), "per_month": round(net / months), "scholarship": round(r["scholarship"]["low"]),
                     "payback_months": (r["payback"].get("median") or {}).get("months_after_training"),
                     "estimate": "estimate" in (plan.get("status") or "").lower()}}
