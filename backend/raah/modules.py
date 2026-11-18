"""Teacher-made modules, student progress and module commerce."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator, model_validator

from . import auth, dataset, db
from .money import Payee, PaymentIn, create_payment

router = APIRouter(prefix="/api/modules", tags=["modules"])
SUBSCRIPTION_DAYS = 30
RAZORPAY_API = "https://api.razorpay.com/v1"


def _razorpay_credentials() -> tuple[str, str]:
    key_id = os.environ.get("RAZORPAY_KEY_ID", "").strip()
    secret = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
    if not key_id or not secret:
        raise HTTPException(503, "Paid modules are unavailable until Razorpay test or live keys are configured")
    return key_id, secret


def _razorpay_call(method: str, path: str, *, body: dict | None = None) -> dict:
    key_id, secret = _razorpay_credentials()
    try:
        response = httpx.request(method, f"{RAZORPAY_API}{path}", auth=(key_id, secret), json=body, timeout=20)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("error", {}).get("description", "Razorpay rejected the request")
        except Exception:
            detail = "Razorpay rejected the request"
        raise HTTPException(502, detail[:240]) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Could not reach Razorpay. Please retry.") from exc


def _checkout(order_id: str, amount: float, module_title: str) -> dict:
    key_id, _ = _razorpay_credentials()
    return {"payment_required": True, "key_id": key_id,
            "order": {"id": order_id, "amount": int(round(amount * 100)), "currency": "INR"},
            "name": "Raah", "description": module_title}


def _activate_order(con, order_id: str, payment_id: str, amount_paise: int) -> bool:
    row = con.execute("SELECT e.*, m.price FROM enrolments e JOIN modules m ON m.id = e.module_id "
                      "WHERE e.razorpay_order_id = ?", (order_id,)).fetchone()
    if row is None:
        return False
    expected = int(round(float(row["price"]) * 100))
    if amount_paise != expected:
        return False
    if row["payment_status"] == "paid":
        return True
    share = _setting("teacher_share_of_module_sales")
    con.execute("UPDATE enrolments SET payment_status = 'paid', paid = ?, teacher_share = ?, "
                "razorpay_payment_id = ? WHERE id = ? AND payment_status <> 'paid'",
                (float(row["price"]), round(float(row["price"]) * share, 2), payment_id, row["id"]))
    return True


def _setting(key: str) -> float:
    a = dataset.get()["assumptions"].get(key)
    if not a or a["value"] is None:
        raise HTTPException(500, f"Assumptions sheet is missing '{key}'")
    return float(a["value"])


class QuizItem(BaseModel):
    q: str = Field(..., min_length=3, max_length=300)
    options: list[str] = Field(..., min_length=2, max_length=4)
    answer: int

    @model_validator(mode="after")
    def _answer_in_range(self):
        if not 0 <= self.answer < len(self.options):
            raise ValueError("answer must point at one of the options")
        return self


class ModuleIn(BaseModel):
    title: str = Field(..., min_length=3, max_length=120)
    lang: Literal["mr", "hi", "en"] = "mr"
    lesson: str = Field(..., min_length=20, max_length=3000)
    quiz: list[QuizItem] = Field(..., min_length=1, max_length=10)
    price_model: Literal["free", "per_module", "subscription"] = "free"
    price: float = Field(0, ge=0, le=5000)

    @field_validator("price")
    @classmethod
    def _round(cls, v):
        return round(v, 2)

    @model_validator(mode="after")
    def _price_matches_model(self):
        if self.price_model == "free":
            self.price = 0
        elif self.price <= 0:
            raise ValueError("set a price above ₹0 for a paid module or subscription")
        return self


def _row(r, with_answers=False) -> dict:
    quiz = json.loads(r["quiz"])
    if not with_answers:
        quiz = [{"q": x["q"], "options": x["options"]} for x in quiz]
    return {"id": r["id"], "title": r["title"], "lang": r["lang"], "lesson": r["lesson"], "quiz": quiz,
            "price_model": r["price_model"], "price": r["price"], "teacher_id": r["teacher_id"], "created_at": r["created_at"]}


# ------------------------------------------------------------------ teacher

@router.post("")
def create_module(body: ModuleIn, teacher: dict = Depends(auth.teacher_only)):
    with db.connect() as con:
        cur = con.execute("INSERT INTO modules (teacher_id, title, lang, lesson, quiz, price_model, price, created_at) "
                          "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                          (teacher["id"], body.title, body.lang, body.lesson, json.dumps([q.model_dump() for q in body.quiz], ensure_ascii=False),
                           body.price_model, body.price, int(time.time())))
        row = con.execute("SELECT * FROM modules WHERE id = ?", (cur.scalar(),)).fetchone()
    return _row(row, with_answers=True)


@router.get("/mine")
def my_modules(teacher: dict = Depends(auth.teacher_only)):
    with db.connect() as con:
        rows = con.execute("SELECT m.*, COUNT(e.id) AS enrolled, COUNT(e.completed_at) AS completed, "
                           "COALESCE(SUM(CASE WHEN e.payment_status = 'paid' THEN e.paid ELSE 0 END), 0) AS sales "
                           "FROM modules m LEFT JOIN enrolments e ON e.module_id = m.id "
                           "AND e.payment_status IN ('paid', 'legacy_sandbox') WHERE m.teacher_id = ? "
                           "GROUP BY m.id ORDER BY m.id DESC", (teacher["id"],)).fetchall()
    return [{**_row(r, with_answers=True), "enrolled": r["enrolled"], "completed": r["completed"], "sales": r["sales"]} for r in rows]


@router.get("/earnings")
def earnings(teacher: dict = Depends(auth.teacher_only)):
    with db.connect() as con:
        rows = con.execute("SELECT e.*, m.title FROM enrolments e JOIN modules m ON m.id = e.module_id "
                                  "WHERE m.teacher_id = ? ORDER BY e.id DESC", (teacher["id"],)).fetchall()
    rows = [r for r in rows if r["payment_status"] == "paid"]
    sales_share = sum(r["teacher_share"] for r in rows)
    completion = sum(r["completion_payout"] for r in rows)
    unpaid = sum(r["teacher_share"] + r["completion_payout"] for r in rows if not r["payout_id"])
    return {"share_of_sales": _setting("teacher_share_of_module_sales"),
            "payout_per_completion": _setting("payout_per_completed_enrolment"),
            "sales": sum(r["paid"] for r in rows), "sales_share": round(sales_share, 2),
            "enrolments": len(rows), "completions": sum(1 for r in rows if r["completed_at"]),
            "completion_payouts": round(completion, 2), "total": round(sales_share + completion, 2),
            "unpaid": round(unpaid, 2), "paid_out": round(sales_share + completion - unpaid, 2),
            "items": [{"module": r["title"], "paid": r["paid"], "teacher_share": r["teacher_share"],
                       "completed": bool(r["completed_at"]), "completion_payout": r["completion_payout"],
                       "payout_id": r["payout_id"], "at": r["created_at"]} for r in rows[:30]],
            "sandbox": True}


class PayoutIn(BaseModel):
    name: str = Field("Teacher (demo)", max_length=70)
    account: str = Field("000111222333", pattern=r"^\d{9,18}$")
    ifsc: str = Field("SNDB0000001", pattern=r"^[A-Z]{4}0[A-Z0-9]{6}$")


@router.post("/earnings/payout")
def payout(body: PayoutIn, teacher: dict = Depends(auth.teacher_only)):
    e = earnings(teacher)
    if e["unpaid"] <= 0:
        raise HTTPException(400, "nothing to pay out yet")
    pay = create_payment(PaymentIn(kind="teacher_payout", amount=e["unpaid"],
                                   payees=[Payee(name=body.name, account=body.account, ifsc=body.ifsc)],
                                   purpose=f"Raah module earnings ({e['enrolments']} enrolments, {e['completions']} completions)"))
    with db.connect() as con:
        rows = con.execute("SELECT e.id, e.teacher_share, e.completion_payout FROM enrolments e JOIN modules m ON m.id = e.module_id "
                           "WHERE m.teacher_id = ? AND e.payment_status = 'paid' AND e.payout_id IS NULL", (teacher["id"],)).fetchall()
        details = [{"enrolment_id": r["id"], "teacher_share": r["teacher_share"],
                    "completion_payout": r["completion_payout"]} for r in rows]
        con.execute("INSERT INTO module_payouts (teacher_id, reference, amount, status, provider, created_at, details) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (teacher["id"], pay["msg_id"], e["unpaid"], "initiated", "pain.001 sandbox", int(time.time()),
                     json.dumps(details)))
        con.execute("UPDATE enrolments SET payout_id = ? WHERE payout_id IS NULL AND payment_status = 'paid' AND module_id IN "
                    "(SELECT id FROM modules WHERE teacher_id = ?)", (pay["msg_id"], teacher["id"]))
    return pay


@router.get("/payouts")
def payout_history(teacher: dict = Depends(auth.teacher_only)):
    with db.connect() as con:
        batches = con.execute("SELECT * FROM module_payouts WHERE teacher_id = ? ORDER BY id DESC LIMIT 100",
                              (teacher["id"],)).fetchall()
        legacy = con.execute("SELECT e.payout_id AS reference, SUM(e.teacher_share + e.completion_payout) AS amount, "
                             "MAX(e.created_at) AS created_at, COUNT(*) AS enrolments "
                             "FROM enrolments e JOIN modules m ON m.id = e.module_id "
                             "WHERE m.teacher_id = ? AND e.payout_id IS NOT NULL "
                             "GROUP BY e.payout_id ORDER BY MAX(e.created_at) DESC", (teacher["id"],)).fetchall()
        items = con.execute("SELECT e.payout_id, m.title, e.teacher_share, e.completion_payout, e.created_at "
                            "FROM enrolments e JOIN modules m ON m.id = e.module_id "
                            "WHERE m.teacher_id = ? AND e.payout_id IS NOT NULL ORDER BY e.id DESC", (teacher["id"],)).fetchall()
    saved = {r["reference"]: dict(r) for r in batches}
    grouped: dict[str, list[dict]] = {}
    for item in items:
        grouped.setdefault(item["payout_id"], []).append({
            "module": item["title"], "teacher_share": item["teacher_share"],
            "completion_payout": item["completion_payout"], "created_at": item["created_at"],
        })
    result = []
    for row in legacy:
        ref = row["reference"]
        batch = saved.get(ref)
        details = json.loads(batch["details"]) if batch else None
        result.append({"reference": ref, "amount": batch["amount"] if batch else row["amount"],
                       "status": batch["status"] if batch else "initiated",
                       "provider": batch["provider"] if batch else "pain.001 sandbox",
                       "created_at": batch["created_at"] if batch else row["created_at"],
                       "enrolments": len(details) if details is not None else row["enrolments"],
                       "items": grouped.get(ref, [])})
    return result


# ------------------------------------------------------------------ student

@router.get("")
def list_modules(user: dict = Depends(auth.current_user)):
    with db.connect() as con:
        rows = con.execute("SELECT m.*, u.name AS teacher_name FROM modules m JOIN users u ON u.id = m.teacher_id "
                           "WHERE m.published = 1 ORDER BY m.id DESC LIMIT 50").fetchall()
        mine = {r["module_id"]: r for r in con.execute("SELECT * FROM enrolments WHERE user_id = ? "
                                                        "AND payment_status IN ('paid', 'legacy_sandbox')", (user["id"],)).fetchall()}
    out = []
    for r in rows:
        e = mine.get(r["id"])
        m = _row(r, with_answers=bool(e and e["completed_at"]))
        m["teacher_name"] = r["teacher_name"]
        m["enrolment"] = None if not e else {"paid": e["paid"], "score": e["score"], "completed": bool(e["completed_at"])}
        out.append(m)
    return out


@router.get("/progress")
def student_progress(user: dict = Depends(auth.require_role("student"))):
    with db.connect() as con:
        rows = con.execute("SELECT e.*, m.title, m.quiz, m.price_model FROM enrolments e "
                           "JOIN modules m ON m.id = e.module_id WHERE e.user_id = ? "
                           "AND e.payment_status IN ('paid', 'legacy_sandbox') "
                           "ORDER BY e.created_at DESC", (user["id"],)).fetchall()
    modules = []
    total_score = total_questions = 0
    paid_total = 0.0
    for row in rows:
        quiz = json.loads(row["quiz"])
        score, count = row["score"], len(quiz)
        if score is not None:
            total_score += score
            total_questions += count
        actual_paid = float(row["paid"] or 0) if row["payment_status"] == "paid" else 0.0
        paid_total += actual_paid
        modules.append({"course_id": row["module_id"], "title": row["title"],
                        "status": "completed" if row["completed_at"] else "in_progress",
                        "completed": bool(row["completed_at"]),
                        "score": score, "total": count, "paid": actual_paid,
                        "completed_at": row["completed_at"], "enrolled_at": row["created_at"]})
    profile = {}
    with db.connect() as con:
        saved = con.execute("SELECT data FROM profiles WHERE user_id = ?", (user["id"],)).fetchone()
    if saved:
        profile = json.loads(saved["data"])
    career_id = profile.get("roadmap_career")
    career = next((c for c in dataset.get()["careers"] if c["id"] == career_id), None)
    outlook = None if not career else {"career": career["name"], "income": career["income_text"],
                                       "training_income": career["training_income_text"],
                                       "status": career["income_status"], "sources": career["sources"],
                                       "last_checked": career["last_checked"]}
    return {"enrolled": len(modules), "completed": sum(1 for m in modules if m["completed"]),
            "average_score_pct": round(total_score / total_questions * 100) if total_questions else None,
            "scores_recorded": sum(1 for m in modules if m["score"] is not None),
            "module_spend": round(paid_total, 2), "income_outlook": outlook, "modules": modules}


def _subscribed(con, user_id: int, teacher_id: int) -> bool:
    since = int(time.time()) - SUBSCRIPTION_DAYS * 86400
    return con.execute("SELECT 1 FROM enrolments e JOIN modules m ON m.id = e.module_id WHERE e.user_id = ? AND m.teacher_id = ? "
                       "AND m.price_model = 'subscription' AND e.payment_status = 'paid' AND e.paid > 0 AND e.created_at > ?",
                       (user_id, teacher_id, since)).fetchone() is not None


@router.post("/{module_id}/enrol")
def enrol(module_id: int, user: dict = Depends(auth.require_role("student"))):
    share = _setting("teacher_share_of_module_sales")
    with db.connect() as con:
        m = con.execute("SELECT * FROM modules WHERE id = ? AND published = 1", (module_id,)).fetchone()
        if m is None:
            raise HTTPException(404, "module not found")
        existing = con.execute("SELECT * FROM enrolments WHERE module_id = ? AND user_id = ?", (module_id, user["id"])).fetchone()
        if existing and existing["payment_status"] == "paid":
            return {"enrolled": True, "paid": existing["paid"], "already": True, "sandbox": False}
        paid = 0.0 if m["price_model"] == "free" else float(m["price"])
        if m["price_model"] == "subscription" and _subscribed(con, user["id"], m["teacher_id"]):
            paid = 0.0
        if paid <= 0:
            if existing:
                con.execute("UPDATE enrolments SET paid = 0, teacher_share = 0, payment_status = 'paid', "
                            "razorpay_order_id = NULL WHERE id = ?", (existing["id"],))
            else:
                con.execute("INSERT INTO enrolments (module_id, user_id, paid, teacher_share, created_at, payment_status) "
                            "VALUES (?, ?, 0, 0, ?, 'paid')", (module_id, user["id"], int(time.time())))
            return {"enrolled": True, "paid": 0, "already": False, "sandbox": False}

        if existing and existing["razorpay_order_id"] and existing["payment_status"] == "pending":
            return {"enrolled": False, "paid": 0, "already": False,
                    **_checkout(existing["razorpay_order_id"], paid, m["title"])}

    # Create the provider order before creating/updating the pending enrolment. The browser
    # never chooses the amount; it comes from this published module row.
    receipt = f"mod-{module_id}-{user['id']}-{uuid.uuid4().hex[:8]}"[:40]
    order = _razorpay_call("POST", "/orders", body={
        "amount": int(round(paid * 100)), "currency": "INR", "receipt": receipt,
        "notes": {"module_id": str(module_id), "student_id": str(user["id"])},
    })
    with db.connect() as con:
        existing = con.execute("SELECT * FROM enrolments WHERE module_id = ? AND user_id = ?", (module_id, user["id"])).fetchone()
        if existing:
            con.execute("UPDATE enrolments SET paid = 0, teacher_share = 0, payment_status = 'pending', "
                        "razorpay_order_id = ?, razorpay_payment_id = NULL WHERE id = ?",
                        (order["id"], existing["id"]))
        else:
            con.execute("INSERT INTO enrolments (module_id, user_id, paid, teacher_share, created_at, payment_status, razorpay_order_id) "
                        "VALUES (?, ?, 0, 0, ?, 'pending', ?)",
                        (module_id, user["id"], int(time.time()), order["id"]))
    return {"enrolled": False, "paid": 0, "already": False, **_checkout(order["id"], paid, m["title"])}


class PaymentVerification(BaseModel):
    order_id: str
    payment_id: str
    signature: str


@router.post("/{module_id}/payment/verify")
def verify_module_payment(module_id: int, body: PaymentVerification, user: dict = Depends(auth.require_role("student"))):
    _, secret = _razorpay_credentials()
    expected_signature = hmac.new(secret.encode(), f"{body.order_id}|{body.payment_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_signature, body.signature):
        raise HTTPException(400, "Razorpay payment signature is invalid")
    with db.connect() as con:
        row = con.execute("SELECT e.*, m.price FROM enrolments e JOIN modules m ON m.id = e.module_id "
                          "WHERE e.module_id = ? AND e.user_id = ? AND e.razorpay_order_id = ?",
                          (module_id, user["id"], body.order_id)).fetchone()
    if row is None:
        raise HTTPException(404, "payment order not found for this student and module")
    payment = _razorpay_call("GET", f"/payments/{body.payment_id}")
    if payment.get("order_id") != body.order_id:
        raise HTTPException(400, "Razorpay payment does not belong to this order")
    if payment.get("status") != "captured":
        raise HTTPException(409, "Payment is not captured yet. Please wait for confirmation.")
    if payment.get("amount") != int(round(float(row["price"]) * 100)) or payment.get("currency") != "INR":
        raise HTTPException(400, "Razorpay payment amount does not match the module price")
    with db.connect() as con:
        if not _activate_order(con, body.order_id, body.payment_id, payment["amount"]):
            raise HTTPException(409, "Payment could not be matched to this enrolment")
    return {"enrolled": True, "paid": float(row["price"]), "payment_status": "paid"}


@router.post("/razorpay/webhook")
async def razorpay_webhook(request: Request):
    webhook_secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()
    if not webhook_secret:
        raise HTTPException(503, "Razorpay webhook secret is not configured")
    raw = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    expected = hmac.new(webhook_secret.encode(), raw, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(expected, signature):
        raise HTTPException(400, "invalid Razorpay webhook signature")
    try:
        event = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "invalid webhook JSON") from exc
    event_id = request.headers.get("x-razorpay-event-id")
    if not event_id:
        raise HTTPException(400, "missing Razorpay event id")
    event_name = event.get("event", "")
    entity = event.get("payload", {}).get("payment", {}).get("entity", {})
    with db.connect() as con:
        seen = con.execute("SELECT event_id FROM payment_webhook_events WHERE event_id = ?", (event_id,)).fetchone()
        if seen:
            return {"received": True, "duplicate": True}
        con.execute("INSERT INTO payment_webhook_events (event_id, event, received_at) VALUES (?, ?, ?)",
                    (event_id, event_name, int(time.time())))
        if event_name == "payment.captured" and entity.get("order_id") and entity.get("id"):
            _activate_order(con, entity["order_id"], entity["id"], int(entity.get("amount") or 0))
    return {"received": True}


class CompleteIn(BaseModel):
    answers: list[int]


@router.post("/{module_id}/complete")
def complete(module_id: int, body: CompleteIn, user: dict = Depends(auth.require_role("student"))):
    per_completion = _setting("payout_per_completed_enrolment")
    with db.connect() as con:
        m = con.execute("SELECT * FROM modules WHERE id = ?", (module_id,)).fetchone()
        e = con.execute("SELECT * FROM enrolments WHERE module_id = ? AND user_id = ?", (module_id, user["id"])).fetchone()
        if m is None or e is None:
            raise HTTPException(400, "enrol in the module first")
        if e["payment_status"] not in ("paid", "legacy_sandbox"):
            raise HTTPException(402, "complete payment before opening the module")
        quiz = json.loads(m["quiz"])
        score = sum(1 for q, a in zip(quiz, body.answers) if q["answer"] == a)
        if not e["completed_at"]:
            con.execute("UPDATE enrolments SET score = ?, completed_at = ?, completion_payout = ? WHERE id = ?",
                        (score, int(time.time()), per_completion, e["id"]))
        else:
            con.execute("UPDATE enrolments SET score = ? WHERE id = ?", (score, e["id"]))
    return {"score": score, "total": len(quiz), "answers": [q["answer"] for q in quiz]}
