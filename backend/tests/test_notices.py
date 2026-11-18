"""Live notices: reading official sites' notice lists, dates and deadlines, tags, matching students, the API and the
raah-notices MCP server. No network: every site is a fake page."""
import json
import os
from datetime import date, timedelta

os.environ["RAAH_MCP_TRANSPORT"] = "memory"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from raah import dataset, db, engine, mcp_client  # noqa: E402
from raah import notices as N  # noqa: E402
from raah.main import app  # noqa: E402
from mcp_servers.data_server import clean_profile  # noqa: E402

c = TestClient(app)
PIN = "4826"
TODAY = date.today()


def login(phone, role="student", name="Notice Test"):
    c.post("/api/auth/register", json={"phone": phone, "role": role, "pin": PIN, "name": name})
    r = c.post("/api/auth/login", json={"phone": phone, "role": role, "pin": PIN})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


@pytest.fixture(autouse=True)
def _snapshots(tmp_path, monkeypatch):
    monkeypatch.setattr(N, "SNAPSHOTS", tmp_path / "snapshots")  # never overwrite the real saved pages


def ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


def cet_page(*items):
    lis = "".join(f'<li><a href="{u}">{t}</a></li>' for t, u in items)
    return (f'<html><body><nav><a href="/about/">About the CET Cell office</a></nav>'
            f'<ul class="educms-download-marquee-content-items">{lis}</ul></body></html>')


def up(d: date, name="notice.pdf"):
    return f"https://cetcell.mahacet.org/wp-content/uploads/{d:%Y}/{d:%m}/{name}"


def no_read(url):
    return {"text": ""}


# ------------------------------------------------------------------ dates

def test_dates_in_english_marathi_and_hindi_with_labels():
    got = N.extract_dates("Last date for registration extended to 28 Feb 2027; forms open from 10.01.2027")
    assert [(d["date"], d["label"]) for d in got] == [("2027-02-28", "deadline"), ("2027-01-10", "start")]
    mr = N.extract_dates("अर्ज स्वीकृती ३० सप्टेंबर,२०२६ पर्यंत सुरू राहील. नवीन अर्ज १ जून २०२६ पासून")
    assert [(d["date"], d["label"]) for d in mr] == [("2026-09-30", "deadline"), ("2026-06-01", "start")]
    assert mr[0]["text"] == "३० सप्टेंबर,२०२६"  # the original wording is kept
    assert N.extract_dates("परीक्षा 5 मई 2027 को होगी")[0]["date"] == "2027-05-05"
    assert N.extract_dates("Result on December 5, 2026")[0] == {"date": "2026-12-05", "text": "December 5, 2026", "label": "date"}
    assert N.extract_dates("still open, see 31/02/2027 and 3.5 lakh seats") == []  # no such date; not a date
    assert N.next_deadline([{"date": "2020-01-01", "label": "deadline"}, {"date": "2099-01-01", "label": "deadline"}]) == "2099-01-01"


def test_published_date_from_official_upload_paths():
    assert N.published_from_url("https://cdnbbsr.s3waas.gov.in/s3f/uploads/2026/10/2026103021.pdf") == "2026-10-30"
    assert N.published_from_url("https://cetcell.mahacet.org/wp-content/uploads/2026/10/Circular_19102026.pdf") == "2026-10-19"
    assert N.published_from_url("https://cetcell.mahacet.org/wp-content/uploads/2026/11/Cet_2027_28.pdf") == "2026-11"
    assert N.published_from_url("https://mahadbt2.maharashtra.gov.in/") is None


# ------------------------------------------------------------------ reading a site

def test_parse_items_keeps_notices_and_skips_menus():
    src = N.SOURCE_BY_ID["jee"]
    page = ('<div class="gen-list"><ul>'
            '<li><a href="https://cdnbbsr.s3waas.gov.in/x/uploads/2026/10/2026103021.pdf">Clarification regarding the Online Application Form for JEE (Main) 2027</a></li>'
            '<li><a href="https://www.education.gov.in/">Ministry Of Education</a></li>'
            '<li><a href="https://cdnbbsr.s3waas.gov.in/x/uploads/2026/10/2026103021.pdf">Clarification regarding the Online Application Form for JEE (Main) 2027</a></li>'
            '</ul></div>')
    items = N.parse_items(src, page)
    assert [i["title"] for i in items] == ["Clarification regarding the Online Application Form for JEE (Main) 2027"]
    dbt = N.parse_items(N.SOURCE_BY_ID["mahadbt"], '<div class="notice-text"> नवीन अर्ज स्वीकारण्यास १ जून २०२६ पासून सुरुवात होईल. </div>')
    assert dbt == [{"title": "नवीन अर्ज स्वीकारण्यास १ जून २०२६ पासून सुरुवात होईल.", "url": "https://mahadbt2.maharashtra.gov.in/"}]


def test_tags_come_from_the_exams_and_scholarships_sheets():
    d = dataset.get()
    cet = N.SOURCE_BY_ID["cetcell"]
    by_name = {e["name"]: e["id"] for e in d["exams"]}
    nursing = next(i for n, i in by_name.items() if "Nursing" in n)
    assert N.tag_notice("MH Nursing CET 2027 registration opens", cet, d) == {"category": "application", "exams": [nursing], "schemes": []}
    both = N.tag_notice("शैक्षणिक वर्ष २०२७-२८ करिता सीईटी प्रवेश परीक्षांबाबत प्रसिद्धीपत्रक", cet, d)
    cet_exams = sorted(e["id"] for e in d["exams"] if "cetcell" in str(e["site"]))
    assert both["exams"] == cet_exams and both["category"] == "admission"
    assert N.tag_notice("Score Card for NEET (UG) 2026", N.SOURCE_BY_ID["nta"], d)["category"] == "result"
    dbt = N.tag_notice("नवीन अर्ज स्वीकारण्यास सुरुवात", N.SOURCE_BY_ID["mahadbt"], d)
    assert dbt["schemes"] and all("mahadbt" in s["apply_via"].lower() for s in d["scholarships"] if s["id"] in dbt["schemes"])


def test_read_notice_only_opens_official_pages_and_reads_dates():
    assert "error" in N.read_notice("https://example.com/x.pdf")
    got = N.read_notice("https://cetcell.mahacet.org/n/", fetch_bytes=lambda u: (
        b"<html><body><script>x='1 Jan 2020'</script><p>Last date to apply is 15 March 2027.</p></body></html>", "text/html"))
    assert got["kind"] == "page" and "1 Jan 2020" not in got["text"]
    assert got["dates"] == [{"date": "2027-03-15", "text": "15 March 2027", "label": "deadline"}]


# ------------------------------------------------------------------ a run, matching and the API

def test_first_read_is_a_baseline_then_new_notices_reach_the_right_students():
    d = dataset.get()
    cet = N.SOURCE_BY_ID["cetcell"]
    mht = next(e for e in d["exams"] if "MHT" in e["name"])
    career = next(c["id"] for c in d["careers"] if mht["id"] in N.roadmap_exams(d, c["id"]))

    # a student whose roadmap needs MHT-CET, one who asked to be told, one with neither
    road, watch, other = login("9700000031"), login("9700000032"), login("9700000033")
    assert c.put("/api/auth/profile", headers=road, json={"name": "Road", "roadmap_career": career, "roadmap_at": "2026-11-01"}).status_code == 200
    assert c.put(f"/api/watch/interests/exam/{mht['id']}", headers=watch).status_code == 200
    teacher = login("9000000003", role="teacher", name="Notice Teacher")

    old = TODAY - timedelta(days=200)
    base = cet_page(("CET Cell circular on CAP rounds for the previous year admissions", up(old, "old.pdf")),
                    ("Undated general information notice for all candidates", "https://cetcell.mahacet.org/info/"))
    first = N.check_source(cet, lambda u: base, read=no_read)
    assert first["status"] == "ok" and first["new"] == 2 and first["fresh"] == 0  # already public: nobody is told
    assert N.match_students()["sent"] == 0

    soon = TODAY + timedelta(days=5)
    new = cet_page(("CET Cell circular on CAP rounds for the previous year admissions", up(old, "old.pdf")),
                   ("Undated general information notice for all candidates", "https://cetcell.mahacet.org/info/"),
                   (f"MHT-CET 2027 registration: last date {soon:%d.%m.%Y}", up(TODAY, f"mhtcet_{TODAY:%d%m%Y}.pdf")))
    second = N.check_source(cet, lambda u: new, read=no_read)
    assert second["new"] == 1 and second["fresh"] == 1
    m = N.match_students()
    assert m["sent"] >= 2
    assert N.match_students()["sent"] == 0  # never twice

    inbox = c.get("/api/auth/notifications", headers=road).json()
    note = next(n for n in inbox if n["kind"] == "notice")
    assert note["why"] == "roadmap" and note["why_ref"] == mht["name"] and note["deadline"] == soon.isoformat()
    assert note["url"].startswith("https://cetcell.mahacet.org/") and note["source"] == "CET Cell"
    assert next(n for n in c.get("/api/auth/notifications", headers=watch).json() if n["kind"] == "notice")["why"] == "watching"
    assert not [n for n in c.get("/api/auth/notifications", headers=other).json() if n["kind"] == "notice"]

    mine = c.get("/api/notices?tab=for_you", headers=road).json()
    assert mine["items"][0]["why"] == "roadmap" and mine["items"][0]["days_left"] == 5
    dl = c.get("/api/notices?tab=deadlines", headers=other).json()["items"]
    assert dl and dl[0]["deadline"] == soon.isoformat() and "why" not in dl[0]
    everything = c.get("/api/notices?tab=all", headers=other).json()
    assert len(everything["items"]) == 3 and any(s["id"] == "cetcell" and s["status"] == "ok" for s in everything["sources"])
    assert c.get("/api/notices?tab=bogus", headers=other).status_code == 422

    # teacher review: counts, verify, hide
    assert c.get("/api/notices/teacher", headers=road).status_code == 403
    tl = c.get("/api/notices/teacher", headers=teacher).json()["items"]
    item = next(i for i in tl if "MHT-CET 2027" in i["title"])
    assert item["students"] >= 2 and item["verified"] is False
    assert c.post(f"/api/notices/{item['id']}/verify", headers=teacher).status_code == 200
    assert c.get("/api/notices?tab=for_you", headers=road).json()["items"][0]["verified"] is True
    assert c.post(f"/api/notices/{item['id']}/hide", headers=teacher).status_code == 200
    assert c.get("/api/notices?tab=for_you", headers=road).json()["items"] == []
    assert c.post("/api/notices/999999/verify", headers=teacher).status_code == 404
    assert c.post(f"/api/notices/{item['id']}/unhide", headers=teacher).status_code == 200


def test_scholarship_portal_notices_go_to_eligible_students():
    d = dataset.get()
    dbt = N.SOURCE_BY_ID["mahadbt"]
    portal = {s["id"] for s in d["scholarships"] if "mahadbt" in str(s["apply_via"]).lower()}
    demo = next(s for s in d["students"] if any(e["id"] in portal and e["status"] in ("eligible", "eligible_missing_docs")
                                                for e in engine.eligibility(d, clean_profile(s))))
    h = login("9700000034")
    assert c.put("/api/auth/profile", headers=h, json={k: v for k, v in demo.items() if k not in ("id", "note")}).status_code == 200

    N.check_source(dbt, lambda u: '<div class="notice-text">Old portal notice about Aadhaar seeding for students</div>', read=no_read)
    later = TODAY + timedelta(days=20)
    page = ('<div class="notice-text">Old portal notice about Aadhaar seeding for students</div>'
            f'<div class="notice-text">२०२६-२७ साठी अर्ज {later.day} {["जानेवारी","फेब्रुवारी","मार्च","एप्रिल","मे","जून","जुलै","ऑगस्ट","सप्टेंबर","ऑक्टोबर","नोव्हेंबर","डिसेंबर"][later.month-1]} {later.year} पर्यंत स्वीकारले जातील</div>')
    res = N.check_source(dbt, lambda u: page, read=no_read)
    assert res["new"] == 1 and res["fresh"] == 1
    N.match_students()
    note = next(n for n in c.get("/api/auth/notifications", headers=h).json() if n["kind"] == "notice")
    assert note["why"] == "scheme" and note["deadline"] == later.isoformat() and note["source"] == "MahaDBT"


def test_a_site_that_is_down_uses_the_last_good_copy():
    src = N.SOURCE_BY_ID["nta"]
    page = ('<marquee class="latestPart"><p><a href="https://cdnbbsr.s3waas.gov.in/x/uploads/2026/10/2026101619.pdf">'
            'Public Notice Corrigendum to the Information Bulletin of UGC-NET</a></p></marquee>')
    assert N.read_source(src, lambda u: page)[1] == "ok"

    def down(u):
        raise RuntimeError("site down")
    got, status, at = N.read_source(src, down)
    assert status == "snapshot" and got == page and at
    assert N.read_source(N.SOURCE_BY_ID["jee"], down) == (None, "error", None)


def test_only_teachers_can_run_the_watcher():
    assert c.post("/api/notices/refresh", headers=login("9700000035")).status_code == 403


def test_run_streams_every_source(monkeypatch):
    events = list(N.run_steps(fetch=lambda u: "<html><body>nothing here</body></html>", read=no_read, summaries=False))
    assert [e["source"] for e in events if e["type"] == "source_done"] == [s["id"] for s in N.SOURCES]
    assert events[-1]["type"] == "done"


def test_summaries_must_keep_every_number(monkeypatch):
    from raah import llm

    monkeypatch.setattr(llm, "chat", lambda *a, **k: (json.dumps(
        {"en": "Registration for JEE 2027 closes on 22 Nov 2026", "hi": "जेईई 2027 पंजीकरण 22 नवंबर 2026 तक",
         "mr": "जेईई 2027 नोंदणी 23 नोव्हेंबर 2026 पर्यंत"}), "test"))
    got = N.summarise("JEE 2027 registration closes on 22 Nov 2026")
    assert set(got) == {"en", "hi"}  # the Marathi line changed a number, so it is dropped


# ------------------------------------------------------------------ MCP

def test_notices_server_tools_through_mcp():
    names = {t["name"] for t in mcp_client.tools()}
    assert {"latest_notices", "read_notice", "fetch_notices", "list_sources", "extract_dates"} <= names
    assert {"rank_careers", "get_scholarships"} <= names  # raah-data is still there
    st = mcp_client.status()
    assert [s["server"] for s in st["servers"]] == ["raah-data", "raah-notices"] and st["connected"]
    got = mcp_client.call("extract_dates", {"text": "Last date 15 March 2027"})
    assert got["dates"][0]["label"] == "deadline"
    assert mcp_client.call("read_notice", {"url": "https://example.com/"})["error"]
    assert "sources" in mcp_client.call("list_sources", {})
    assert "notices" in mcp_client.call("latest_notices", {"query": "CET"})
    assert mcp_client.call("fetch_notices", {"source": "nowhere"})["error"]
