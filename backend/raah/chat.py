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
# full-year exams only (same ids as web/lib/questions.ts); "unknown" means the student does not remember
EXAMS = ["class7_final", "class8_final", "class9_final", "class10_board", "class11_final", "class12_board", "unknown"]
# usual age for Class N is N+5 to N+6 (same rule as web/lib/questions.ts), with a 1-year buffer either side
USUAL_AGE_GAP, AGE_BUFFER = (5, 6), 1
MIN_EXAM_TOTAL = 100  # a total below this is a unit test, class test or one subject, not a year's result


class ProfileExtract(BaseModel):
    """What the model may fill in. Out-of-range or unknown values are rejected field by field."""
    name: str | None = Field(None, max_length=60)
    age: int | None = Field(None, ge=8, le=30)
    gender: Literal["F", "M"] | None = None
    class_: int | None = Field(None, alias="class", ge=1, le=12)
    marks_pct: float | None = Field(None, ge=0, le=100)
    marks_exam: Literal[tuple(EXAMS)] | None = None  # type: ignore[valid-type]
    marks_obtained: float | None = Field(None, ge=0, le=1500)
    marks_total: float | None = Field(None, ge=MIN_EXAM_TOTAL, le=1500)
    documents_none: bool | None = None
    age_class_ok: bool | None = None
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
            # a known taluka gets its map point; any other place name the student types is kept as they wrote it
            typed = re.sub(r"\s+", " ", str(v)).strip(" .,!?")
            v = next((t for t in talukas if t.lower() in typed.lower() or typed.lower() in t.lower()), None)
            if v is None:
                if not typed or len(typed) > 40 or re.search(r"\d", typed):
                    rejected.append(k)
                    continue
                v = typed.title() if typed.islower() else typed
        if k == "interests":
            exact = [t for t in tags if any(t in i.lower() or i.lower() in t for i in v)]
            # words the model kept in the student's own phrasing go through the embedding matcher
            loose = [m["tag"] for i in v if not any(t in i.lower() or i.lower() in t for t in tags)
                     for m in embed.match(i, tags)["tags"][:1]]
            v = list(dict.fromkeys(exact + loose)) or v[:5]
        clean[k] = v
    return _check_marks(clean, rejected)


def _check_marks(clean: dict, rejected: list[str]) -> tuple[dict, list[str]]:
    """Marks given as 'got / total' decide the percentage; the model's own arithmetic is not trusted.
    A total under MIN_EXAM_TOTAL was already refused above, so a 25/25 unit test never becomes 100%."""
    if "marks_total" in rejected:
        # without a believable total, any percentage the model worked out from it is also dropped
        for k in ("marks_obtained", "marks_pct"):
            if k in clean:
                clean.pop(k)
                rejected.append(k)
    got, total = clean.get("marks_obtained"), clean.get("marks_total")
    if got is not None and total is not None:
        if got > total:
            clean.pop("marks_obtained"), clean.pop("marks_total"), clean.pop("marks_pct", None)
            rejected += ["marks_obtained", "marks_total"]
        else:
            clean["marks_pct"] = round(got / total * 100, 1)
    return clean, list(dict.fromkeys(rejected))


REQUIRED = ["name", "age", "gender", "class", "interests", "marks_exam", "marks_pct", "taluka", "category",
            "family_income_annual", "max_commute_km", "can_stay_hostel", "documents"]


def age_fits_class(age, cls) -> bool:
    """True when age and class fit together, or either is unknown."""
    try:
        a, c = int(age), int(cls)
    except (TypeError, ValueError):
        return True
    return c + USUAL_AGE_GAP[0] - AGE_BUFFER <= a <= c + USUAL_AGE_GAP[1] + AGE_BUFFER


def missing_fields(p: dict) -> list[str]:
    """Fields still to ask, in the order the scripted questions ask them."""
    def done(f):
        if f == "marks_pct" and p.get("marks_exam") == "unknown":
            return True  # student does not remember; do not keep asking
        if f == "documents" and p.get("documents_none") is True:
            return True
        return p.get(f) not in (None, "", [])
    out = [f for f in REQUIRED if not done(f)]
    if not age_fits_class(p.get("age"), p.get("class")) and p.get("age_class_ok") is not True:
        # ask the student to check their age and class straight after the class question
        out.insert(out.index("interests") if "interests" in out else 0, "age_class_ok")
    return out


# How to ask for each field. Only the guide for the next field goes into the prompt, so a small model stays on track.
ASK = {
    "name": "Greet the student and ask their first name.",
    "age": "Ask their age in years. Example answer: 15.",
    "gender": "Ask if they are a girl or a boy, and say it is because some scholarships are only for girls.",
    "class": "Ask which class (standard) they are studying in now, 8 to 12. In the holidays, the class they are going into.",
    "age_class_ok": ("The age and class do not fit together (Class N students are usually N+5 to N+6 years old). "
                     "Kindly repeat both back, say most students in that class are that age, and ask if it is right. "
                     "Set age_class_ok true if they confirm; if they correct the age or class, return the corrected value."),
    "interests": "Ask what they enjoy doing, with examples like helping people, fixing machines, farming, drawing.",
    "marks_exam": ("Ask which FULL-YEAR exam result they can tell you: for a Class N student, the Class N-1 final exam, "
                   "or the Class 10 board (SSC) / Class 12 board (HSC). Say clearly it must NOT be a unit test or class test. "
                   "Never say only 'your last exam'."),
    "marks_pct": ("Ask, naming that exact exam, how many marks they got OUT OF how many total marks, e.g. '412 out of 500', "
                  "or their percentage like '82%'. If they give one number without 'out of' or '%', ask out of how much. "
                  f"If the total is under {MIN_EXAM_TOTAL} it is a unit test: kindly ask for the full-year result instead."),
    "taluka": ("Ask which taluka their home is in, explaining a taluka is the block their village belongs to (e.g. Junnar, Ambegaon). "
               "Any taluka is fine, even one not in the list."),
    "category": ("Ask their caste category as written on their caste certificate. If unsure, ask parents; "
                 "with no certificate, choose General for now."),
    "family_income_annual": ("Ask the whole family's income in ONE YEAR, everyone added together; a rough guess is fine, "
                             "or the amount on the income certificate."),
    "max_commute_km": "Ask how far, one way, they can travel each day to a college or training centre. 10 km is about 20-30 minutes by bus.",
    "can_stay_hostel": "Ask if they could stay in a hostel if the college is far, only if their family agrees.",
    "documents": ("Ask which papers they already have at home: Aadhaar card, Class 10 marksheet, caste certificate, "
                  "income certificate, domicile certificate, bank passbook. Having none is fine."),
}


class Turn(BaseModel):
    messages: list[dict]
    lang: str = "en"
    profile: dict = {}


def _system_turn(d: dict, lang: str, profile: dict) -> str:
    tags = sorted({t for c in d["careers"] for t in c["tags"]})
    talukas = [t["name"] for t in d["talukas"]]
    missing = missing_fields(profile)
    nxt = missing[0] if missing else None
    name = profile.get("name")
    return f"""You are Raah, a warm career guide for students from villages in Maharashtra. Many are using a phone for the first time.
Speak {LANG_NAME.get(lang, 'English')} in very short, simple sentences a Class 8 student understands. No English jargon in Marathi or Hindi.
Rules:
- Ask exactly ONE question per message, and add one example answer so the student knows what to type.
- Be specific. Never ask vague questions like "how much did you score?" without naming the exam and asking "out of how many".
- If the student's answer is unclear or impossible, say so kindly and ask the same question again with an example.
- {"The student's name is " + str(name) + ". Do not ask it again; use it sometimes." if name else "You do not know the student's name yet."}
- Never state fees, salaries, scholarship amounts or any other figures; the app calculates those from official data.
Next question to ask: {nxt or 'none, thank the student and say their career list is ready'}. {ASK.get(nxt, '')}
Still missing after that: {', '.join(missing[1:]) or 'nothing'}.
Allowed values: gender F or M; class 1-12; marks_exam one of {EXAMS}; marks_obtained and marks_total as the two numbers the student said
(marks_total is the exam's total, at least {MIN_EXAM_TOTAL}); marks_pct only if they gave a percentage; category one of {CATEGORIES};
taluka: the taluka the student named, spelled like this list when it is one of them: {talukas}; interests chosen from {tags}; documents chosen from {DOCS} (documents_none true if they have none);
family_income_annual in rupees per year; max_commute_km in km.
Reply with JSON only:
{{"reply": "<your next message to the student>", "profile": {{<only fields the student actually told you>}}, "done": <true when nothing important is missing>}}
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
    missing = missing_fields(merged)
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
