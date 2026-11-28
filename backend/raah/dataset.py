"""Load raah-dataset.xlsx and turn it into clean, typed data for the app.

Nothing here contains dataset values. Every number the app shows is read from
the workbook each time the file changes, so editing a cell in Excel and saving
is enough to update the app (no rebuild, no code change).

Text cells like "≤ ₹3,50,000 per year" or "₹8,200-20,000/month" are parsed into
numbers. Anything that cannot be parsed is reported in `warnings` so it shows
up on the app's Data page instead of failing silently.
"""
from __future__ import annotations

import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import openpyxl

def _default_path() -> Path:
    here = Path(__file__).resolve()
    for up in (2, 3):  # app/raah-dataset.xlsx or the project folder next to app/
        cand = here.parents[up] / "raah-dataset.xlsx"
        if cand.exists():
            return cand
    return here.parents[3] / "raah-dataset.xlsx"


DATASET_PATH = Path(os.environ.get("RAAH_DATASET") or _default_path())

# ------------------------------------------------------------------ parsing helpers

_NUM = r"(\d[\d,]*(?:\.\d+)?)"
_MONEY = re.compile(r"₹\s*" + _NUM + r"(\s*lakh)?(?:\s*(?:-|–|to)\s*₹?\s*" + _NUM + r"(\s*lakh)?)?", re.I)


def _to_num(s: str, lakh: str | None = None) -> float:
    v = float(s.replace(",", ""))
    if lakh:
        v *= 100000
    return int(v) if v.is_integer() else v


def money_values(text: Any) -> list[dict]:
    """All ₹ amounts in a text cell, each as {low, high}."""
    if text is None:
        return []
    if isinstance(text, (int, float)) and not isinstance(text, bool):
        # A ₹ figure typed into Excel as a plain number (1400, not "₹1,400").
        return [{"low": float(text), "high": float(text)}]
    out = []
    for m in _MONEY.finditer(str(text)):
        low = _to_num(m.group(1), m.group(2))
        high = _to_num(m.group(3), m.group(4) or m.group(2)) if m.group(3) else low
        out.append({"low": low, "high": high})
    return out


def first_money(text: Any) -> float | None:
    v = money_values(text)
    return v[0]["low"] if v else None


def inr(v: float) -> str:
    """Indian digit grouping: 250000 -> '2,50,000'."""
    n = int(round(v))
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = ",".join([head[max(0, i - 2):i] for i in range(len(head), 0, -2)][::-1])
        s = head + "," + tail
    return ("-" if n < 0 else "") + s


def split_list(text: Any) -> list[str]:
    if text is None:
        return []
    return [p.strip() for p in re.split(r"[;\n]", str(text)) if p.strip()]


def split_urls(text: Any) -> list[str]:
    return [u for u in (p.strip() for p in str(text or "").split(" ; ")) if u]


def yes(v: Any) -> bool:
    return str(v).strip().lower() in {"yes", "y", "true", "1"}


def num_or_none(v: Any) -> float | None:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, (int, float)):
        return v
    m = re.search(_NUM, str(v))
    return _to_num(m.group(1)) if m else None


def gendered(text: Any) -> dict | None:
    """'₹24,217 (male) / ₹18,353 (female)' -> {'M': 24217, 'F': 18353}."""
    s = str(text or "")
    m = re.search(r"₹\s*" + _NUM + r"\s*\(male\)\s*/\s*₹\s*" + _NUM + r"\s*\(female\)", s, re.I)
    if m:
        return {"M": _to_num(m.group(1)), "F": _to_num(m.group(2))}
    return None


def parse_income(text: Any) -> dict | None:
    """Monthly income cell -> {low, high, by_gender?}. None when the cell has no figure."""
    if text is None or str(text).strip() in {"", "—", "-", "Not verified"}:
        return None
    g = gendered(text)
    if g:
        return {"by_gender": g, "low": min(g.values()), "high": max(g.values())}
    vals = money_values(text)
    if not vals:
        return None
    # monthly figures only: skip lakh lump sums (e.g. Seva Nidhi)
    v = next((x for x in vals if x["low"] < 100000), vals[0])
    return {"low": v["low"], "high": v["high"]}


def parse_income_limit(text: Any) -> list[float] | None:
    s = str(text or "")
    if not s.strip() or re.search(r"no income|none stated|not stated", s, re.I):
        return None
    vals = [v["low"] for v in money_values(s)]
    return vals or None


def parse_benefit(text: Any, months_default: int) -> dict:
    """Scholarship 'Amount' cell -> structured benefit used in the payback maths.

    Returns per-year and per-month cash (low/high), share of course fees covered
    (by gender where the text splits it) and a fee cap. `computable` is False
    when the cell has no usable figure.
    """
    s = str(text or "")
    b: dict[str, Any] = {"text": s, "per_year": None, "per_month": None, "months_per_year": months_default,
                         "fee_pct": None, "fee_cap": None, "computable": False}
    m = re.search(r"(?:max(?:imum)?|for)\s*(\d+)\s*months", s, re.I)
    if m:
        b["months_per_year"] = int(m.group(1))

    # share of fees covered
    boys = re.search(r"boys?\s*:\s*(\d+)\s*%", s, re.I)
    girls = re.search(r"girls?\s*(?::)?\s*(\d+)\s*%", s, re.I)
    pct = re.search(r"(\d+)\s*%\s*(?:tuition|fee|govt)", s, re.I)
    if boys or girls:
        base = int(pct.group(1)) if pct else None
        b["fee_pct"] = {"M": int(boys.group(1)) if boys else base, "F": int(girls.group(1)) if girls else base}
    elif pct:
        b["fee_pct"] = {"M": int(pct.group(1)), "F": int(pct.group(1))}
    elif re.search(r"compulsory (?:non-refundable )?fees|all compulsory fees|fee at actuals", s, re.I):
        b["fee_pct"] = {"M": 100, "F": 100}
    cap = re.search(r"(?:tuition )?fee up to\s*₹\s*" + _NUM, s, re.I)
    if not cap and re.search(r"at actuals", s, re.I):
        cap = re.search(r"up to\s*₹\s*" + _NUM, s, re.I)
    if cap:
        b["fee_cap"] = _to_num(cap.group(1))
        b["fee_pct"] = b["fee_pct"] or {"M": 100, "F": 100}

    # cash amounts (skip the fee cap figure)
    vals = money_values(s)
    if cap:
        vals = [v for v in vals if v["low"] != b["fee_cap"]]
    if vals:
        lows = [v["low"] for v in vals]
        highs = [v["high"] for v in vals]
        rng = {"low": min(lows), "high": max(highs)}
        monthly = re.search(r"per month|/month|monthly|month", s, re.I)
        yearly = re.search(r"per year|/year|a year|annual", s, re.I)
        if monthly and not (yearly and yearly.start() < monthly.start()):
            b["per_month"] = rng
        else:
            b["per_year"] = rng
    if cap and re.search(r"at actuals", s, re.I):
        b["per_year"] = b["per_month"] = None  # "up to ₹X ... at actuals" is a cap on fees, not extra cash
    b["computable"] = bool(b["per_year"] or b["per_month"] or b["fee_pct"])
    return b


def parse_rule_value(raw: Any, op: str, scheme: dict, warnings: list, where: str):
    """Rule 'Value' cell -> python value. '@income' links to the Scholarships sheet."""
    s = "" if raw is None else str(raw).strip()
    if s.startswith("@income"):
        idx = re.search(r"\[(\d+)\]", s)
        limits = scheme.get("income_limits") or []
        i = int(idx.group(1)) - 1 if idx else 0
        if i < len(limits):
            return limits[i], "linked"
        warnings.append(f"{where}: '@income' but the Scholarships income limit has no ₹ figure")
        return None, "linked"
    if op in {"in", "any", "has"}:
        return [p.strip() for p in s.split(";") if p.strip()], "literal"
    if op in {"is", "=="}:
        return (s.lower() in {"true", "yes", "1"}) if s.lower() in {"true", "false", "yes", "no", "1", "0"} else s, "literal"
    # numeric with optional category overrides: "55; SC=50; ST=50"
    parts = [p.strip() for p in s.split(";") if p.strip()]
    base = num_or_none(parts[0]) if parts else None
    overrides = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            overrides[k.strip()] = num_or_none(v)
    if base is None:
        warnings.append(f"{where}: value '{s}' is not a number")
    return ({"base": base, "by_category": overrides} if overrides else base), "literal"


# ------------------------------------------------------------------ sheet readers

def _rows(wb, name: str) -> list[dict]:
    if name not in wb.sheetnames:
        return []
    it = wb[name].iter_rows(values_only=True)
    head = [str(h).strip() if h is not None else "" for h in next(it)]
    out = []
    for r in it:
        if r is None or all(c is None or str(c).strip() == "" for c in r):
            continue
        out.append({head[i]: (r[i].strip() if isinstance(r[i], str) else r[i]) for i in range(len(head)) if head[i]})
    return out


def _career_flags(category: str) -> dict:
    c = (category or "").lower()
    return {
        "vocational": "vocational" in c or "iti" in c,
        "self_employment": "self-employment" in c,
        "non_stem": "non-stem" in c or "self-employment" in c or "government" in c,
        "stem": "stem" in c and "non-stem" not in c,
        "health": "health" in c,
        "baseline": "baseline" in c,
        "degree": "degree" in c,
    }


def load(path: Path = DATASET_PATH) -> dict:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    warnings: list[str] = []

    # assumptions
    assumptions = {}
    for r in _rows(wb, "Assumptions"):
        k = r.get("Key")
        if not k:
            continue
        v = num_or_none(r.get("Value"))
        if v is None:
            warnings.append(f"Assumptions: '{k}' has no numeric value")
        assumptions[k] = {"value": v, "unit": r.get("Unit"), "note": r.get("What it is used for"),
                          "source": r.get("Source / status")}

    def A(key, default=None):
        a = assumptions.get(key)
        return a["value"] if a and a["value"] is not None else default

    months_default = int(A("months_paid_per_year", 12))

    # scholarships
    schemes = []
    for r in _rows(wb, "Scholarships"):
        sid = r.get("ID")
        if not sid:
            continue
        limits = parse_income_limit(r.get("Income limit"))
        benefit = parse_benefit(r.get("Amount"), months_default)
        if not benefit["computable"]:
            warnings.append(f"Scholarships {sid}: amount '{r.get('Amount')}' has no ₹ figure, so it is shown but not counted in payback")
        schemes.append({
            "id": sid, "name": r.get("Scheme"), "level": r.get("Level"), "provider": r.get("Provider"),
            "class_text": r.get("Class / course"), "category_text": r.get("Category"),
            "income_limit_text": r.get("Income limit"), "income_limits": limits,
            "income_limit": limits[0] if limits else None,
            "rules_text": r.get("Key rules"), "amount_text": r.get("Amount"), "benefit": benefit,
            "documents": split_list(r.get("Documents")), "apply_via": r.get("Apply via"),
            "source": r.get("Source"), "last_checked": str(r.get("Last checked") or ""), "rules": [],
        })
    by_scheme = {s["id"]: s for s in schemes}
    for i, r in enumerate(_rows(wb, "Eligibility_Rules"), start=2):
        sid = r.get("Scheme ID")
        s = by_scheme.get(sid)
        if not s:
            warnings.append(f"Eligibility_Rules row {i}: scheme '{sid}' is not in Scholarships")
            continue
        op = str(r.get("Operator") or "").strip()
        value, kind = parse_rule_value(r.get("Value"), op, s, warnings, f"Eligibility_Rules row {i} ({sid})")
        label = r.get("Label shown to student") or ""
        if kind == "linked" and value is not None and r.get("Field") == "family_income_annual":
            sign = {"<": "<", ">": "above", ">=": "≥"}.get(op, "≤")
            label = f"Family income {sign} ₹{inr(value)} per year"
        s["rules"].append({"field": r.get("Field"), "op": op, "value": value, "value_kind": kind, "label": label,
                           "doc": r.get("Document needed"), "where": r.get("Where to get it")})

    # occupation earnings (PLFS by occupation / education / self-employed industry)
    earnings_groups = {}
    for r in _rows(wb, "Occupation_Earnings"):
        name = r.get("Group")
        if not name:
            continue
        areas = {}
        for area, label in (("all", "All India"), ("rural", "Rural"), ("urban", "Urban")):
            areas[area] = {"M": num_or_none(r.get(f"{label} male (₹/month)")),
                           "F": num_or_none(r.get(f"{label} female (₹/month)")),
                           "all": num_or_none(r.get(f"{label} everyone (₹/month)"))}
        if areas["all"]["all"] is None and areas["all"]["M"] is None:
            warnings.append(f"Occupation_Earnings '{name}': no All India figure")
            continue
        earnings_groups[str(name).strip()] = {"group": str(name).strip(), "kind": r.get("Kind"), **areas,
                                              "period": r.get("Period"), "sources": split_urls(r.get("Source")),
                                              "last_checked": str(r.get("Last checked") or "")}

    def group_text(g: dict) -> str:
        def pair(a):
            m, f = g[a]["M"], g[a]["F"]
            return f"₹{inr(m)} (male) / ₹{inr(f)} (female)" if m is not None and f is not None else f"₹{inr(g[a]['all'])}"
        out = f"PLFS 2025 average, {g['group'].lower()}: {pair('all')}"
        if g["rural"]["all"] is not None and g["urban"]["all"] is not None:
            out += f"; rural {pair('rural')}, urban {pair('urban')}"
        return out

    # careers
    profile_rows = {r.get("Career ID"): r for r in _rows(wb, "Career_Profile")}
    careers, baseline = [], None
    for r in _rows(wb, "Careers_Income"):
        cid = r.get("ID")
        if not cid:
            continue
        flags = _career_flags(r.get("Category"))
        # a figure typed into the income cell wins; otherwise the linked Occupation_Earnings row is used
        after = parse_income(r.get("Income after training / entry pay"))
        group_name = str(r.get("Earnings group (Occupation_Earnings)") or "").strip()
        earnings = earnings_groups.get(group_name) if group_name else None
        if group_name and not earnings:
            warnings.append(f"Careers_Income {cid}: earnings group '{group_name}' not found in Occupation_Earnings")
        if earnings and after is not None:
            warnings.append(f"Careers_Income {cid}: own income figure used, earnings group '{group_name}' ignored")
            earnings = None
        training = parse_income(r.get("Income while training"))
        path_vals = [num_or_none(r.get(f"Pay year {y} (₹/month)")) for y in (1, 3, 5)]
        pay_path = path_vals if path_vals[0] is not None else None
        if pay_path is None and any(v is not None for v in path_vals):
            warnings.append(f"Careers_Income {cid}: Pay year 3/5 given without Pay year 1, growth ignored")
        status = r.get("Income status") or ""
        cp = profile_rows.get(cid, {})
        item = {
            "id": cid, "name": r.get("Career"), "category": r.get("Category"), "entry_path": r.get("Entry path"),
            "min_qualification": r.get("Minimum qualification"),
            "training_income_text": r.get("Income while training"), "training_income": training,
            "income_text": group_text(earnings) if earnings else r.get("Income after training / entry pay"),
            "income": after, "earnings": earnings, "pay_path": pay_path,
            "pay_path_source": r.get("Pay growth source"), "income_status": status,
            "income_estimate": str(status).strip().lower().startswith("estimate"),
            "income_type": (earnings["kind"] + " (PLFS 2025)") if earnings else r.get("Income type"),
            "sources": split_urls(r.get("Source")),
            "last_checked": str(r.get("Last checked") or ""), "flags": flags,
            "tags": split_list(cp.get("Interest tags (use ;)")), "min_class": num_or_none(cp.get("Min class")),
            "stream": cp.get("Stream needed") or "any", "demand": num_or_none(cp.get("Local demand (1-5)")),
            "roadmap_path": str(cp.get("Roadmap path") or "").strip() or None,
        }
        if flags["baseline"]:
            daily = gendered(r.get("Income after training / entry pay"))
            if daily:
                wd = A("working_days_per_month", 0)
                baseline = {"career_id": cid, "daily": daily, "monthly": {k: v * wd for k, v in daily.items()},
                            "working_days": wd, "text": item["income_text"], "sources": item["sources"]}
            else:
                warnings.append(f"Careers_Income {cid}: baseline daily wage not readable")
            continue
        if after is None and not earnings and r.get("Income after training / entry pay") not in (None, "—"):
            warnings.append(f"Careers_Income {cid}: income '{r.get('Income after training / entry pay')}' not readable")
        careers.append(item)
    by_career = {c["id"]: c for c in careers}

    # courses
    courses = []
    for r in _rows(wb, "Courses"):
        fee_text = r.get("Fee") or ""
        fee = 0 if re.match(r"\s*free", str(fee_text), re.I) else first_money(fee_text)
        courses.append({"id": r.get("ID"), "platform": r.get("Platform"), "title": r.get("Course"),
                        "provider": r.get("Provider"), "language": r.get("Language"), "fee_text": fee_text,
                        "fee": fee, "duration": r.get("Duration / level"), "career_text": r.get("Linked career"),
                        "source": r.get("Source"), "last_checked": str(r.get("Last checked") or ""),
                        "career_ids": split_list(r.get("Career IDs (use ;)")), "tags": split_list(r.get("Skill tags (use ;)"))})
    by_course = {c["id"]: c for c in courses}

    # exams and admission rounds
    exams = []
    for r in _rows(wb, "Exams"):
        if not r.get("ID"):
            continue
        fee_open, fee_res = r.get("Application fee (Open / General)"), r.get("Application fee (Reserved)")
        exams.append({"id": r.get("ID"), "name": r.get("Exam / admission"), "by": r.get("Conducted by"),
                      "leads_to": r.get("Leads to"), "eligibility": r.get("Who can apply"), "selection": r.get("Selection"),
                      "fee_open": first_money(fee_open) if fee_open not in (None, "") else None,
                      "fee_reserved": first_money(fee_res) if fee_res not in (None, "") else None,
                      "fee_note": r.get("Fee note"), "dates": r.get("Last cycle dates"), "timing": r.get("Usual timing"),
                      "site": r.get("Official site"), "source": r.get("Source"), "last_checked": str(r.get("Last checked") or "")})
    exam_ids = {e["id"] for e in exams}

    # plans
    plans = []
    for i, r in enumerate(_rows(wb, "Plan_Inputs"), start=2):
        pid, cid = r.get("Plan ID"), r.get("Career ID")
        if not pid:
            continue
        if cid not in by_career:
            warnings.append(f"Plan_Inputs {pid}: career '{cid}' not found in Careers_Income")
            continue
        fees = num_or_none(r.get("Course fees total (₹)"))
        fee_from = "Plan_Inputs"
        link = r.get("Linked course ID")
        if fees is None and link in by_course and by_course[link]["fee"] is not None:
            fees, fee_from = by_course[link]["fee"], f"Courses {link}"
        override = {k: num_or_none(r.get(f"Income {k} (₹/month)")) for k in ("low", "median", "high")}
        plans.append({
            "id": pid, "career_id": cid, "label": r.get("Path shown to student") or by_career[cid]["name"],
            "steps": split_list(r.get("Steps (use ; between steps)")),
            "course_months": num_or_none(r.get("Course months")) or 0,
            "earn_months": num_or_none(r.get("Earning-while-training months")) or 0,
            "fees": fees or 0, "fees_from": fee_from, "exam_fees": num_or_none(r.get("Exam / admission fees (₹)")) or 0,
            "materials": num_or_none(r.get("Materials / tools (₹)")) or 0, "linked_course": link,
            "course_tags": split_list(r.get("Course tags")), "centre_type": r.get("Centre type"),
            "income_override": override if any(v is not None for v in override.values()) else None,
            "status": r.get("Fee source / status"),
            "exams": [x for x in split_list(r.get("Exams / admissions (IDs, use ;)")) if x in exam_ids],
        })
        for x in split_list(r.get("Exams / admissions (IDs, use ;)")):
            if x not in exam_ids:
                warnings.append(f"Plan_Inputs {pid}: exam '{x}' not found in Exams")

    # career roadmap: one stage template per path type (Roadmap_Stages), picked by Career_Profile 'Roadmap path'
    stipend_cats = {str(r.get("Apprentice category") or "").strip() for r in _rows(wb, "Stipend_Rates")}
    roadmap: dict[str, list] = {}
    for i, r in enumerate(_rows(wb, "Roadmap_Stages"), start=2):
        path_type = str(r.get("Path type") or "").strip()
        if not path_type:
            continue
        ids = split_list(r.get("Exam IDs (use ;)"))
        for x in ids:
            if x not in exam_ids:
                warnings.append(f"Roadmap_Stages row {i}: exam '{x}' not found in Exams")
        stip = str(r.get("Stipend category (Stipend_Rates)") or "").strip() or None
        if stip and stip not in stipend_cats:
            warnings.append(f"Roadmap_Stages row {i}: stipend category '{stip}' not found in Stipend_Rates")
        fc, tc = num_or_none(r.get("From class")), num_or_none(r.get("To class"))
        roadmap.setdefault(path_type, []).append({
            "step": num_or_none(r.get("Step")) or len(roadmap.get(path_type, [])) + 1,
            "kind": str(r.get("Kind") or "course").strip().lower(),
            "name": r.get("Stage") or "", "name_hi": r.get("Stage (hi)"), "name_mr": r.get("Stage (mr)"),
            "from_class": fc, "to_class": tc, "months": num_or_none(r.get("Months")) or 0,
            "fee_low": num_or_none(r.get("Fee low (₹, whole stage)")), "fee_high": num_or_none(r.get("Fee high (₹, whole stage)")),
            "use_plan": yes(r.get("Use ₹ plan fees")), "course_tags": split_list(r.get("Course tags")),
            "exams": [x for x in ids if x in exam_ids], "stipend_category": stip,
            "what": r.get("What to do") or "", "status": r.get("Fee source / status") or "",
            "source": r.get("Source"), "last_checked": str(r.get("Last checked") or ""),
        })
    for stages in roadmap.values():
        stages.sort(key=lambda s: s["step"])
    for c in careers:
        if c["roadmap_path"] and c["roadmap_path"] not in roadmap:
            warnings.append(f"Career_Profile {c['id']}: roadmap path '{c['roadmap_path']}' has no rows in Roadmap_Stages")

    # centres
    # centres are matched to the original Pune-area points; the rest of India's talukas are only for the student's home place
    talukas = {str(r.get("Taluka")).lower(): (num_or_none(r.get("Lat")), num_or_none(r.get("Lon")))
               for r in _rows(wb, "Talukas") if r.get("Taluka") and str(r.get("Status") or "").startswith("Approximate taluka HQ")}

    def taluka_point(name: str):
        n = (name or "").lower()
        for key, pt in talukas.items():
            if key in n:
                return pt
        return None

    centres = []
    for r in _rows(wb, "Training_Centres"):
        lat, lon = num_or_none(r.get("Lat")), num_or_none(r.get("Lon"))
        coord = "exact" if lat is not None and lon is not None else None
        if coord is None:
            pt = taluka_point(r.get("Taluka"))
            if pt and pt[0] is not None:
                lat, lon, coord = pt[0], pt[1], "taluka"
        centres.append({"id": r.get("ID"), "name": r.get("Name"), "type": r.get("Type"), "taluka": r.get("Taluka"),
                        "district": r.get("District"), "address": r.get("Address / place"),
                        "courses": r.get("Courses"), "seats": r.get("Seats"), "fees_text": r.get("Fees"),
                        "fees": first_money(r.get("Fees")) if "not in source" not in str(r.get("Fees")).lower() else None,
                        "code": r.get("Code"), "lat": lat, "lon": lon, "coord_source": coord, "note": r.get("Note"),
                        "source": r.get("Source"), "last_checked": str(r.get("Last checked") or "")})
    missing = sum(1 for c in centres if c["coord_source"] != "exact")
    if missing:
        warnings.append(f"Training_Centres: {missing} of {len(centres)} centres have no Lat/Lon, distance uses the taluka point (approximate)")

    # mentors: phone numbers stay on the server (in "_private") until a student accepts
    mentors, mentor_contacts = [], {}
    for r in _rows(wb, "Mentors"):
        if not r.get("ID"):
            continue
        pt = taluka_point(r.get("Taluka"))
        mentors.append({"id": r.get("ID"), "name": r.get("Name"), "works_as": r.get("Works as"),
                        "career_ids": split_list(r.get("Career IDs (use ;)")), "taluka": r.get("Taluka"),
                        "lat": pt[0] if pt else None, "lon": pt[1] if pt else None,
                        "languages": split_list(r.get("Languages")), "helps_with": r.get("Can help with"),
                        "mode": r.get("How they meet"), "available": r.get("Available"), "note": r.get("Note")})
        mentor_contacts[r.get("ID")] = {"phone": r.get("Phone")}

    # audio lessons: topics for the Learn dropdown, then one row per lesson in three languages
    lesson_topics = []
    for r in _rows(wb, "Lesson_Topics"):
        if not r.get("Topic ID"):
            continue
        en_name = r.get("English") or r.get("Topic ID")
        lesson_topics.append({"id": r.get("Topic ID"), "order": num_or_none(r.get("Order")) or 999,
                              "name": {"en": en_name, "hi": r.get("Hindi") or en_name, "mr": r.get("Marathi") or en_name}})
    lesson_topics.sort(key=lambda t: t["order"])
    topic_ids = {t["id"] for t in lesson_topics}
    lessons = []
    for r in _rows(wb, "Lessons"):
        lid = r.get("Lesson ID")
        if not lid:
            continue
        if r.get("Topic ID") not in topic_ids:
            warnings.append(f"Lessons {lid}: topic '{r.get('Topic ID')}' is not in Lesson_Topics")
        cids = split_list(r.get("Career IDs (use ;)"))
        for cid in cids:
            if cid not in by_career:
                warnings.append(f"Lessons {lid}: career '{cid}' not found in Careers_Income")
        text = {}
        for code_, lang in (("en", "English"), ("hi", "Hindi"), ("mr", "Marathi")):
            wrong = split_list(r.get(f"Wrong answers ({lang}, use ;)"))
            item = {"title": r.get(f"Title ({lang})"), "text": r.get(f"Lesson ({lang})"),
                    "q": r.get(f"Quiz question ({lang})"), "right": r.get(f"Right answer ({lang})"), "wrong": wrong}
            if not (item["title"] and item["text"]):
                if code_ == "en":
                    warnings.append(f"Lessons {lid}: English title or lesson is empty")
                continue
            if not (item["q"] and item["right"] and wrong):
                item["q"] = None
            text[code_] = item
        if "en" not in text:
            continue
        lessons.append({"id": lid, "topic": r.get("Topic ID"), "career_ids": cids,
                        "tags": split_list(r.get("Interest tags (use ;)")), "text": text})

    # apprenticeships + stipends
    naps = [{"id": r.get("ID"), "trade": r.get("Course / trade"), "trade_type": r.get("Trade type"),
             "employer": r.get("Establishment"), "location": r.get("Location"), "district": r.get("District"),
             "stipend_text": r.get("Stipend (as listed)"), "stipend": (money_values(r.get("Stipend (as listed)")) or [None])[0],
             "duration": r.get("Training duration"), "posted": str(r.get("Posted on") or ""),
             "source": r.get("Source"), "last_checked": str(r.get("Last checked") or "")}
            for r in _rows(wb, "Apprenticeships_NAPS")]
    railway = [{"id": r.get("ID"), "employer": r.get("Establishment"), "location": r.get("Location"),
                "trade": r.get("Trade"), "seats": num_or_none(r.get("Seats")), "duration": r.get("Duration"),
                "eligibility": r.get("Eligibility"), "stipend_text": r.get("Current minimum stipend"),
                "stipend": first_money(r.get("Current minimum stipend")), "selection": r.get("Selection"),
                "fee": r.get("Fee"), "notice": r.get("Notice"), "apply_via": r.get("Apply via"),
                "source": r.get("Source"), "last_checked": str(r.get("Last checked") or "")}
               for r in _rows(wb, "Apprenticeships_Railway")]
    stipends = [{"category": r.get("Apprentice category"), "old": first_money(r.get("Old minimum (per month)")),
                 "current": first_money(r.get("Revised minimum (per month, from 11 Sep 2025)")),
                 "source": r.get("Source"), "last_checked": str(r.get("Last checked") or "")}
                for r in _rows(wb, "Stipend_Rates")]

    students = []
    for r in _rows(wb, "Demo_Students"):
        students.append({
            "id": r.get("Student ID"), "name": r.get("Name"), "age": num_or_none(r.get("Age")),
            "gender": r.get("Gender"), "class": num_or_none(r.get("Class")), "taluka": r.get("Taluka"),
            "lat": num_or_none(r.get("Lat")), "lon": num_or_none(r.get("Lon")), "language": r.get("Language") or "en",
            "marks_pct": num_or_none(r.get("Marks %")), "interests": split_list(r.get("Interests (use ;)")),
            "category": r.get("Category"), "family_income_annual": num_or_none(r.get("Family income (₹/year)")),
            "max_commute_km": num_or_none(r.get("Max commute (km)")), "can_stay_hostel": yes(r.get("Can stay in hostel")),
            "school_type": r.get("School type"), "domicile": r.get("Domicile"),
            "documents": split_list(r.get("Documents (use ;)")), "has_bank_account": yes(r.get("Has bank account")),
            "exams_passed": split_list(r.get("Exams passed (use ;)")), "note": r.get("Note"),
        })

    taluka_list = [{"name": r.get("Taluka"), "lat": num_or_none(r.get("Lat")), "lon": num_or_none(r.get("Lon")),
                    "state": r.get("State") or "Maharashtra", "district": r.get("District")}
                   for r in _rows(wb, "Talukas") if r.get("Taluka")]
    readme = [r[0] for r in wb["README"].iter_rows(values_only=True) if r and r[0]] if "README" in wb.sheetnames else []
    wb.close()
    st = path.stat()
    return {
        "version": {"file": path.name, "modified": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
                    "loaded_at": datetime.now(timezone.utc).isoformat(), "size": st.st_size},
        "readme": readme, "assumptions": assumptions, "scholarships": schemes, "careers": careers,
        "baseline": baseline, "earnings_groups": earnings_groups, "plans": plans, "courses": courses, "exams": exams, "mentors": mentors,
        "lessons": lessons, "lesson_topics": lesson_topics,
        "_private": {"mentor_contacts": mentor_contacts}, "centres": centres, "naps": naps,
        "railway": railway, "stipends": stipends, "students": students, "warnings": warnings,
        "roadmap": roadmap,
        "talukas": taluka_list,
    }


# ------------------------------------------------------------------ cached access

_lock = threading.Lock()
_cache: dict[str, Any] = {"mtime": None, "data": None}


def get(path: Path = DATASET_PATH) -> dict:
    """Return parsed data, re-reading the workbook whenever the file changes."""
    mtime = path.stat().st_mtime
    with _lock:
        if _cache["mtime"] != mtime or _cache["data"] is None:
            _cache["data"] = load(path)
            _cache["mtime"] = mtime
        return _cache["data"]
