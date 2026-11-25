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
CATEGORIES = ["General", "EWS", "OBC", "SC", "ST", "DNT", "EBC", "SEBC", "VJNT", "SBC", "Navbouddha"]
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
- In Hindi or Marathi always write the app name as राह, never as Raah.
- {llm.off_topic_rule(lang)}  (If you replied with that sentence, set "profile" to {{}} and keep the question you were asking for the next turn.)
- Read the WHOLE conversation before you ask anything. If the student has already said something that answers any question, the one you are about to ask or a later one in the "still missing" list, even in passing, in the middle of another sentence, or with spelling mistakes (for example "im 12 and want to be a doctor and im a hirl" gives age 12, interest doctor and gender F), put it in "profile" and do NOT ask for it again. Never ask the student to repeat what they already told you.
- Pick the next question from the first item in "Next question" or "Still missing" that the conversation has NOT answered yet. If the suggested next question is already answered, skip it and ask the next unanswered one. If everything is answered, set done to true.
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


_DEV = str.maketrans("०१२३४५६७८९", "0123456789")


def _nums(text: str) -> list[float]:
    t = text.translate(_DEV)
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", re.sub(r"(\d),(\d)", r"\1\2", t))]


def exam_from_question(text: str) -> str | None:
    """The exam Raah just asked about ('your Class 10 Board exam', 'Class 9 final') as a dataset exam id."""
    m = re.findall(r"class\s*(\d+)\s*(board|final)", (text or "").lower())
    if not m:
        return None
    n, kind = m[-1]
    eid = f"class{n}_board" if kind == "board" else f"class{n}_final"
    return eid if eid in EXAMS else None


_GIRL = {"girl", "girls", "female", "woman", "lady", "gurl", "hirl", "girll", "grl", "gril", "girlie", "मुलगी", "लड़की", "लडकी", "स्त्री", "महिला"}
_BOY = {"boy", "boys", "male", "man", "gents", "मुलगा", "लड़का", "लडका", "पुरुष"}


def gender_from_text(text: str) -> str | None:
    """'F' or 'M' when the student says it in their own words, typos included ("im a hirl"). Words that describe
    someone else ("my son", "daughter") are not read as the student's own gender."""
    words = re.findall(r"[\wऀ-ॿ]+", (text or "").lower())
    girl = any(w in _GIRL for w in words)
    boy = any(w in _BOY for w in words)
    if girl != boy:
        return "F" if girl else "M"
    return None


def pre_extract(profile: dict, user_text: str, last_question: str) -> dict:
    """Plain answers (a class, marks, a percentage, km, age) are read here before the model sees them, so a small
    model that forgets to fill a field cannot make the student repeat themselves. Anything unclear is left to the model."""
    p = dict(profile)
    if not p.get("gender") and (g := gender_from_text(user_text)):
        p["gender"] = g  # said once, in any answer: never ask again
    missing = missing_fields(p)
    if not missing:
        return p
    nxt, ns, low = missing[0], _nums(user_text), user_text.lower()
    if nxt == "age" and ns and 8 <= ns[0] <= 30:
        p["age"] = int(ns[0])
    elif nxt == "class" and ns and 1 <= ns[0] <= 12:
        p["class"] = int(ns[0])  # "I am in class 10, I will go to 11": the class now comes first
    elif nxt == "max_commute_km" and ns and 0 <= ns[0] <= 200:
        p["max_commute_km"] = int(ns[0])
    elif nxt in ("marks_exam", "marks_pct") and ns:
        pct = bool(re.search(r"%|percent|per cent|टक्के|प्रतिशत", low))
        exam = p.get("marks_exam") if p.get("marks_exam") in EXAMS else exam_from_question(last_question)
        if len(ns) >= 2 and not pct:
            got, total = min(ns[0], ns[1]), max(ns[0], ns[1])
            if MIN_EXAM_TOTAL <= total <= 1500 and exam:
                p.update(marks_exam=exam, marks_obtained=got, marks_total=total, marks_pct=round(got / total * 100, 1))
        elif pct and exam:
            m = re.search(r"(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)", user_text.translate(_DEV), re.I)
            v = float(m.group(1)) if m else ns[-1]  # "class 10 i got 68%": the number next to the % sign
            if 0 <= v <= 100:
                p.update(marks_exam=exam, marks_pct=round(v, 1))
    return p


@router.get("/status")
def chat_status():
    return llm.status()


@router.post("/turn")
def turn(body: Turn):
    d = dataset.get()
    last_user = next((str(m["content"]) for m in reversed(body.messages) if m.get("role") == "user"), "")
    last_ask = next((str(m["content"]) for m in reversed(body.messages) if m.get("role") == "assistant"), "")
    body.profile = pre_extract(body.profile, last_user, last_ask)
    if not body.profile.get("gender"):  # said earlier in the chat (e.g. in the first message)
        for m in reversed(body.messages):
            if m.get("role") == "user" and (g := gender_from_text(str(m["content"]))):
                body.profile["gender"] = g
                break
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


class IkigaiTurn(BaseModel):
    stage: Literal["love", "good"]
    text: str = Field(max_length=500)
    lang: str = "en"
    have: list[str] = []


@router.post("/ikigai")
def ikigai_turn(body: IkigaiTurn):
    """Maps whatever the student says to the dataset's tags and answers like a person.
    Only tags that exist in the dataset are returned; the reply is the model's own words."""
    d = dataset.get()
    tags = sorted({t for c in d["careers"] for t in c["tags"]})
    ask = "what they love doing or learning about" if body.stage == "love" else "what they are good at"
    system = (
        f"You are Raah, a warm career guide for a rural Indian student. Reply in {LANG_NAME.get(body.lang, 'English')}, "
        f"in one or two short, simple sentences. The student is telling you {ask}. "
        "Accept their words as they are. Pick every topic from this list that fits what they said "
        "(a phrase can fit more than one): " + ", ".join(tags) + ". "
        "Say back what you understood in their own words, then ask one short follow-up that helps them add more. "
        'Never say you could not understand. Answer as JSON: {"reply": str, "tags": [str]}.'
    )
    try:
        text, provider = llm.chat([{"role": "system", "content": system},
                                   {"role": "user", "content": body.text[:500]}], json_mode=True)
        out = llm.parse_json(text)
    except (llm.LLMUnavailable, ValueError, json.JSONDecodeError) as e:
        return {"fallback": True, "reason": str(e)}
    picked = [t for t in (out.get("tags") or []) if isinstance(t, str) and t in tags]
    return {"fallback": False, "provider": provider, "reply": str(out.get("reply") or "")[:400],
            "tags": list(dict.fromkeys(picked))}


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


# ------------------------------------------------------------------ colleges for you

class CollegesRequest(BaseModel):
    profile: dict
    career_id: str
    lang: str = "en"


def find_colleges(d: dict, profile: dict, career_id: str) -> dict | None:
    """Nearest training centres and online courses for one career (shared with the MCP get_colleges tool)."""
    career = next((c for c in d["careers"] if c["id"] == career_id), None)
    if not career:
        return None

    # find all plans for this career to get centre_types
    plans = [p for p in d["plans"] if p["career_id"] == career_id]
    centre_types = list({p["centre_type"] for p in plans if p.get("centre_type")})

    # infer relevant centre types from career category/name when plans don't specify
    _health_keywords = {"health", "nurs", "gnm", "anm", "medical", "hospital", "pharma", "ayurved"}
    _career_text = (career.get("name", "") + " " + career.get("category", "") + " " + career.get("entry_path", "")).lower()
    _is_health_career = any(k in _career_text for k in _health_keywords)
    _health_type_keywords = {"nurs", "gnm", "anm", "hospital", "medical"}

    def _relevant(c: dict) -> bool:
        ctype = str(c.get("type", "")).lower()
        if not _is_health_career and any(k in ctype for k in _health_type_keywords):
            return False
        return True

    # gather centres: match by any relevant centre_type, or return all if none specified
    if centre_types:
        all_centres = []
        for ct in centre_types:
            all_centres.extend(engine.nearest_centres(d, profile, ct, 5))
        seen, deduped = set(), []
        for c in sorted(all_centres, key=lambda x: (x["distance_km"] is None, x["distance_km"] or 0)):
            if c["id"] not in seen:
                seen.add(c["id"])
                deduped.append(c)
        centres = deduped[:5]
    else:
        all_near = engine.nearest_centres(d, profile, None, 20)
        centres = [c for c in all_near if _relevant(c)][:5]

    # find online courses linked to this career
    cname_lower = career["name"].lower()
    courses = [c for c in d["courses"] if cname_lower in str(c.get("career_text") or "").lower()
               or career_id in str(c.get("career_text") or "")][:6]

    return {"career": career, "centres": centres, "courses": courses}


@router.post("/colleges")
def colleges_for_you(body: CollegesRequest):
    """Return nearest training centres + online courses for the student's career, with AI why-lines."""
    d = dataset.get()
    found = find_colleges(d, body.profile, body.career_id)
    if not found:
        return {"centres": [], "courses": [], "fallback": True}
    career, centres, courses = found["career"], found["centres"], found["courses"]

    # generate a single AI summary for the whole recommendation
    student_facts = {
        "student_name": body.profile.get("name"),
        "career": career["name"], "category": career["category"],
        "entry_path": career["entry_path"], "minimum_qualification": career["min_qualification"],
        "student_class": body.profile.get("class"), "student_taluka": body.profile.get("taluka"),
        "student_category": body.profile.get("category"),
        "centres_found": [{"name": c["name"], "type": c["type"], "taluka": c.get("taluka"),
                           "distance_km": c.get("distance_km"), "fees_text": c.get("fees_text")} for c in centres[:3]],
        "online_courses_found": [{"title": c["title"], "platform": c["platform"], "fee_text": c.get("fee_text")} for c in courses[:3]],
    }
    context = json.dumps(student_facts, ensure_ascii=False)
    msgs = [
        {"role": "system", "content": f"You help rural students in {LANG_NAME.get(body.lang, 'English')} find training for their chosen career. "
         "Write 2-3 short encouraging sentences introducing these options to the student. "
         "Mention the career name and 1-2 specific centre names or courses from the data. "
         "Use ONLY the facts given. No numbers that are not in the facts. No greetings, no lists."},
        {"role": "user", "content": context},
    ]
    summary = None
    provider = None
    try:
        text, provider = llm.chat(msgs, temperature=0.4, max_tokens=200)
        text = text.strip().strip('"')
        if text and grounded(text, context):
            summary = text
    except llm.LLMUnavailable:
        pass

    return {"centres": centres, "courses": courses, "summary": summary, "provider": provider, "fallback": summary is None}
