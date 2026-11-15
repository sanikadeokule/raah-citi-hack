"""Deterministic logic: eligibility, cost & payback, nearest centres, career ranking.

"The AI explains, the data decides": every number here comes from the parsed
workbook (see dataset.py). The same logic is mirrored in web/lib/engine.ts so it
runs offline in the browser; tests/test_parity.py checks both give the same answer.
"""
from __future__ import annotations

import math
from typing import Any


# ------------------------------------------------------------------ eligibility

def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _threshold(value, category):
    if isinstance(value, dict):
        return value.get("by_category", {}).get(category, value.get("base"))
    return value


def eval_rule(rule: dict, ctx: dict) -> dict:
    field, op, val = rule["field"], rule["op"], rule["value"]
    docs = set(ctx.get("documents") or [])
    v = ctx.get(field)
    status = "unknown"
    if field == "documents" and op == "has":
        status = "pass" if set(val or []) <= docs else "missing_doc"
    elif val is None:
        status = "unknown"
    elif v is None or v == "" or v == []:
        status = "unknown"
    elif op == "in":
        vals = [str(x).lower() for x in val]
        cand = str(int(v)) if isinstance(v, (int, float)) and float(v).is_integer() else str(v)
        status = "pass" if cand.lower() in vals else "fail"
    elif op == "any":
        have = {str(x).lower() for x in (v if isinstance(v, list) else [v])}
        status = "pass" if have & {str(x).lower() for x in val} else "fail"
    elif op == "has":
        have = {str(x).lower() for x in (v if isinstance(v, list) else [v])}
        status = "pass" if {str(x).lower() for x in val} <= have else "fail"
    elif op in ("is", "=="):
        status = "pass" if (bool(v) == val if isinstance(val, bool) else str(v).lower() == str(val).lower()) else "fail"
    elif op in ("<=", "<", ">=", ">"):
        t, x = _num(_threshold(val, ctx.get("category"))), _num(v)
        if t is None or x is None:
            status = "unknown"
        else:
            ok = {"<=": x <= t, "<": x < t, ">=": x >= t, ">": x > t}[op]
            status = "pass" if ok else "fail"
    # condition met but the certificate that proves it is not in hand yet
    if status == "pass" and rule.get("doc") and rule["doc"] not in docs:
        status = "missing_doc"
    return {"label": rule["label"], "field": field, "status": status, "doc": rule.get("doc"), "where": rule.get("where")}


def check_scheme(scheme: dict, ctx: dict) -> dict:
    results = [eval_rule(r, ctx) for r in scheme["rules"]]
    statuses = {r["status"] for r in results}
    if "fail" in statuses:
        overall = "not_eligible"
    elif "unknown" in statuses:
        overall = "need_info"
    elif "missing_doc" in statuses:
        overall = "eligible_missing_docs"
    else:
        overall = "eligible" if results else "need_info"
    missing = []
    for r in results:
        if r["status"] == "missing_doc" and r["doc"] and r["doc"] not in [m["doc"] for m in missing]:
            missing.append({"doc": r["doc"], "where": r["where"]})
    return {"id": scheme["id"], "name": scheme["name"], "status": overall,
            "passed": sum(1 for r in results if r["status"] == "pass"), "total": len(results),
            "rules": results, "missing_docs": missing, "amount_text": scheme["amount_text"],
            "apply_via": scheme["apply_via"], "source": scheme["source"], "last_checked": scheme["last_checked"]}


def eligibility(data: dict, profile: dict, plan: dict | None = None, hostel: bool | None = None) -> list[dict]:
    ctx = dict(profile)
    if plan:
        ctx["course_tags"] = plan["course_tags"]
        if "post_matric" in plan["course_tags"]:
            # the plan is about studying after Class 10, so pre-matric class rules no longer apply
            ctx["class"] = max(int(ctx.get("class") or 0), 11)
    if hostel is not None:
        ctx["stays_in_hostel"] = hostel
    out = [check_scheme(s, ctx) for s in data["scholarships"] if s["rules"]]
    order = {"eligible": 0, "eligible_missing_docs": 1, "need_info": 2, "not_eligible": 3}
    out.sort(key=lambda r: (order[r["status"]], -r["passed"] / max(r["total"], 1)))
    return out


# ------------------------------------------------------------------ money

def A(data, key, default=0):
    a = data["assumptions"].get(key)
    return a["value"] if a and a["value"] is not None else default


def benefit_value(scheme: dict, gender: str, years: float, fees: float) -> dict:
    b = scheme["benefit"]
    low = high = 0.0
    if b.get("fee_pct"):
        pct = b["fee_pct"].get(gender) if gender in b["fee_pct"] else max(v or 0 for v in b["fee_pct"].values())
        part = (pct or 0) / 100 * fees * 1.0
        if b.get("fee_cap") is not None:
            part = min(part, b["fee_cap"] * max(years, 1 if fees else 0))
        low += part
        high += part
    if b.get("per_year"):
        low += b["per_year"]["low"] * years
        high += b["per_year"]["high"] * years
    if b.get("per_month"):
        m = b.get("months_per_year") or 12
        low += b["per_month"]["low"] * m * years
        high += b["per_month"]["high"] * m * years
    return {"low": round(low), "high": round(high)}


def plan_income(data: dict, plan: dict, career: dict, gender: str) -> dict | None:
    lo_f, hi_f = A(data, "income_low_factor", 1), A(data, "income_high_factor", 1)
    ov = plan.get("income_override") or {}
    inc = career.get("income")
    if ov.get("median") is not None:
        med = ov["median"]
        src = "Plan_Inputs (your figure)"
        return {"low": ov.get("low") or med * lo_f, "median": med, "high": ov.get("high") or med * hi_f,
                "source": src, "text": src, "derived": ov.get("low") is None}
    if not inc:
        return None
    if inc.get("by_gender"):
        med = inc["by_gender"].get(gender) or min(inc["by_gender"].values())
        return {"low": med * lo_f, "median": med, "high": med * hi_f, "source": career["income_type"],
                "text": career["income_text"], "derived": True}
    if inc["low"] != inc["high"]:
        return {"low": inc["low"], "median": (inc["low"] + inc["high"]) / 2, "high": inc["high"],
                "source": career["income_type"], "text": career["income_text"], "derived": False}
    med = inc["low"]
    return {"low": med * lo_f, "median": med, "high": med * hi_f, "source": career["income_type"],
            "text": career["income_text"], "derived": True}


def payback_after(net: float, gain: float, horizon: int) -> int | None:
    if net <= 0:
        return 0
    if gain <= 0:
        return None
    m = math.ceil(net / gain)
    return m if m <= horizon else None


def compute_plan(data: dict, profile: dict, plan_id: str, opts: dict | None = None) -> dict:
    opts = opts or {}
    plan = next(p for p in data["plans"] if p["id"] == plan_id)
    career = next(c for c in data["careers"] if c["id"] == plan["career_id"])
    gender = profile.get("gender") or "F"
    hostel = bool(opts.get("hostel", False))
    months = plan["course_months"]
    years = months / 12

    centres = nearest_centres(data, profile, plan.get("centre_type"), 3) if plan.get("centre_type") else []
    if opts.get("commute_km") is not None:
        km = float(opts["commute_km"])
    elif centres and centres[0]["distance_km"] is not None:
        km = centres[0]["distance_km"]
    else:
        km = float(profile.get("max_commute_km") or 0)

    fees = plan["fees"] + plan["exam_fees"]
    if hostel:
        living = A(data, "hostel_cost_per_month") * months
        living_label = "Hostel"
    else:
        living = km * 2 * A(data, "fare_per_km") * A(data, "study_days_per_year") * years
        living_label = "Travel"
    total = fees + plan["materials"] + living

    elig = eligibility(data, profile, plan, hostel)
    possible = [e for e in elig if e["status"] in ("eligible", "eligible_missing_docs")]
    by_id = {s["id"]: s for s in data["scholarships"]}
    values = {e["id"]: benefit_value(by_id[e["id"]], gender, years, fees) for e in possible}
    if opts.get("scholarships") is not None:
        chosen = [s for s in opts["scholarships"] if s in values]
    else:
        chosen = [e["id"] for e in possible if values[e["id"]]["low"] > 0]
    if not A(data, "stack_scholarships", 0) and len(chosen) > 1:
        chosen = [max(chosen, key=lambda s: values[s]["low"])]
    sch_low = sum(values[s]["low"] for s in chosen)
    sch_high = sum(values[s]["high"] for s in chosen)

    tr = career.get("training_income")
    stipend_month = tr["low"] if (tr and plan["earn_months"]) else 0
    stipend = stipend_month * plan["earn_months"]

    net = total - sch_low - stipend
    income = plan_income(data, plan, career, gender)
    baseline_mode = opts.get("baseline", "student")
    base = 0
    if baseline_mode == "daily_wage" and data.get("baseline"):
        base = data["baseline"]["monthly"].get(gender, 0)
    horizon = int(A(data, "payback_horizon_months", 120))
    fam = float(opts.get("family_contribution", A(data, "default_family_contribution_per_month", 0)))
    gap = max(0, total - sch_low - fam * months)

    pay = {}
    if income:
        for k in ("low", "median"):
            pm = payback_after(net, income[k] - base, horizon)
            pay[k] = {"months_after_training": pm,
                      "month_from_start": None if pm is None else int(months + plan["earn_months"] + pm),
                      "monthly_gain": round(income[k] - base)}

    # cumulative cash, month by month (median income, low scholarship)
    series = []
    cum_med = cum_low = 0.0
    monthly_cost = (total - sch_low) / months if months else 0
    if not months:
        cum_med = cum_low = -(total - sch_low)
    for m in range(0, horizon + 1):
        if m > 0:
            if m <= months:
                cum_med -= monthly_cost
                cum_low -= monthly_cost
            elif m <= months + plan["earn_months"]:
                cum_med += stipend_month
                cum_low += stipend_month
            elif income:
                cum_med += income["median"] - base
                cum_low += income["low"] - base
        series.append({"month": m, "median": round(cum_med), "low": round(cum_low)})

    return {
        "plan": plan, "career": {k: career[k] for k in ("id", "name", "category", "income_text", "income_type", "sources", "last_checked", "training_income_text")},
        "inputs": {"gender": gender, "hostel": hostel, "commute_km": round(km, 1), "family_contribution": fam,
                   "baseline": baseline_mode, "scholarships": chosen},
        "costs": {"course_fees": plan["fees"], "exam_fees": plan["exam_fees"], "materials": plan["materials"],
                  "living": round(living), "living_label": living_label, "total": round(total)},
        "scholarship": {"low": sch_low, "high": sch_high, "chosen": chosen, "options": [
            {"id": e["id"], "name": e["name"], "status": e["status"], "value": values[e["id"]],
             "missing_docs": e["missing_docs"]} for e in possible]},
        "stipend": {"per_month": stipend_month, "months": plan["earn_months"], "total": stipend,
                    "text": career.get("training_income_text")},
        "net_cost": round(net), "family_gap": round(gap), "income": income,
        "baseline_monthly": base, "payback": pay, "series": series, "centres": centres,
        "eligibility": elig,
    }


# ------------------------------------------------------------------ centres

def haversine(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_centres(data: dict, profile: dict, centre_type: str | None, n: int = 3) -> list[dict]:
    lat, lon = profile.get("lat"), profile.get("lon")
    out = []
    for c in data["centres"]:
        if centre_type and centre_type.lower() not in str(c["type"]).lower():
            continue
        d = None
        if lat is not None and lon is not None and c["lat"] is not None:
            d = round(haversine(lat, lon, c["lat"], c["lon"]), 1)
        out.append({**c, "distance_km": d, "approximate": c["coord_source"] != "exact"})
    out.sort(key=lambda c: (c["distance_km"] is None, c["distance_km"] or 0))
    return out[:n]


# ------------------------------------------------------------------ careers

def _tokens(items) -> set[str]:
    out = set()
    for it in items or []:
        for w in str(it).lower().replace("-", " ").split():
            if len(w) > 2:
                out.add(w)
    return out


def rank_careers(data: dict, profile: dict, n: int = 5) -> list[dict]:
    interests = _tokens(profile.get("interests"))
    phrases = {str(i).strip().lower() for i in profile.get("interests") or []}
    cls = profile.get("class") or 10
    plans_by_career = {p["career_id"]: p for p in data["plans"]}
    fam = profile.get("family_income_annual") or 0
    scored = []
    for c in data["careers"]:
        tags = _tokens(c.get("tags"))
        tag_phrases = {str(t).strip().lower() for t in c.get("tags") or []}
        exact = phrases & tag_phrases
        loose = {p for p in phrases - exact if _tokens([p]) & tags}
        interest = (len(exact) + 0.5 * len(loose)) / len(phrases) if phrases else 0
        min_c = c.get("min_class") or 0
        elig = 1.0 if cls >= min_c else (0.7 if min_c - cls <= 2 else 0.3)
        afford = 0.5
        p = plans_by_career.get(c["id"])
        if p:
            cost = p["fees"] + p["exam_fees"] + p["materials"]
            afford = 1.0 if cost <= 0.25 * fam else (0.6 if cost <= fam else 0.2)
        demand = (c.get("demand") or 3) / 5
        score = 0.5 * interest + 0.2 * elig + 0.2 * afford + 0.1 * demand
        scored.append({"career": c, "score": round(score, 3), "plan_id": p["id"] if p else None,
                       "breakdown": {"interest": round(interest, 2), "eligibility": elig, "affordability": afford,
                                     "demand": round(demand, 2)},
                       "matched": sorted(exact) + sorted(loose)})
    scored.sort(key=lambda s: -s["score"])
    top = scored[:n]
    # diversity: at least one vocational and one non-STEM / self-employment option
    for flag in ("vocational", "non_stem"):
        if not any(s["career"]["flags"][flag] for s in top):
            extra = next((s for s in scored[n:] if s["career"]["flags"][flag]), None)
            if extra:
                top[-1] = extra
                top.sort(key=lambda s: -s["score"])
    for s in top:
        s["why"] = why_line(s)
    return top


def why_line(s: dict) -> str:
    """Template explanation (the LLM may rephrase this, never the numbers)."""
    parts = []
    if s["matched"]:
        parts.append("matches your interest in " + ", ".join(s["matched"][:3]))
    if s["breakdown"]["affordability"] >= 1:
        parts.append("low cost for your family")
    if s["breakdown"]["demand"] >= 0.8:
        parts.append("many openings near Pune")
    if s["career"]["flags"]["vocational"]:
        parts.append("start earning sooner")
    return ("Fits you: " + "; ".join(parts)) if parts else "A different option worth knowing about"
