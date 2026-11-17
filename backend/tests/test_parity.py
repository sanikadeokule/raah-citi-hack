"""Python engine and browser (TypeScript) engine must give identical answers.

Run from backend/:  RAAH_DATASET=../raah-dataset.xlsx python -m pytest -q tests
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

from raah import dataset, engine

WEB = Path(__file__).resolve().parents[2] / "web"


INTERESTS = [["computers"], ["computer"], [], ["helping people"], ["repairing phones"], ["beauty", "maths"]]


def cases(d):
    out = []
    for s in d["students"]:
        for p in d["plans"]:
            for opts in ({}, {"scholarships": []}, {"hostel": True}, {"commute_km": 35, "baseline": "daily_wage"},
                         {"family_contribution": 1500}):
                out.append({"profile": s, "plan_id": p["id"], "options": opts, "interests_cases": INTERESTS if not opts else []})
    return out


def py_result(d, c):
    r = engine.compute_plan(d, c["profile"], c["plan_id"], c["options"])
    plan = next(p for p in d["plans"] if p["id"] == c["plan_id"])
    return {
        "costs": r["costs"], "net_cost": r["net_cost"],
        "scholarship": {"low": r["scholarship"]["low"], "high": r["scholarship"]["high"], "chosen": r["scholarship"]["chosen"]},
        "stipend": r["stipend"]["total"], "payback": r["payback"], "family_gap": r["family_gap"], "last": r["series"][-1],
        "centres": [[x["id"], x["distance_km"]] for x in r["centres"]],
        "elig": [[e["id"], e["status"], e["passed"], e["total"]] for e in engine.eligibility(d, c["profile"])],
        "rank": [[s["career"]["id"], s["score"], s["fit"], s["diversity"], s["why"]] for s in engine.rank_careers(d, c["profile"])],
        "rank_for": [[[s["career"]["id"], s["score"], s["fit"], s["why"]] for s in engine.rank_careers(d, {**c["profile"], "interests": i})]
                     for i in c["interests_cases"]],
        "elig_plan": [[e["id"], e["status"]] for e in engine.eligibility(d, c["profile"], plan, c["options"].get("hostel"))],
        "changes": engine.eligibility_changes(d, c["profile"], plan, c["options"].get("hostel")),
    }


def norm(x):
    return json.loads(json.dumps(x), parse_float=lambda f: round(float(f), 6))


def test_parity():
    d = dataset.load()
    cs = cases(d)
    rcs = roadmap_cases(d)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"data": d, "cases": cs, "roadmap_cases": rcs}, f)
    out = json.loads(subprocess.check_output(["npx", "tsx", "tests/parity.ts", f.name], cwd=WEB))
    ts = out["plans"]
    os.unlink(f.name)
    py = [py_result(d, c) for c in cs]
    for i, (a, b) in enumerate(zip(norm(py), norm(ts))):
        for k in a:
            assert a[k] == b[k] or (isinstance(a[k], (int, float)) and abs(a[k] - b[k]) < 1), (i, cs[i]["plan_id"], cs[i]["options"], k, a[k], b[k])
    # career roadmap: every career, from every class a student can be in
    py_rm = [engine.build_roadmap(d, c["profile"], c["career_id"], c["start_class"]) for c in rcs]
    for i, (a, b) in enumerate(zip(norm(py_rm), norm(out["roadmaps"]))):
        assert a == b, (rcs[i]["career_id"], rcs[i]["start_class"], rcs[i]["profile"].get("category"))


def roadmap_cases(d):
    return [{"profile": s, "career_id": c["id"], "start_class": k}
            for s in d["students"] for c in d["careers"] for k in (9, 10, 11, 12, 13)]
