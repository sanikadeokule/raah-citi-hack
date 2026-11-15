"""Facilitator (teacher) layer: synthetic class, talent + dropout-risk flags, bulk recommend.

The class is SYNTHETIC (seeded, so the demo repeats). The dropout model is a
scikit-learn logistic regression trained on synthetic data and is labelled as
such in the UI. Scheme eligibility for "recommend to all eligible" uses the
same rules engine and the live dataset, so editing an income limit in the
spreadsheet changes how many students qualify.
"""
from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

try:
    from sklearn.linear_model import LogisticRegression
except ImportError:  # e.g. Windows Application Control blocking sklearn's compiled DLLs
    LogisticRegression = None


class _NumpyLogReg:
    """Plain NumPy logistic regression (gradient descent), used when scikit-learn cannot load."""

    def __init__(self, max_iter: int = 3000, lr: float = 0.1):
        self.max_iter, self.lr = max_iter, lr

    def fit(self, X, y):
        w, b = np.zeros(X.shape[1]), 0.0
        for _ in range(self.max_iter):
            p = 1 / (1 + np.exp(-(X @ w + b)))
            w -= self.lr * (X.T @ (p - y) / len(y) + w / len(y))
            b -= self.lr * float(np.mean(p - y))
        self.coef_, self.intercept_ = np.array([w]), np.array([b])
        return self

    def predict_proba(self, X):
        p = 1 / (1 + np.exp(-(np.asarray(X) @ self.coef_[0] + self.intercept_[0])))
        return np.column_stack([1 - p, p])

from . import dataset, engine

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

FIRST = ["Aarti", "Sakshi", "Pooja", "Komal", "Rutuja", "Sneha", "Pranali", "Vaishnavi", "Shital", "Dipali",
         "Kiran", "Rahul", "Omkar", "Sagar", "Akash", "Ganesh", "Tejas", "Vishal", "Sanket", "Nikhil",
         "Priyanka", "Ashwini", "Mayuri", "Swati", "Monali", "Amol", "Sachin", "Mahesh", "Suraj", "Prathamesh",
         "Gauri", "Neha", "Rupali", "Bhagyashree", "Yogesh", "Vikas", "Santosh", "Ajay", "Harshada", "Manasi"]
LAST = ["Pawar", "Shinde", "Jadhav", "Kale", "Gaikwad", "Bhosale", "More", "Kadam", "Thorat", "Wagh", "Dhumal", "Sonawane"]
INTERESTS = ["helping people", "biology", "health", "machines", "fixing things", "electrical", "computers",
             "art", "talking to people", "farming", "animals", "business", "sports", "maths", "science"]
CATS = ["OBC", "SC", "ST", "General", "EWS", "DNT"]
FEATURES = ["attendance_drop_pct", "marks_trend", "quiz_completion", "distance_km", "low_income", "sibling_working",
            "days_inactive"]
REASONS = {
    "attendance_drop_pct": lambda s: f"attendance fell {s['attendance_drop_pct']:.0f}% this term",
    "marks_trend": lambda s: f"marks down {abs(s['marks_trend']):.0f} points",
    "quiz_completion": lambda s: f"only {s['quiz_completion'] * 100:.0f}% of quizzes done",
    "distance_km": lambda s: f"school is {s['distance_km']:.0f} km away",
    "low_income": lambda s: "family income in the lowest band",
    "sibling_working": lambda s: "an older sibling already left school to work",
    "days_inactive": lambda s: f"no app use for {s['days_inactive']} days",
}


@lru_cache(maxsize=1)
def synthetic_class(seed: int = 7, n: int = 40) -> list[dict]:
    rng = np.random.default_rng(seed)
    talukas = [("Junnar", 19.2083, 73.8756), ("Ambegaon", 19.0301, 73.7980), ("Khed", 18.8590, 73.8850)]
    out = []
    for i in range(n):
        g = "F" if i % 2 == 0 else "M"
        t = talukas[i % 3]
        income = int(rng.choice([60000, 90000, 120000, 180000, 240000, 300000, 420000]))
        docs = ["aadhaar", "marksheet_10"]
        for d, p in (("caste_certificate", 0.6), ("income_certificate", 0.45), ("domicile_certificate", 0.7)):
            if rng.random() < p:
                docs.append(d)
        s = {
            "id": f"S{i + 1:02d}", "name": f"{FIRST[i]} {LAST[i % len(LAST)]}", "gender": g, "class": 10,
            "age": 15 + int(rng.integers(0, 2)), "taluka": t[0], "lat": t[1] + rng.normal(0, 0.03),
            "lon": t[2] + rng.normal(0, 0.03), "marks_pct": int(np.clip(rng.normal(64, 12), 35, 96)),
            "interests": list(rng.choice(INTERESTS, size=2, replace=False)), "category": str(rng.choice(CATS, p=[.35, .15, .12, .2, .1, .08])),
            "family_income_annual": income, "school_type": "government", "domicile": "Maharashtra",
            "documents": docs, "has_bank_account": bool(rng.random() < 0.8), "max_commute_km": int(rng.choice([10, 20, 30])),
            "attendance_drop_pct": float(np.clip(rng.normal(8, 9), 0, 45)), "marks_trend": float(rng.normal(0, 8)),
            "quiz_completion": float(np.clip(rng.normal(0.6, 0.25), 0, 1)), "quiz_score": int(np.clip(rng.normal(65, 18), 10, 100)),
            "distance_km": float(np.clip(rng.normal(6, 4), 0.5, 20)), "low_income": int(income <= 90000),
            "sibling_working": int(rng.random() < 0.2), "days_inactive": int(np.clip(rng.exponential(5), 0, 40)),
            "profile_completion": int(rng.choice([40, 60, 80, 100], p=[.15, .25, .3, .3])),
        }
        out.append(s)
    return out


def _x(s):
    return [s["attendance_drop_pct"] / 10, -s["marks_trend"] / 10, 1 - s["quiz_completion"], s["distance_km"] / 10,
            s["low_income"], s["sibling_working"], s["days_inactive"] / 10]


@lru_cache(maxsize=1)
def model():
    """Logistic regression on a synthetic history of 600 students."""
    rng = np.random.default_rng(42)
    X, y = [], []
    for _ in range(600):
        row = [max(0, rng.normal(0.8, 0.9)), rng.normal(0, 0.8), rng.uniform(0, 1), rng.uniform(0, 2),
               int(rng.random() < 0.3), int(rng.random() < 0.2), rng.exponential(0.6)]
        z = -4.0 + 1.1 * row[0] + 0.6 * row[1] + 1.2 * row[2] + 0.5 * row[3] + 0.8 * row[4] + 1.0 * row[5] + 0.9 * row[6]
        X.append(row)
        y.append(int(rng.random() < 1 / (1 + np.exp(-z))))
    model_cls = LogisticRegression if LogisticRegression is not None else _NumpyLogReg
    return model_cls(max_iter=1000 if LogisticRegression is not None else 3000).fit(np.array(X), np.array(y))


def flags(s: dict) -> dict:
    m = model()
    x = np.array(_x(s))
    p = float(m.predict_proba([x])[0][1])
    contrib = m.coef_[0] * x
    top = [FEATURES[i] for i in np.argsort(-contrib)[:2] if contrib[i] > 0]
    talent = s["quiz_score"] >= 75 and s["marks_pct"] >= 68
    return {"dropout_risk": round(p, 2), "risk_level": "high" if p >= 0.5 else ("medium" if p >= 0.3 else "low"),
            "reasons": [REASONS[f](s) for f in top], "talent": talent,
            "talent_reason": f"quiz score {s['quiz_score']} and {s['marks_pct']}% marks" if talent else None}


@router.get("/class")
def get_class():
    d = dataset.get()
    students = []
    interest_count: dict[str, int] = {}
    for s in synthetic_class():
        top = engine.rank_careers(d, s, 1)
        students.append({**s, **flags(s), "top_career": top[0]["career"]["name"] if top else None})
        for i in s["interests"]:
            interest_count[i] = interest_count.get(i, 0) + 1
    return {"synthetic": True, "students": students,
            "top_interests": sorted(interest_count.items(), key=lambda kv: -kv[1])[:5],
            "model_note": "Dropout risk: logistic regression trained on synthetic data (demo only)."}


@router.get("/eligible/{scheme_id}")
def eligible_for(scheme_id: str, plan_id: str | None = None):
    d = dataset.get()
    scheme = next(s for s in d["scholarships"] if s["id"] == scheme_id)
    plan = next((p for p in d["plans"] if p["id"] == plan_id), None)
    res = []
    for s in synthetic_class():
        ctx = dict(s)
        if plan:
            ctx["course_tags"] = plan["course_tags"]
            if "post_matric" in plan["course_tags"]:
                ctx["class"] = 11
        r = engine.check_scheme(scheme, ctx)
        if r["status"] in ("eligible", "eligible_missing_docs"):
            res.append({"id": s["id"], "name": s["name"], "status": r["status"], "missing_docs": r["missing_docs"]})
    return {"scheme": {"id": scheme["id"], "name": scheme["name"]}, "students": res}


class Recommend(BaseModel):
    scheme_id: str
    plan_id: str | None = None


NOTIFICATIONS: list[dict] = []


@router.post("/recommend")
def recommend(body: Recommend):
    e = eligible_for(body.scheme_id, body.plan_id)
    now = datetime.now(timezone.utc).isoformat()
    for s in e["students"]:
        NOTIFICATIONS.append({"student_id": s["id"], "scheme_id": body.scheme_id, "at": now,
                              "message": f"Your teacher recommends {e['scheme']['name']}",
                              "missing_docs": s["missing_docs"]})
    return {"sent": len(e["students"]), "scheme": e["scheme"], "students": e["students"]}


@router.get("/notifications/{student_id}")
def notifications(student_id: str):
    return [n for n in NOTIFICATIONS if n["student_id"] == student_id]
