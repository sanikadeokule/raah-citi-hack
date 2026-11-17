"""Career roadmap: stages ahead of the student's class, fees from the sheets, sourced vs estimated."""
from raah import dataset, engine

D = dataset.load()
STU = {"gender": "F", "class": 10, "category": "OBC", "family_income_annual": 180000, "domicile": "Maharashtra",
       "school_type": "government", "documents": ["aadhaar", "marksheet_10", "caste_certificate", "income_certificate"]}


def names(r):
    return [s["name"] for s in r["stages"]]


def test_every_career_has_a_roadmap():
    for c in D["careers"]:
        r = engine.build_roadmap(D, STU, c["id"])
        assert r["available"], c["id"]
        assert r["stages"][-1]["kind"] == "job", c["id"]
        assert r["stages"][0]["now"]


def test_finished_school_stages_are_dropped_and_current_one_is_prorated():
    c9 = engine.build_roadmap(D, STU, "CAR49", 9)
    c10 = engine.build_roadmap(D, STU, "CAR49", 10)
    c12 = engine.build_roadmap(D, STU, "CAR49", 12)
    pass12 = engine.build_roadmap(D, STU, "CAR49", 13)
    assert c9["stages"][0]["months"] == 24 and c10["stages"][0]["months"] == 12
    assert "Finish Class 9-10 (SSC board)" not in names(c12)
    assert c12["stages"][0]["kind"] == "school" and c12["stages"][0]["months"] == 12
    assert pass12["stages"][0]["kind"] == "exam"  # straight to MHT-CET
    assert c9["totals"]["months_to_job"] > c10["totals"]["months_to_job"] > c12["totals"]["months_to_job"]


def test_iti_path_skips_class_11_12():
    r = engine.build_roadmap(D, STU, "CAR01", 10)
    assert [s["kind"] for s in r["stages"]] == ["school", "exam", "course", "earn", "job"]


def test_exam_fee_comes_from_exams_sheet_by_category():
    ex = {e["id"]: e for e in D["exams"]}
    r_obc = engine.build_roadmap(D, STU, "CAR49", 12)
    r_open = engine.build_roadmap(D, {**STU, "category": "Open"}, "CAR49", 12)
    cet = lambda r: next(s for s in r["stages"] if s["kind"] == "exam")
    assert cet(r_obc)["fee_low"] == ex["EX03"]["fee_reserved"]
    assert cet(r_open)["fee_low"] == ex["EX03"]["fee_open"]
    assert not cet(r_open)["estimate"]


def test_plan_fees_are_reused_when_the_career_has_a_plan():
    plan = next(p for p in D["plans"] if p["career_id"] == "CAR01")
    iti = next(s for s in engine.build_roadmap(D, STU, "CAR01")["stages"] if s["kind"] == "course")
    assert iti["fee_low"] == iti["fee_high"] == plan["fees"] + plan["materials"]
    assert iti["plan_id"] == plan["id"]


def test_stipend_from_stipend_rates_when_career_has_no_listing():
    rate = next(s for s in D["stipends"] if s["category"] == "Diploma holder (any stream)")["current"]
    earn = next(s for s in engine.build_roadmap(D, STU, "CAR51")["stages"] if s["kind"] == "earn")
    assert earn["stipend_per_month"] == rate and earn["stipend_total"] == rate * 12


def test_unsourced_fees_are_flagged_as_estimates():
    r = engine.build_roadmap(D, STU, "CAR47", 10)
    degree = next(s for s in r["stages"] if s["kind"] == "course")
    assert degree["estimate"] and degree["status"].lower().startswith("estimate")
    assert r["totals"]["estimated_stages"] >= 1


def test_totals_add_up():
    r = engine.build_roadmap(D, STU, "CAR51", 10)
    t = r["totals"]
    assert t["cost_low"] == sum(s["fee_low"] for s in r["stages"])
    assert t["net_high"] == max(0, t["cost_high"] - t["scholarship_high"] - t["stipend"])
    assert r["income"] and r["stages"][-1]["income"] == r["income"]


def test_no_scholarship_when_not_eligible():
    rich = {**STU, "category": "Open", "family_income_annual": 5000000, "documents": []}
    r = engine.build_roadmap(D, rich, "CAR49", 10)
    assert r["totals"]["scholarship_high"] == 0
    assert r["totals"]["net_high"] == r["totals"]["cost_high"]


def test_unknown_career():
    assert engine.build_roadmap(D, STU, "CAR999") is None


def test_roadmap_sheet_has_no_warnings():
    assert not [w for w in D["warnings"] if "Roadmap" in w or "roadmap" in w]
