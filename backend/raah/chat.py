"""AI conversation, profile extraction and grounded explanations.

The LLM talks; the data decides:
- /api/chat/turn   the model asks the next question and returns the profile it has understood
                   so far. Every field is validated with Pydantic; anything invalid is dropped.
- /api/chat/explain the model rewrites a career's score breakdown and dataset rows into one or
                   two friendly sentences. Any number in its answer that is not in the supplied
                   rows is treated as invented, and the template sentence is returned instead.
When no model is reachable both endpoints return fallback=true and the app uses its script.
"""
from __future__ import annotations

import json
import re
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, ValidationError, field_validator

from . import dataset, embed, engine, llm

router = APIRouter(prefix="/api/chat", tags=["ai"])

LANG_NAME = {"mr": "Marathi", "hi": "Hindi", "en": "English"}
CATEGORIES = ["General", "EWS", "OBC", "SC", "ST", "DNT", "EBC", "SEBC", "Navbouddha"]
DOCS = ["aadhaar", "marksheet_10", "marksheet_12", "caste_certificate", "income_certificate",
        "domicile_certificate", "bank_passbook", "disability_certificate"]


class ProfileExtract(BaseModel):
    """What the model may fill in. Out-of-range or unknown values are rejected field by field."""
    name: str | None = Field(None, max_length=60)
    age: int | None = Field(None, ge=8, le=30)
    gender: Literal["F", "M"] | None = None
    class_: int | None = Field(None, alias="class", ge=1, le=12)
    marks_pct: float | None = Field(None, ge=0, le=100)
    interests: list[str] | None = None
    taluka: str | None = None
    category: str | None = None
    family_income_annual: int | None = Field(None, ge=0, le=10_000_000)
    max_commute_km: int | None = Field(None, ge=0, le=200)
    can_stay_hostel: bool | None = None
    documents: list[str] | None = None

    model_config = {"populate_by_name": True}

    @field_validator("category")
    @classmethod
    def _cat(cls, v):
        if v is None:
            return v
        hit = next((c for c in CATEGORIES if c.lower() == str(v).strip().lower()), None)
        if not hit:
            raise ValueError("unknown category")
        return hit

    @field_validator("documents")
    @classmethod
    def _docs(cls, v):
        return None if v is None else [d for d in v if d in DOCS]


def validate_profile(raw: dict, talukas: list[str], tags: list[str]) -> tuple[dict, list[str]]:
    """Validate each field on its own so one bad value does not discard the rest."""
    clean, rejected = {}, []
    for key, val in (raw or {}).items():
        k = "class" if key in ("class", "class_") else key
        if val in (None, "", []):
            continue
        try:
            m = ProfileExtract.model_validate({k: val})
        except ValidationError:
            rejected.append(k)
            continue
        v = m.model_dump(by_alias=True).get(k)
        if v is None:
            rejected.append(k)
            continue
        if k == "taluka":
            v = next((t for t in talukas if t.lower() in str(v).lower() or str(v).lower() in t.lower()), None)
            if v is None:
                rejected.append(k)
                continue
        if k == "interests":
            exact = [t for t in tags if any(t in i.lower() or i.lower() in t for i in v)]
            # words the model kept in the student's own phrasing go through the embedding matcher
            loose = [m["tag"] for i in v if not any(t in i.lower() or i.lower() in t for t in tags)
                     for m in embed.match(i, tags)["tags"][:1]]
            v = list(dict.fromkeys(exact + loose)) or v[:5]
        clean[k] = v
    return clean, rejected


REQUIRED = ["name", "age", "gender", "class", "interests", "marks_pct", "taluka", "category",
            "family_income_annual", "max_commute_km", "can_stay_hostel", "documents"]


class Turn(BaseModel):
    messages: list[dict]
    lang: str = "en"
    profile: dict = {}


def _system_turn(d: dict, lang: str, profile: dict) -> str:
    tags = sorted({t for c in d["careers"] for t in c["tags"]})
    talukas = [t["name"] for t in d["talukas"]]
    missing = [f for f in REQUIRED if profile.get(f) in (None, "", [])]
    return f"""You are Raah, a warm career guide for rural students in Maharashtra. Speak {LANG_NAME.get(lang, 'English')} in short, simple sentences a Class 9 student understands.
Goal: learn the student's profile by asking ONE short question at a time. Still missing: {', '.join(missing) or 'nothing'}.
Never state fees, salaries, scholarship amounts or any other figures; the app calculates those from official data.
Allowed values: gender F or M; category one of {CATEGORIES}; taluka one of {talukas}; interests chosen from {tags};
documents chosen from {DOCS}; family_income_annual in rupees per year; max_commute_km in km; class 1-12.
Reply with JSON only:
{{"reply": "<your next message to the student>", "profile": {{<only fields you learned, using the keys {REQUIRED}>}}, "done": <true when nothing important is missing>}}
Profile so far: {json.dumps(profile, ensure_ascii=False)}"""


@router.get("/status")
def chat_status():
    return llm.status()


@router.post("/turn")
def turn(body: Turn):
    d = dataset.get()
    msgs = [{"role": "system", "content": _system_turn(d, body.lang, body.profile)}]
    msgs += [{"role": m["role"], "content": str(m["content"])[:1000]} for m in body.messages[-12:]
             if m.get("role") in ("user", "assistant")]
    try:
        text, provider = llm.chat(msgs, json_mode=True)
        out = llm.parse_json(text)
    except (llm.LLMUnavailable, ValueError, json.JSONDecodeError) as e:
        return {"fallback": True, "reason": str(e)}
    tags = sorted({t for c in d["careers"] for t in c["tags"]})
    clean, rejected = validate_profile(out.get("profile") or {}, [t["name"] for t in d["talukas"]], tags)
    merged = {**body.profile, **clean}
    if "taluka" in clean:
        tk = next((t for t in d["talukas"] if t["name"] == clean["taluka"]), None)
        if tk:
            merged["lat"], merged["lon"] = tk["lat"], tk["lon"]
    missing = [f for f in REQUIRED if merged.get(f) in (None, "", [])]
    return {"fallback": False, "provider": provider, "reply": str(out.get("reply") or "")[:600],
            "profile": merged, "learned": clean, "rejected": rejected, "missing": missing,
            "done": bool(out.get("done")) and len(missing) <= 2}


# ------------------------------------------------------------------ grounded explanations

class Explain(BaseModel):
    profile: dict
    career_id: str
    lang: str = "en"


_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> set[str]:
    return {n.replace(",", "") for n in _NUM.findall(text or "")}


def grounded(answer: str, context: str) -> bool:
    """True when every number in the answer also appears in the context it was given."""
    return _numbers(answer) <= _numbers(context)


@router.post("/explain")
def explain(body: Explain):
    d = dataset.get()
    ranked = {s["career"]["id"]: s for s in engine.rank_careers(d, body.profile, len(d["careers"]))}
    s = ranked.get(body.career_id)
    if not s:
        return {"fallback": True, "text": None}
    c = s["career"]
    plan = next((p for p in d["plans"] if p["career_id"] == c["id"]), None)
    facts = {"career": c["name"], "category": c["category"], "entry_path": c["entry_path"],
             "minimum_qualification": c["min_qualification"], "income_source_text": c["income_text"],
             "student_interests": body.profile.get("interests"), "matched_interests": s["matched"],
             "interest_fit": s["fit"], "related_interests": s["related"], "score_breakdown": s["breakdown"]}
    if plan:
        r = engine.compute_plan(d, body.profile, plan["id"])
        facts.update({"net_cost_rupees": r["net_cost"], "payback_months_after_training": r["payback"].get("median", {}).get("months_after_training"),
                      "scholarships_counted": [o["name"] for o in r["scholarship"]["options"] if o["id"] in r["scholarship"]["chosen"]]})
    context = json.dumps(facts, ensure_ascii=False)
    msgs = [{"role": "system", "content": f"You explain career matches to rural students in {LANG_NAME.get(body.lang, 'English')}. "
             "Write at most two short, encouraging sentences saying why this career fits the student. Use ONLY the facts given. "
             "If interest_fit is 'none', do not say it matches their interests: say it is a different kind of path worth knowing about. "
             "Do not add any number that is not in the facts. No greetings, no lists."},
            {"role": "user", "content": context}]
    try:
        text, provider = llm.chat(msgs, temperature=0.4, max_tokens=160)
    except llm.LLMUnavailable:
        return {"fallback": True, "text": s["why"]}
    text = text.strip().strip('"')
    if not text or not grounded(text, context):
        return {"fallback": True, "text": s["why"], "reason": "model added a figure not in the data"}
    return {"fallback": False, "provider": provider, "text": text}
