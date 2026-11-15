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
