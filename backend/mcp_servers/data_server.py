"""raah-data: Raah's backend logic as Model Context Protocol (MCP) tools.

The Ask Raah agent (raah/agent.py) starts this server over stdio through raah/mcp_client.py, lists its
tools and calls them while it reasons. Because it is a normal MCP server, any MCP client (Claude Desktop,
the MCP Inspector, another agent) can use it too:

    cd backend && python -m mcp_servers.data_server

Every tool reads raah-dataset.xlsx through dataset.get(), exactly like the REST endpoints, so the agent
can only repeat figures that are in the data ("AI explains, data decides"). Results are trimmed to what
a model needs: names, statuses, amounts as written, and the official source link.
"""
from __future__ import annotations

import json
import re

from raah import dataset, db, engine

SERVER_NAME = "raah-data"
INSTRUCTIONS = ("Tools over Raah's verified dataset of careers, training centres, colleges, scholarships and exams for "
                "rural students in Maharashtra. Pass the student's profile (class, gender, category, family_income_annual, "
                "interests, taluka, marks_pct, documents) where a tool asks for it. Quote figures exactly as returned.")

PROFILE_KEYS = ("name", "age", "gender", "class", "taluka", "lat", "lon", "marks_pct", "interests", "category",
                "family_income_annual", "max_commute_km", "can_stay_hostel", "documents", "exams_passed",
                "disability_pct", "domicile", "has_bank_account", "school_type", "parent_hazardous_occupation")


def clean_profile(profile: dict | None) -> dict:
    """Only known profile fields; the taluka's map point is filled in when the dataset knows it."""
    p = {k: v for k, v in (profile or {}).items() if k in PROFILE_KEYS and v not in (None, "", [])}
    if p.get("taluka") and p.get("lat") is None:
        tk = next((t for t in dataset.get()["talukas"] if str(t["name"]).lower() == str(p["taluka"]).lower()), None)
        if tk:
            p["lat"], p["lon"] = tk["lat"], tk["lon"]
    return p


def find_career(d: dict, career: str) -> dict | None:
    """A career by ID (CAR01) or by name, allowing a partial name ('nurse', 'electrician')."""
    q = str(career or "").strip().lower()
    if not q:
        return None
    for c in d["careers"]:
        if c["id"].lower() == q or c["name"].lower() == q:
            return c
    words = [w for w in re.findall(r"[a-z]+", q) if len(w) > 2]
    best, best_hits = None, 0
    for c in d["careers"]:
        name = c["name"].lower()
        hits = sum(1 for w in words if w[:5] in name) + (5 if q in name else 0)
        if hits > best_hits:
            best, best_hits = c, hits
    return best


def _careers_list(d: dict) -> list[dict]:
    return [{"id": c["id"], "name": c["name"]} for c in d["careers"]]


def _scheme(e: dict) -> dict:
    out = {"id": e["id"], "name": e["name"], "status": e["status"], "amount": e["amount_text"],
           "apply_via": e["apply_via"], "source": e["source"]}
    unknown = [r["label"] for r in e["rules"] if r["status"] == "unknown"]
    failed = [r["label"] for r in e["rules"] if r["status"] == "fail"]
    if e["missing_docs"]:
        out["missing_documents"] = [{"doc": r["doc"], "where": r["where"]} for r in e["rules"]
                                    if r.get("doc") in e["missing_docs"]] or e["missing_docs"]
    if unknown:
        out["needs_info"] = unknown
    if failed:
        out["fails"] = failed
    return out


# ------------------------------------------------------------------ tools (plain functions, unit tested directly)

def search_dataset(query: str, k: int = 5) -> dict:
    """Search every sheet of Raah's dataset (hybrid vector + keyword search). Use for any fact not covered by another tool."""
    from raah import rag

    res = rag.search(str(query or "")[:300], max(1, min(int(k or 5), 8)))
    idx = rag.get_index()
    rows = []
    for i, score in res["hits"]:
        c = idx.chunks[i]
        rows.append({"sheet": c["sheet"], "row_id": c["row_id"], "title": c["title"], "excel_rows": c["excel_rows"],
                     "text": c["text"][:900], "source": c["source"], "score": score})
    return {"rows": rows, "method": res["method"]}


def rank_careers(profile: dict, n: int = 5) -> dict:
    """Rank careers for a student: interest fit first, then eligibility, affordability and local demand."""
    d = dataset.get()
    ranked = engine.rank_careers(d, clean_profile(profile), max(1, min(int(n or 5), 10)))
    return {"careers": [{"id": s["career"]["id"], "name": s["career"]["name"], "category": s["career"]["category"],
                         "score": s["score"], "fit": s["fit"], "why": s["why"], "matched_interests": s["matched"],
                         "breakdown": s["breakdown"], "entry_path": s["career"]["entry_path"],
                         "min_qualification": s["career"]["min_qualification"], "income": s["career"]["income_text"],
                         "plan_id": s["plan_id"]} for s in ranked]}


def compute_plan(profile: dict, plan_id: str = "", career: str = "", hostel: bool = False) -> dict:
    """Cost of a training path after scholarships and stipends, and the month it pays back. Give a plan_id or a career."""
    d = dataset.get()
    plan = next((p for p in d["plans"] if p["id"].lower() == str(plan_id).strip().lower()), None) if plan_id else None
    if plan is None and career:
        c = find_career(d, career)
        plan = next((p for p in d["plans"] if c and p["career_id"] == c["id"]), None)
    if plan is None:
        return {"error": "no plan found; pass plan_id from rank_careers or a career name",
                "plans": [{"id": p["id"], "path": p["label"]} for p in d["plans"]][:40]}
    r = engine.compute_plan(d, clean_profile(profile), plan["id"], {"hostel": bool(hostel)})
    sch, inc = r["scholarship"], r["income"]
    med, low = r["payback"].get("median") or {}, r["payback"].get("low") or {}
    return {"plan": {"id": plan["id"], "path": plan["label"], "course_months": plan["course_months"], "steps": plan["steps"]},
            "costs": r["costs"], "scholarships_counted": [o["name"] for o in sch["options"] if o["id"] in sch["chosen"]],
            "scholarship_range": {"low": sch["low"], "high": sch["high"]}, "stipend": r["stipend"],
            "net_cost": r["net_cost"], "family_gap": r["family_gap"],
            "monthly_income_after_training": {"low": inc["low"], "median": inc["median"], "high": inc["high"], "source": inc["source"]},
            "payback_months_after_training": {"median": med.get("months_after_training"), "low_income_case": low.get("months_after_training")},
            "nearest_centre": (r.get("centres") or [{}])[0].get("name")}


def check_eligibility(profile: dict, scheme_id: str = "", career: str = "") -> dict:
    """Rule-by-rule scholarship/scheme check with missing documents. Optionally one scheme_id, or the course path of a career."""
    d = dataset.get()
    p = clean_profile(profile)
    plan, out = None, {}
    if career:
        c = find_career(d, career)
        if not c:
            return {"error": f"no career matching '{career}'", "careers": _careers_list(d)}
        plan = next((x for x in d["plans"] if x["career_id"] == c["id"]), None)
        out["career"] = {"id": c["id"], "name": c["name"], "min_qualification": c["min_qualification"],
                         "class_ok": (p.get("class") or 0) >= (c.get("min_class") or 0) if p.get("class") else None}
    elig = engine.eligibility(d, p, plan)
    if scheme_id:
        hit = [e for e in elig if e["id"].lower() == scheme_id.strip().lower()]
        if not hit:
            return {"error": f"no scheme '{scheme_id}'", "schemes": [{"id": s["id"], "name": s["name"]} for s in d["scholarships"]]}
        e = hit[0]
        return {**out, **_scheme(e), "rules": [{"rule": r["label"], "status": r["status"]} for r in e["rules"]]}
    out["schemes"] = [_scheme(e) for e in elig if e["status"] != "not_eligible"][:8]
    out["not_eligible_count"] = sum(1 for e in elig if e["status"] == "not_eligible")
    return out


def get_scholarships(profile: dict) -> dict:
    """Scholarships the student is eligible for now, eligible once documents are ready, or may get with more details."""
    elig = engine.eligibility(dataset.get(), clean_profile(profile))
    groups = {"eligible": [], "eligible_missing_docs": [], "need_info": []}
    for e in elig:
        if e["status"] in groups:
            groups[e["status"]].append(_scheme(e))
    return {**{k: v[:6] for k, v in groups.items()},
            "not_eligible_count": sum(1 for e in elig if e["status"] == "not_eligible")}


def nearest_centres(profile: dict, centre_type: str = "", n: int = 3) -> dict:
    """Nearest training centres (ITI, nursing school, polytechnic...) to the student's taluka, with distance."""
    rows = engine.nearest_centres(dataset.get(), clean_profile(profile), centre_type or None, max(1, min(int(n or 3), 8)))
    return {"centres": [{"name": x["name"], "type": x["type"], "taluka": x.get("taluka"), "distance_km": x.get("distance_km"),
                         "approximate": x.get("approximate"), "courses": x.get("courses"), "fees": x.get("fees_text"),
                         "source": x.get("source")} for x in rows]}


def get_colleges(profile: dict, career: str = "") -> dict:
    """Colleges and training centres near the student plus online courses for a career (their top-ranked career if none given)."""
    from raah.chat import find_colleges  # chat.py owns the matching rules for the Colleges For You tab

    d = dataset.get()
    p = clean_profile(profile)
    c = find_career(d, career) if career else None
    if c is None and career:
        return {"error": f"no career matching '{career}'", "careers": _careers_list(d)}
    if c is None:
        top = engine.rank_careers(d, p, 1)
        c = top[0]["career"] if top else None
    found = find_colleges(d, p, c["id"]) if c else None
    if not found:
        return {"error": "no career to look up colleges for"}
    return {"career": {"id": c["id"], "name": c["name"]},
            "centres": [{"name": x["name"], "type": x["type"], "taluka": x.get("taluka"), "distance_km": x.get("distance_km"),
                         "approximate": x.get("approximate"), "courses": x.get("courses"), "fees": x.get("fees_text"),
                         "seats": x.get("seats"), "source": x.get("source")} for x in found["centres"]],
            "online_courses": [{"title": x.get("title"), "platform": x.get("platform"), "fee": x.get("fee_text"),
                                "duration": x.get("duration"), "link": x.get("link") or x.get("source")}
                               for x in found["courses"]]}


def _watch_status(exam_ids: list[str]) -> dict:
    """What the exam date watcher last saw on each exam's official site."""
    if not exam_ids:
        return {}
    try:
        with db.connect() as con:
            rows = con.execute("SELECT ref_id, status, last_checked, last_changed FROM source_watch WHERE kind = 'exam'").fetchall()
    except Exception:  # no database (the server run on its own): dates still come from the dataset
        return {}
    return {r["ref_id"]: {"status": r["status"], "last_checked": r["last_checked"], "last_changed": r["last_changed"]}
            for r in rows if r["ref_id"] in exam_ids}


def list_exams(career: str = "") -> dict:
    """Entrance exams/admissions with last dates, usual timing, fees and official site. Filter by a career, or an exam ID/name."""
    d = dataset.get()
    q = str(career or "").strip().lower()
    c = None
    if not q:
        exams = d["exams"]
    else:
        exams = [e for e in d["exams"] if e["id"].lower() == q or q in str(e["name"]).lower()]
        if not exams:
            c = find_career(d, career)
            if not c:
                return {"error": f"no exam or career matching '{career}'", "careers": _careers_list(d)}
            ids = list(dict.fromkeys(x for p in d["plans"] if p["career_id"] == c["id"] for x in p["exams"]))
            exams = [e for e in d["exams"] if e["id"] in ids]
    watch = _watch_status([e["id"] for e in exams])
    return {"career": {"id": c["id"], "name": c["name"]} if c else None,
            "exams": [{"id": e["id"], "name": e["name"], "conducted_by": e["by"], "who_can_apply": e["eligibility"],
                       "selection": e["selection"], "last_cycle_dates": e["dates"], "usual_timing": e["timing"],
                       "fee_open": e["fee_open"], "fee_reserved": e["fee_reserved"], "official_site": e["site"],
                       "last_checked": e["last_checked"], "watcher": watch.get(e["id"])} for e in exams[:12]],
            "note": None if exams else "No entrance exam for this career in Raah's data; admission is usually on Class 10/12 marks."}


def get_notifications(user_id: int, unread_only: bool = False) -> dict:
    """The signed-in student's latest notifications (exam date updates, teacher recommendations, mentor replies)."""
    with db.connect() as con:
        rows = con.execute("SELECT kind, payload, created_at, read_at FROM notifications WHERE user_id = ? "
                           "ORDER BY id DESC LIMIT 20", (int(user_id),)).fetchall()
    items = []
    for r in rows:
        if unread_only and r["read_at"] is not None:
            continue
        payload = json.loads(r["payload"] or "{}")
        items.append({"kind": r["kind"], "read": r["read_at"] is not None, "created_at": r["created_at"],
                      **{k: payload[k] for k in ("exam_name", "title", "body", "text", "site", "name", "module_title") if k in payload}})
    return {"notifications": items[:10], "unread": sum(1 for i in items if not i["read"])}


# What the student says about themselves in Discover or Ask Raah. A model may add to these. It may not change what
# decides eligibility (class, category, income, marks) or the career the student saved: those are the student's own.
LEARNED_KEYS = ("interests", "strengths", "ikigai", "documents", "max_commute_km", "can_stay_hostel")
_READ_KEYS = PROFILE_KEYS + ("strengths", "ikigai", "roadmap_career", "reminder_channel", "reminder_frequency")


def _stored_profile(user_id: int) -> dict:
    with db.connect() as con:
        row = con.execute("SELECT data FROM profiles WHERE user_id = ?", (int(user_id),)).fetchone()
    return json.loads(row["data"]) if row else {}


def get_student_profile(user_id: int) -> dict:
    """What Raah knows about the signed-in student: class, category, income band, taluka, interests, strengths and
    their ikigai answers (what they love and are good at). Read this before advising, so answers fit the student."""
    p = _stored_profile(user_id)
    return {"profile": {k: p[k] for k in _READ_KEYS if p.get(k) not in (None, "", [])} or None}


def _tags(v, limit: int = 20) -> list[str] | None:
    if not isinstance(v, list):
        return None
    out = [str(x).strip().lower()[:40] for x in v if isinstance(x, (str, int)) and str(x).strip()]
    return list(dict.fromkeys(out))[:limit]


def save_student_profile(user_id: int, learned: dict) -> dict:
    """Remember something the student told Raah. Allowed keys: interests (what they love), strengths (what they are
    good at), documents they hold, max_commute_km, can_stay_hostel. Other fields are the student's own and are ignored."""
    stored = _stored_profile(user_id)
    saved, ignored = [], []
    for key, value in (learned or {}).items():
        new = None
        if key in ("interests", "strengths", "documents"):
            new = _tags(value)
        elif key == "max_commute_km" and isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 200:
            new = round(float(value))
        elif key == "can_stay_hostel" and isinstance(value, bool):
            new = value
        elif key == "ikigai" and isinstance(value, dict):
            love, good = _tags(value.get("love")), _tags(value.get("good_at"))
            if love is not None and good is not None:
                new = {"love": love, "good_at": good, "confirmed_at": stored.get("ikigai", {}).get("confirmed_at")}
        if new is None or key not in LEARNED_KEYS:
            ignored.append(key)
            continue
        stored[key] = new
        saved.append(key)
    if saved:
        from raah.auth import save_profile
        save_profile(int(user_id), stored)
    return {"saved": saved, "ignored": ignored}


TOOLS = [search_dataset, rank_careers, compute_plan, check_eligibility, get_scholarships, nearest_centres,
         get_colleges, list_exams, get_notifications, get_student_profile, save_student_profile]

# shown on the Ask page while each tool runs
LABELS = {"search_dataset": "Searching Raah's data", "rank_careers": "Ranking careers",
          "compute_plan": "Working out cost and payback", "check_eligibility": "Checking eligibility",
          "get_scholarships": "Finding scholarships", "nearest_centres": "Finding training centres near you",
          "get_colleges": "Looking for colleges near you", "list_exams": "Checking exam dates",
          "get_notifications": "Reading your notifications", "get_student_profile": "Reading what you told Raah",
          "save_student_profile": "Remembering what you told Raah"}


def build_server():
    from mcp.server.fastmcp import FastMCP

    server = FastMCP(SERVER_NAME, instructions=INSTRUCTIONS, log_level="WARNING")
    for fn in TOOLS:
        server.add_tool(fn, name=fn.__name__, description=fn.__doc__)
    return server


if __name__ == "__main__":
    import os

    os.environ.setdefault("RAG_WARM", "0")
    build_server().run()  # stdio transport
