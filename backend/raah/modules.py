"""Teacher-made modules: a short lesson, a quiz and a price (free, per module or monthly
subscription). Students enrol and complete them; teachers earn a share of sales from the
Assumptions sheet (teacher_share_of_module_sales) plus a fixed amount per completed
enrolment (payout_per_completed_enrolment), paid out as an ISO 20022 pain.001 file.
Payments are simulated (sandbox)."""
from __future__ import annotations

import json
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from . import auth, dataset
from .money import Payee, PaymentIn, create_payment

router = APIRouter(prefix="/api/modules", tags=["modules"])
SUBSCRIPTION_DAYS = 30


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
    with auth._lock:
        con = auth._db()
        cur = con.execute("INSERT INTO modules (teacher_id, title, lang, lesson, quiz, price_model, price, created_at) "
                          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                          (teacher["id"], body.title, body.lang, body.lesson, json.dumps([q.model_dump() for q in body.quiz], ensure_ascii=False),
                           body.price_model, body.price, int(time.time())))
        con.commit()
        row = con.execute("SELECT * FROM modules WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _row(row, with_answers=True)


@router.get("/mine")
def my_modules(teacher: dict = Depends(auth.teacher_only)):
    with auth._lock:
        con = auth._db()
        rows = con.execute("SELECT m.*, COUNT(e.id) AS enrolled, COUNT(e.completed_at) AS completed, COALESCE(SUM(e.paid), 0) AS sales "
                           "FROM modules m LEFT JOIN enrolments e ON e.module_id = m.id WHERE m.teacher_id = ? "
                           "GROUP BY m.id ORDER BY m.id DESC", (teacher["id"],)).fetchall()
    return [{**_row(r, with_answers=True), "enrolled": r["enrolled"], "completed": r["completed"], "sales": r["sales"]} for r in rows]


@router.get("/earnings")
def earnings(teacher: dict = Depends(auth.teacher_only)):
    with auth._lock:
        rows = auth._db().execute("SELECT e.*, m.title FROM enrolments e JOIN modules m ON m.id = e.module_id "
                                  "WHERE m.teacher_id = ? ORDER BY e.id DESC", (teacher["id"],)).fetchall()
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
    with auth._lock:
        con = auth._db()
        con.execute("UPDATE enrolments SET payout_id = ? WHERE payout_id IS NULL AND module_id IN "
                    "(SELECT id FROM modules WHERE teacher_id = ?)", (pay["msg_id"], teacher["id"]))
        con.commit()
    return pay


# ------------------------------------------------------------------ student

@router.get("")
def list_modules(user: dict = Depends(auth.current_user)):
    with auth._lock:
        con = auth._db()
        rows = con.execute("SELECT m.*, u.name AS teacher_name FROM modules m JOIN users u ON u.id = m.teacher_id "
                           "WHERE m.published = 1 ORDER BY m.id DESC LIMIT 50").fetchall()
        mine = {r["module_id"]: r for r in con.execute("SELECT * FROM enrolments WHERE user_id = ?", (user["id"],)).fetchall()}
    out = []
    for r in rows:
        e = mine.get(r["id"])
        m = _row(r, with_answers=bool(e and e["completed_at"]))
        m["teacher_name"] = r["teacher_name"]
        m["enrolment"] = None if not e else {"paid": e["paid"], "score": e["score"], "completed": bool(e["completed_at"])}
        out.append(m)
    return out


def _subscribed(con, user_id: int, teacher_id: int) -> bool:
    since = int(time.time()) - SUBSCRIPTION_DAYS * 86400
    return con.execute("SELECT 1 FROM enrolments e JOIN modules m ON m.id = e.module_id WHERE e.user_id = ? AND m.teacher_id = ? "
                       "AND m.price_model = 'subscription' AND e.paid > 0 AND e.created_at > ?", (user_id, teacher_id, since)).fetchone() is not None


@router.post("/{module_id}/enrol")
def enrol(module_id: int, user: dict = Depends(auth.require_role("student"))):
    share = _setting("teacher_share_of_module_sales")
    with auth._lock:
        con = auth._db()
        m = con.execute("SELECT * FROM modules WHERE id = ? AND published = 1", (module_id,)).fetchone()
        if m is None:
            raise HTTPException(404, "module not found")
        existing = con.execute("SELECT * FROM enrolments WHERE module_id = ? AND user_id = ?", (module_id, user["id"])).fetchone()
        if existing:
            return {"enrolled": True, "paid": existing["paid"], "already": True, "sandbox": True}
        paid = 0.0 if m["price_model"] == "free" else float(m["price"])
        if m["price_model"] == "subscription" and _subscribed(con, user["id"], m["teacher_id"]):
            paid = 0.0
        con.execute("INSERT INTO enrolments (module_id, user_id, paid, teacher_share, created_at) VALUES (?, ?, ?, ?, ?)",
                    (module_id, user["id"], paid, round(paid * share, 2), int(time.time())))
        con.commit()
    return {"enrolled": True, "paid": paid, "already": False, "sandbox": True}


class CompleteIn(BaseModel):
    answers: list[int]


@router.post("/{module_id}/complete")
def complete(module_id: int, body: CompleteIn, user: dict = Depends(auth.require_role("student"))):
    per_completion = _setting("payout_per_completed_enrolment")
    with auth._lock:
        con = auth._db()
        m = con.execute("SELECT * FROM modules WHERE id = ?", (module_id,)).fetchone()
        e = con.execute("SELECT * FROM enrolments WHERE module_id = ? AND user_id = ?", (module_id, user["id"])).fetchone()
        if m is None or e is None:
            raise HTTPException(400, "enrol in the module first")
        quiz = json.loads(m["quiz"])
        score = sum(1 for q, a in zip(quiz, body.answers) if q["answer"] == a)
        if not e["completed_at"]:
            con.execute("UPDATE enrolments SET score = ?, completed_at = ?, completion_payout = ? WHERE id = ?",
                        (score, int(time.time()), per_completion, e["id"]))
        else:
            con.execute("UPDATE enrolments SET score = ? WHERE id = ?", (score, e["id"]))
        con.commit()
    return {"score": score, "total": len(quiz), "answers": [q["answer"] for q in quiz]}
