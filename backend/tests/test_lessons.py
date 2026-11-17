"""Audio lessons come from the Lessons / Lesson_Topics sheets: every career has one, in three languages, with an easy quiz."""
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import openpyxl
import pytest

from raah import dataset

SRC = Path(dataset.DATASET_PATH)


def test_every_career_has_a_lesson_in_every_language():
    d = dataset.load()
    covered = {c for l in d["lessons"] for c in l["career_ids"]}
    missing = [c["id"] for c in d["careers"] if c["id"] not in covered]
    assert not missing, f"careers with no lesson: {missing}"
    for l in d["lessons"]:
        assert set(l["text"]) == {"en", "hi", "mr"}, l["id"]
    assert not [w for w in d["warnings"] if w.startswith("Lessons")]


def test_topics_cover_all_lessons_and_have_translations():
    d = dataset.load()
    ids = [t["id"] for t in d["lesson_topics"]]
    assert ids[0] == "basics" and len(ids) >= 8
    assert {l["topic"] for l in d["lessons"]} <= set(ids)
    for t in d["lesson_topics"]:
        assert all(t["name"][k] for k in ("en", "hi", "mr"))


def test_quiz_is_easy_and_not_about_amounts():
    d = dataset.load()
    for l in d["lessons"]:
        for lang, x in l["text"].items():
            assert x["q"] and x["right"] and len(x["wrong"]) == 2, (l["id"], lang)
            for s in [x["q"], x["right"], *x["wrong"]]:
                assert "₹" not in s and "%" not in s, (l["id"], lang, s)
                # only class numbers ("Class 10") are allowed, never figures like fees or stipends
                assert not re.search(r"\d", re.sub(r"Class \d+", "", s)), (l["id"], lang, s)


def test_lessons_are_short_enough_to_listen_to():
    d = dataset.load()
    for l in d["lessons"]:
        words = len(l["text"]["en"]["text"].split())
        assert 40 <= words <= 140, (l["id"], words)


def test_lesson_edit_in_excel_flows_to_app_and_bad_ids_warn():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "d.xlsx"
        shutil.copy(SRC, p)
        wb = openpyxl.load_workbook(p)
        ws = wb["Lessons"]
        head = [c.value for c in ws[1]]
        ws.append({head.index("Lesson ID") + 1: "X01", head.index("Topic ID") + 1: "nope",
                   head.index("Career IDs (use ;)") + 1: "CAR99",
                   head.index("Title (English)") + 1: "New lesson", head.index("Lesson (English)") + 1: "Some text."})
        wb.save(p)
        d = dataset.load(p)
        x = next(l for l in d["lessons"] if l["id"] == "X01")
        assert x["text"]["en"]["title"] == "New lesson" and x["text"]["en"]["q"] is None
        assert set(x["text"]) == {"en"}  # blank translations fall back to English in the app
        assert any("X01" in w and "nope" in w for w in d["warnings"])
        assert any("X01" in w and "CAR99" in w for w in d["warnings"])


WEB = Path(__file__).resolve().parents[2] / "web"


@pytest.mark.skipif(not (WEB / "node_modules" / ".bin" / "tsx").exists() or not shutil.which("node"), reason="web deps not installed")
def test_learn_screen_picks_lessons():
    d = dataset.load()
    d.pop("_private", None)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(d, f, ensure_ascii=False)
    try:
        r = subprocess.run([str(WEB / "node_modules" / ".bin" / "tsx"), "tests/lessons.ts", f.name], cwd=WEB, capture_output=True, text=True)
    finally:
        os.unlink(f.name)
    assert r.returncode == 0, r.stderr + r.stdout
