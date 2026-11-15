"""Partner APIs (colleges, employers, NGOs) behind OAuth2 client-credentials.

Demo credentials come from .env (PARTNER_CLIENT_ID / PARTNER_CLIENT_SECRET).
Candidate contact details are masked until the student accepts.
"""
from __future__ import annotations

import os
import time
import uuid

import jwt
from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

from . import dataset, engine
from .money import Payee, PaymentIn, create_payment
from .teacher import synthetic_class

router = APIRouter(prefix="/api/partners", tags=["partners (OAuth2)"])
KEY = os.environ.get("RAAH_SIGNING_KEY", "dev-only-signing-key-change-me-in-env-file")
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/partners/token")
OPPS: dict[str, dict] = {}
ACCEPTED: set[tuple[str, str]] = set()


def _clients():
    return {os.environ.get("PARTNER_CLIENT_ID", "demo-employer"): os.environ.get("PARTNER_CLIENT_SECRET", "demo-secret")}


@router.post("/token")
def token(grant_type: str = Form(...), client_id: str = Form(...), client_secret: str = Form(...)):
    if grant_type != "client_credentials" or _clients().get(client_id) != client_secret:
        raise HTTPException(401, "invalid client")
    exp = int(time.time()) + 3600
    return {"access_token": jwt.encode({"sub": client_id, "exp": exp, "scope": "partners"}, KEY, algorithm="HS256"),
            "token_type": "bearer", "expires_in": 3600}


def partner(tok: str = Depends(oauth2)) -> str:
    try:
        return jwt.decode(tok, KEY, algorithms=["HS256"])["sub"]
    except jwt.PyJWTError:
        raise HTTPException(401, "invalid token")


class Opportunity(BaseModel):
    title: str
    kind: str = "apprenticeship"
    career_id: str | None = None
    taluka: str | None = None
    stipend_per_month: float | None = None
    min_class: int | None = 10


@router.post("/opportunities")
def post_opportunity(o: Opportunity, who: str = Depends(partner)):
    oid = "OPP-" + uuid.uuid4().hex[:8]
    OPPS[oid] = {**o.model_dump(), "id": oid, "partner": who}
    return OPPS[oid]


@router.get("/candidates")
def candidates(opportunity_id: str, who: str = Depends(partner)):
    o = OPPS.get(opportunity_id)
    if not o:
        raise HTTPException(404, "opportunity not found")
    d = dataset.get()
    career = next((c for c in d["careers"] if c["id"] == o.get("career_id")), None)
    out = []
    for s in synthetic_class():
        if o.get("min_class") and s["class"] < o["min_class"]:
            continue
        match = 0
        if career:
            match = len(set(s["interests"]) & set(career["tags"]))
        accepted = (opportunity_id, s["id"]) in ACCEPTED
        out.append({"candidate_ref": "C-" + s["id"], "taluka": s["taluka"], "class": s["class"], "marks_pct": s["marks_pct"],
                    "interest_match": match,
                    "contact": {"name": s["name"], "phone": "+91-9XXXXXXX" + s["id"][-2:]} if accepted
                    else {"name": "hidden until student accepts", "phone": "hidden"}})
    out.sort(key=lambda c: (-c["interest_match"], -c["marks_pct"]))
    return out[:15]


@router.post("/candidates/{candidate_ref}/accept", tags=["student"])
def student_accepts(candidate_ref: str, opportunity_id: str):
    """Called from the student app when the student accepts; unmasks contact for that partner only."""
    ACCEPTED.add((opportunity_id, candidate_ref.removeprefix("C-")))
    return {"ok": True}


class Completion(BaseModel):
    teacher_name: str = "Teacher (demo)"
    teacher_account: str = "000111222333"
    teacher_ifsc: str = "SNDB0000001"
    payout_amount: float


@router.post("/enrolments/{enrolment_id}/complete")
def complete(enrolment_id: str, c: Completion, who: str = Depends(partner)):
    pay = create_payment(PaymentIn(kind="teacher_payout", amount=c.payout_amount,
                                   payees=[Payee(name=c.teacher_name, account=c.teacher_account, ifsc=c.teacher_ifsc)],
                                   purpose=f"Enrolment {enrolment_id} completed ({who})"))
    return {"enrolment_id": enrolment_id, "status": "completed", "payout": pay}


@router.get("/opportunities/live", tags=["student"])
def live_opportunities():
    """Apprenticeships straight from the dataset (NAPS + Central Railway) plus partner posts."""
    d = dataset.get()
    return {"naps": d["naps"], "railway": d["railway"], "partner_posts": list(OPPS.values())}
