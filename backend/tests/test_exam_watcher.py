"""Students who follow an exam hear about new dates on its official site, once, and nobody else does."""
from datetime import date

from fastapi.testclient import TestClient

from raah import dataset, watcher
from raah.main import app

c = TestClient(app)
PIN = "4826"
TODAY = date(2026, 11, 18)


def login(phone, role="student"):
    c.post("/api/auth/register", json={"phone": phone, "role": role, "pin": PIN, "name": "Test"})
    r = c.post("/api/auth/login", json={"phone": phone, "role": role, "pin": PIN})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def inbox(headers):
    return [n for n in c.get("/api/auth/notifications", headers=headers).json() if n["kind"] == "exam_dates"]


def exam(exam_id):
    return next(e for e in dataset.get()["exams"] if e["id"] == exam_id)


def page(*rows):
    return "<html><body><table>" + "".join(f"<tr><td>{a}</td><td>{b}</td></tr>" for a, b in rows) + "</table></body></html>"


def test_reads_labelled_dates_and_skips_site_noise():
    found = watcher.extract_dates(
        "<html><head><script>var x='Exam 1 Jan 2027'</script></head><body>"
        "<p>Last updated on 20 Dec 2026</p><p>Holiday on 5 January 2027</p>"
        "<ul><li>Last date to apply: 8th March 2027</li><li>Admit card from 2027-ignored 12/04/2027</li></ul>"
        "<table><tr><td>Registration</td><td>24 Jan - 24 Feb 2027</td></tr></table></body></html>")
    assert {(f["kind"], f["date"]) for f in found} == {
        ("registration", "2027-03-08"), ("admit_card", "2027-04-12"),
        ("registration", "2027-01-24"), ("registration", "2027-02-24")}


def test_real_world_page_shapes():
    # comments outside <html> are common on government sites, and comment text is not page text
    html = "<!-- top --><html><body><!-- Exam 9 Jan 2027 --><p>Exam on 1 Feb 2027</p></body></html><!-- end -->"
    assert [f["date"] for f in watcher.extract_dates(html)] == ["2027-02-01"]
    assert watcher._other_www("https://www.mscepune.in") == "https://mscepune.in"
    assert watcher._other_www("https://mscepune.in/a") == "https://www.mscepune.in/a"


def test_script_only_page_is_not_taken_as_a_baseline():
    shell = '<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>'
    assert watcher.check_exam(exam("EX01"), fetch=lambda _: shell, today=TODAY)["status"] == "unreadable"
    assert watcher.check_exam(exam("EX01"), fetch=lambda _: page(("ITI registration", "1 Jun 2027")), today=TODAY)["status"] == "baseline"


def test_shared_site_only_counts_lines_about_that_exam():
    exams = dataset.get()["exams"]
    nursing, cet = exam("EX04"), exam("EX03")
    html = page(("MH Nursing CET registration", "10 Jan 2027"), ("MHT-CET PCM exam", "20 Apr 2027"))
    assert [f["date"] for f in watcher.extract_dates(html, watcher.distinctive_words(nursing, exams))] == ["2027-01-10"]
    assert [f["date"] for f in watcher.extract_dates(html, watcher.distinctive_words(cet, exams))] == ["2027-04-20"]
    assert watcher.distinctive_words(exam("EX05"), exams) is None


def test_broad_department_site_ignores_unrelated_notices():
    html = page(("Drone challenge application", "19 Jan 2027"), ("Polytechnic admission registration", "20 May 2027"))
    words = watcher.distinctive_words(exam("EX02"), dataset.get()["exams"])
    assert [f["date"] for f in watcher.extract_dates(html, words)] == ["2027-05-20"]


def test_follower_is_alerted_once_about_new_future_dates_only():
    fan, other = login("9700000101"), login("9700000102")
    assert c.put("/api/exams/EX05/follow", headers=fan).json()["following"] is True
    c.put("/api/exams/EX05/follow", headers=fan)  # following twice is harmless
    assert c.get("/api/exams/following", headers=fan).json()["exam_ids"] == ["EX05"]

    old = [("NEET registration", "10 Jan 2027"), ("Exam held", "3 May 2026")]
    first = watcher.check_exam(exam("EX05"), fetch=lambda _: page(*old), today=TODAY)
    assert first["status"] == "baseline" and first["notified"] == 0 and inbox(fan) == []

    added = old + [("NEET-UG exam", "2 May 2027"), ("Result declared", "1 Feb 2026")]
    second = watcher.check_exam(exam("EX05"), fetch=lambda _: page(*added), today=TODAY)
    assert second["new_dates"] == 1 and second["notified"] == 1
    got = inbox(fan)
    assert len(got) == 1 and got[0]["exam_id"] == "EX05" and got[0]["dates"] == [{"kind": "exam", "date": "2027-05-02"}]
    assert got[0]["source_url"] == exam("EX05")["site"] and got[0]["read"] is False
    assert inbox(other) == []

    assert watcher.check_exam(exam("EX05"), fetch=lambda _: page(*added), today=TODAY)["notified"] == 0
    assert len(inbox(fan)) == 1


def test_unreachable_site_never_alerts_and_keeps_the_baseline():
    fan = login("9700000103")
    c.put("/api/exams/EX06/follow", headers=fan)

    def down(_):
        raise OSError("site down")

    assert watcher.check_exam(exam("EX06"), fetch=down, today=TODAY)["status"] == "unreachable"
    assert watcher.check_exam(exam("EX06"), fetch=lambda _: page(("NMMS exam", "20 Dec 2026")), today=TODAY)["status"] == "baseline"
    assert watcher.check_exam(exam("EX06"), fetch=down, today=TODAY)["notified"] == 0
    r = watcher.check_exam(exam("EX06"), fetch=lambda _: page(("NMMS exam", "20 Dec 2026"), ("NMMS result", "9 Feb 2027")), today=TODAY)
    assert r["notified"] == 1 and inbox(fan)[0]["dates"] == [{"kind": "result", "date": "2027-02-09"}]


def test_unfollow_stops_alerts_and_only_followed_exams_are_fetched():
    fan = login("9700000104")
    c.put("/api/exams/EX07/follow", headers=fan)
    watcher.check_exam(exam("EX07"), fetch=lambda _: page(("Apply", "1 Jan 2027")), today=TODAY)
    c.delete("/api/exams/EX07/follow", headers=fan)
    assert watcher.check_exam(exam("EX07"), fetch=lambda _: page(("Apply", "2 Jan 2027")), today=TODAY)["notified"] == 0
    assert inbox(fan) == []

    fetched = []
    watcher.run_once(fetch=lambda u: fetched.append(u) or page(), today=TODAY, pause=0)
    assert exam("EX07")["site"] not in fetched and exam("EX05")["site"] in fetched


def test_access_rules():
    student = login("9700000105")
    assert c.put("/api/exams/EX05/follow").status_code in (401, 403)
    assert c.put("/api/exams/NOPE/follow", headers=student).status_code == 404
    assert c.post("/api/exams/watch/run", headers=student).status_code == 403
    assert c.get("/api/exams/watch/status", headers=student).status_code == 403
