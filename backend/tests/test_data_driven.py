"""Editing the spreadsheet must change the app's numbers with no code change."""
import shutil
import tempfile
from pathlib import Path

import openpyxl

from raah import dataset, engine

SRC = Path(dataset.DATASET_PATH)


def _edit(path, sheet, row_id, col_name, value):
    wb = openpyxl.load_workbook(path)
    ws = wb[sheet]
    head = [c.value for c in ws[1]]
    col = head.index(col_name) + 1
    for r in range(2, ws.max_row + 1):
        if ws.cell(r, 1).value == row_id:
            ws.cell(r, col).value = value
    wb.save(path)


def test_income_limit_edit_flows_to_rules():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "d.xlsx"
        shutil.copy(SRC, p)
        _edit(p, "Scholarships", "SCH16", "Income limit", "≤ ₹1,00,000 per year")
        d = dataset.load(p)
        priya = d["students"][0]
        plan = next(x for x in d["plans"] if x["id"] == "PLN01")
        r = {e["id"]: e for e in engine.eligibility(d, priya, plan)}
        assert r["SCH16"]["status"] == "not_eligible"  # 1.8 lakh > 1 lakh
        rule = next(x for x in d["scholarships"] if x["id"] == "SCH16")["rules"][-1]
        assert rule["value"] == 100000 and "1,00,000" in rule["label"]


def test_fee_and_amount_edits_flow_to_payback():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "d.xlsx"
        shutil.copy(SRC, p)
        base = engine.compute_plan(dataset.load(p), dataset.load(p)["students"][0], "PLN01", {"scholarships": []})
        _edit(p, "Plan_Inputs", "PLN01", "Course fees total (₹)", 160000)
        d = dataset.load(p)
        after = engine.compute_plan(d, d["students"][0], "PLN01", {"scholarships": []})
        assert after["costs"]["total"] == base["costs"]["total"] + 80000
        assert after["payback"]["median"]["months_after_training"] > base["payback"]["median"]["months_after_training"]


def test_income_edit_changes_payback():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "d.xlsx"
        shutil.copy(SRC, p)
        _edit(p, "Careers_Income", "CAR25", "Income after training / entry pay", "₹40,000/month (test)")
        d = dataset.load(p)
        r = engine.compute_plan(d, d["students"][0], "PLN01", {"scholarships": []})
        assert r["income"]["median"] == 40000


def test_cache_reloads_on_save():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "d.xlsx"
        shutil.copy(SRC, p)
        a = dataset.get(p)["assumptions"]["fare_per_km"]["value"]
        import os, time
        _edit(p, "Assumptions", "fare_per_km", "Value", 2.5)
        os.utime(p, (time.time() + 5, time.time() + 5))
        b = dataset.get(p)["assumptions"]["fare_per_km"]["value"]
        assert a != b and b == 2.5


def test_exam_fee_and_plan_link_come_from_the_exams_sheet():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "d.xlsx"
        shutil.copy(SRC, p)
        _edit(p, "Exams", "EX01", "Application fee (Open / General)", "₹175")
        _edit(p, "Plan_Inputs", "PLN03", "Exams / admissions (IDs, use ;)", "EX01; EX99")
        d = dataset.load(p)
        assert next(e for e in d["exams"] if e["id"] == "EX01")["fee_open"] == 175
        assert next(pl for pl in d["plans"] if pl["id"] == "PLN03")["exams"] == ["EX01"]
        assert any("EX99" in w for w in d["warnings"])


def test_occupation_earnings_edit_flows_to_linked_careers():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "d.xlsx"
        shutil.copy(SRC, p)
        d = dataset.load(p)
        ele = next(c for c in d["careers"] if c["id"] == "CAR01")
        assert ele["earnings"]["group"] == "Craft and related trades workers"
        wb = openpyxl.load_workbook(p)
        ws = wb["Occupation_Earnings"]
        head = [c.value for c in ws[1]]
        for r in range(2, ws.max_row + 1):
            if ws.cell(r, 1).value == "Craft and related trades workers":
                ws.cell(r, head.index("All India male (₹/month)") + 1).value = 30000
        wb.save(p)
        d = dataset.load(p)
        man = {**d["students"][0], "gender": "M"}
        r = engine.compute_plan(d, man, "PLN03", {})
        assert r["income"]["median"] == 30000 and r["income"]["spread"] == "rural_urban"
        # low / high are the rural and urban averages, not blanket factors
        assert r["income"]["low"] < 30000 and r["income"]["derived"] is False


def test_pay_path_grows_income_and_shortens_payback():
    d = dataset.load(SRC)
    gnm = next(c for c in d["careers"] if c["id"] == "CAR24")
    assert gnm["pay_path"][0] < gnm["pay_path"][-1]
    inc = engine.plan_income(d, {}, gnm, "F")
    assert engine.income_at(inc, "median", 1) == gnm["pay_path"][0]
    assert engine.income_at(inc, "median", 49) == gnm["pay_path"][2]  # year 5
    flat = {**inc, "path": None}
    net = inc["median"] * 40
    assert engine.payback_after(net, inc, "median", 0, 120) < engine.payback_after(net, flat, "median", 0, 120)
    # a blank year-5 cell holds the last known pay (Agniveer's term ends after year 4)
    assert engine.path_value([30000, 36500, None], 5) == 36500
