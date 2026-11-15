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
