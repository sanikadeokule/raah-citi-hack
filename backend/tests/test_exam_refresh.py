"""The exam dates refresh reads the sites the Exams sheet names and writes the next dates back into the workbook."""
import shutil
from datetime import date
from pathlib import Path

import openpyxl
import pytest

from raah import dataset, exam_refresh as er

TODAY = date(2026, 11, 28)


def page(*lines):
    return "<html><body><script>var x = '1 Jan 2030';</script>" + "".join(f"<p>{ln}</p>" for ln in lines) + "</body></html>"


@pytest.fixture
def book(tmp_path):
    p = tmp_path / "raah-dataset.xlsx"
    shutil.copy(dataset.DATASET_PATH, p)
    return p


def exams(path):
    return {e["id"]: e for e in dataset.load(path)["exams"]}


def test_classify_reads_ranges_deadlines_and_exam_days():
    assert er.classify("NDA 1 2027: apply 2-22 Dec 2026; exam on 11 Apr 2027") == [
        ("open", date(2026, 12, 2)), ("close", date(2026, 12, 22)), ("exam", date(2027, 4, 11))]
    assert er.classify("Online registration from 26 Dec 2026 to 25 Jan 2027") == [("open", date(2026, 12, 26)), ("close", date(2027, 1, 25))]
    assert er.classify("Registration 24 Dec-15 Jan 2027") == [("open", date(2026, 12, 24)), ("close", date(2027, 1, 15))]
    assert er.classify("Last date to apply: 15/03/2027") == [("close", date(2027, 3, 15))]
    assert er.classify("Date of examination: March 8, 2027") == [("exam", date(2027, 3, 8))]
    # the key-dates table of a news article (careers360, JEE Main 2027), one row per line
    assert er.classify("Registration start date January 5, 2027 to February 3, 2027 (Up to 11:50 PM)") == [
        ("open", date(2027, 1, 5)), ("close", date(2027, 2, 3))]
    assert er.classify("JEE Main Session 1 exam January 20, 21, 22, 23, 24 and 28, 2027") == [("exam", date(2027, 1, 20))]
    assert er.classify("JEE Main 2027 exam will now be held on April 2,3,4,5,6 and 7 2027") == [("exam", date(2027, 4, 2))]
    assert er.classify("Correction in Particulars of the Online Application Form November 27, 2026 to November 29, 2026") == []
    assert er.classify("Downloading Admit Cards from the NTA website January 13, 2027") == []
    assert er.classify("Notice uploaded 12 Nov 2026") == []  # a date with no telling word is not guessed


def test_pick_keeps_upcoming_and_deadline_after_opening():
    found = [{"field": "close", "date": date(2025, 2, 1)}, {"field": "close", "date": date(2027, 1, 25)},
             {"field": "open", "date": date(2026, 12, 26)}, {"field": "exam", "date": date(2031, 1, 1)}]
    best = er.pick(found, TODAY)
    assert best["open"]["date"] == date(2026, 12, 26) and best["close"]["date"] == date(2027, 1, 25)
    assert "exam" not in best  # past and implausibly far dates are both dropped


def test_refresh_writes_dates_and_evidence_into_the_sheet(book):
    nda = exams(book)["EX13"]
    pages = {nda["site"]: page("Welcome to UPSC", "NDA & NA Examination (I), 2027: apply online 2-22 Dec 2026",
                               "NDA & NA Examination (I), 2027 exam on 11 Apr 2027", "Result of CDS 2025 declared 3 Jan 2025")}

    def fetch(url):
        if url in pages:
            return pages[url]
        raise OSError("site down")

    dry = er.refresh(fetch=fetch, write=False, path=book, today=TODAY, use_model=False, only=["EX13"])
    assert len(dry["changes"]) == 3 and dry["results"][0]["best"]["close"]["date"] == "2026-12-22"
    assert exams(book)["EX13"]["next_dates"]["close"] is None  # a dry run leaves the file alone

    out = er.refresh(fetch=fetch, write=True, path=book, today=TODAY, use_model=False, only=["EX13", "EX05"])
    assert {(c["exam"], c["field"], c["new"]) for c in out["changes"]} == {
        ("EX13", "open", "2026-12-02"), ("EX13", "close", "2026-12-22"), ("EX13", "exam", "2027-04-11")}
    after = exams(book)
    assert after["EX13"]["next_dates"] == {"open": "2026-12-02", "close": "2026-12-22", "exam": "2027-04-11", "checked": "2026-11-28"}
    assert "2-22 Dec 2026" in after["EX13"]["dates_evidence"] and after["EX13"]["dates_url"] == nda["site"]
    assert after["EX13"]["dates"] == nda["dates"]  # the hand-written 'Last cycle dates' cell is never touched
    # NEET's pages were down: its row is left exactly as it was, not even marked checked
    assert after["EX05"]["next_dates"] == {"open": None, "close": None, "exam": None, "checked": None}

    again = er.refresh(fetch=fetch, write=True, path=book, today=TODAY, use_model=False, only=["EX13"])
    assert again["changes"] == []  # same page, nothing to change

    # the other sheets survive the save
    wb = openpyxl.load_workbook(book, read_only=True)
    assert set(wb.sheetnames) == set(openpyxl.load_workbook(dataset.DATASET_PATH, read_only=True).sheetnames)


def test_shared_site_only_counts_lines_naming_the_exam(book):
    nursing = exams(book)["EX04"]  # shares cetcell.mahacet.org with MHT-CET and other CETs
    html = page("MHT-CET 2027 registration from 15 Dec 2026 to 15 Jan 2027", "MH Nursing CET 2027 last date to apply 20 Feb 2027")
    out = er.refresh(fetch=lambda u: html, write=True, path=book, today=TODAY, use_model=False, only=["EX04"])
    best = out["results"][0]["best"]
    assert set(best) == {"close"} and best["close"]["date"] == "2027-02-20"
    assert exams(book)["EX04"]["next_dates"]["close"] == "2027-02-20"
    assert nursing["site"]


def test_model_pick_is_kept_only_when_the_line_prints_that_date(book, monkeypatch):
    from raah import llm
    html = page("SSC GD Constable 2027 notice: candidates may submit forms up to 31 Dec 2026", "SSC GD Constable admit card soon")
    replies = iter(['{"close": {"date": "2026-12-31", "line": 0}}', '{"close": {"date": "2027-01-05", "line": 0}}'])
    monkeypatch.setattr(llm, "chat", lambda *a, **k: (next(replies), "fake"))
    ok = er.refresh(fetch=lambda u: html, write=False, path=book, today=TODAY, only=["EX10"])["results"][0]
    assert ok["best"]["close"] == {"date": "2026-12-31", "line": html.split("<p>")[1].split("</p>")[0], "url": ok["best"]["close"]["url"], "by": "model"}
    bad = er.refresh(fetch=lambda u: html, write=False, path=book, today=TODAY, only=["EX10"])["results"][0]
    assert bad["best"] == {}  # 5 Jan 2027 is not on the page, so the model's answer is dropped


def test_refresh_refuses_to_overwrite_an_edit_made_during_the_run(book):
    import os

    def fetch(url):
        os.utime(book, (1, 1))  # someone saved the workbook while the sites were being read
        return page("NDA & NA Examination (I), 2027 exam on 11 Apr 2027")

    with pytest.raises(RuntimeError):
        er.refresh(fetch=fetch, write=True, path=book, today=TODAY, use_model=False, only=["EX13"])


def test_only_teachers_can_run_or_see_the_refresh():
    from fastapi.testclient import TestClient

    from raah.main import app
    c = TestClient(app)
    c.post("/api/auth/register", json={"phone": "9700000091", "role": "student", "pin": "4826", "name": "Refresh Test"})
    tok = c.post("/api/auth/login", json={"phone": "9700000091", "role": "student", "pin": "4826"}).json()["access_token"]
    h = {"Authorization": "Bearer " + tok}
    assert c.get("/api/refresh/exams", headers=h).status_code == 403
    assert c.post("/api/refresh/exams", headers=h).status_code == 403


def test_cli_dry_run_never_writes(book, monkeypatch, capsys):
    from datetime import timedelta
    soon = (date.today() + timedelta(days=60)).strftime("%d %b %Y")
    monkeypatch.setattr(dataset, "DATASET_PATH", Path(book))
    monkeypatch.setattr(er, "fetch_page", lambda u: page(f"NDA & NA Examination (I) exam on {soon}"))
    before = book.read_bytes()
    assert er.main(["--no-model", "--exam", "EX13"]) == 0
    out = capsys.readouterr().out
    assert "1 cell(s) would change" in out and book.read_bytes() == before


def test_source_cells_with_several_addresses_are_all_read():
    e = {"site": "https://a.gov.in", "source": "https://b.in/x ; https://a.gov.in https://c.gov.in/n.pdf"}
    assert er.page_urls(e) == ["https://a.gov.in", "https://b.in/x", "https://c.gov.in/n.pdf"]


def test_pdf_notices_are_read_line_by_line():
    from pypdf import PdfWriter
    import io
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    w.write(buf)
    assert er.pdf_as_html(buf.getvalue()).startswith("<html>")  # a page with no text gives an empty, valid page


def test_home_page_notices_are_followed(book):
    jee = exams(book)["EX08"]
    home = ('<html><body><a href="/notice/jee-2027-s2.pdf">Public Notice: JEE (Main) 2027 Session 2 schedule</a>'
            '<a href="https://evil.example.com/notice">JEE Main notice</a><a href="/about">About NTA</a></body></html>')
    notice = page("JEE (Main) 2027 Session 2: online registration from 5 Jan 2027 to 3 Feb 2027",
                  "JEE (Main) 2027 Session 2 exam will be held on 2 Apr 2027")
    asked = []

    def fetch(url):
        asked.append(url)
        if url == jee["site"]:
            return home
        if url.endswith("jee-2027-s2.pdf"):
            return notice
        raise OSError("down")

    best = er.refresh(fetch=fetch, write=False, path=book, today=TODAY, use_model=False, only=["EX08"])["results"][0]["best"]
    assert {f: b["date"] for f, b in best.items()} == {"open": "2027-01-05", "close": "2027-02-03", "exam": "2027-04-02"}
    assert not any("evil" in u or u.endswith("/about") for u in asked)  # other sites and non-notice links are not followed
