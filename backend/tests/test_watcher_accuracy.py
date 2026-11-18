"""Exam alerts fire only for new, future dates that are really about the followed exam."""
from datetime import date

from fastapi.testclient import TestClient

from raah import dataset, watcher
from raah.main import app

c = TestClient(app)
PIN = "4826"
TODAY = date(2026, 11, 18)


def follower(phone, exam_id):
    c.post("/api/auth/register", json={"phone": phone, "role": "student", "pin": PIN, "name": "Accuracy Test"})
    r = c.post("/api/auth/login", json={"phone": phone, "role": "student", "pin": PIN})
    assert r.status_code == 200, r.text
    headers = {"Authorization": "Bearer " + r.json()["access_token"]}
    assert c.put(f"/api/watch/interests/exam/{exam_id}", headers=headers).status_code == 200
    return headers


def exam(exam_id):
    return next(e for e in dataset.get()["exams"] if e["id"] == exam_id)


def page(*lines):
    return "<html><body>" + "".join(f"<p>{ln}</p>" for ln in lines) + "</body></html>"


def check(exam_id, markup):
    return watcher.check_exam(exam(exam_id), lambda _: markup, today=TODAY)


def alerts(headers):
    return [n for n in c.get("/api/auth/notifications", headers=headers).json() if n["kind"] == "exam_update"]


def test_site_housekeeping_and_past_dates_do_not_alert():
    fan = follower("9700000301", "EX05")
    assert check("EX05", page("NEET exam date: 10 January 2027", "Last updated on 17 Nov 2026"))["status"] == "baseline"
    changed = page("NEET exam date: 10 January 2027", "Last updated on 19 Nov 2026", "Visitors till 20 Nov 2026",
                   "Holiday on 25 December 2026", "NEET result declared on 21 June 2026")
    assert check("EX05", changed)["notified"] == 0 and alerts(fan) == []


def test_reworded_notice_with_a_known_date_does_not_alert_again():
    fan = follower("9700000302", "EX07")
    check("EX07", page("Apprentice registration closes 15 January 2027"))
    assert check("EX07", page("Apprentice registration closes on 15 Jan 2027 (reminder)"))["notified"] == 0
    assert alerts(fan) == []


def test_label_and_date_in_separate_table_cells_alert_together():
    fan = follower("9700000303", "EX01")
    row = "<table><tr><td>{}</td><td>{}</td></tr></table>"
    check("EX01", "<html><body>" + row.format("Choice filling", "1 Jan 2027") + "</body></html>")
    r = check("EX01", "<html><body>" + row.format("Choice filling", "1 Jan 2027") + row.format("Last date to apply", "8 March 2027") + "</body></html>")
    assert r["notified"] == 1 and "Last date to apply 8 March 2027" in alerts(fan)[0]["body"]


def test_exams_sharing_a_site_only_get_their_own_dates():
    nursing, cet = follower("9700000304", "EX04"), follower("9700000305", "EX03")
    base = page("CET Cell application portal")
    check("EX03", base), check("EX04", base)
    fresh = page("CET Cell application portal", "MHT-CET PCM exam on 20 April 2027")
    assert check("EX04", fresh)["notified"] == 0 and check("EX03", fresh)["notified"] == 1
    assert alerts(nursing) == [] and len(alerts(cet)) == 1


def test_broad_department_site_ignores_unrelated_notices():
    fan = follower("9700000306", "EX02")
    check("EX02", page("DTE application portal"))
    assert check("EX02", page("DTE application portal", "Drone challenge application by 19 January 2027"))["notified"] == 0
    assert check("EX02", page("DTE application portal", "Polytechnic admission registration from 20 May 2027"))["notified"] == 1
    assert len(alerts(fan)) == 1


def test_failed_or_empty_first_read_is_not_a_baseline():
    fan = follower("9700000307", "EX06")

    def down(_):
        raise OSError("site down")

    assert watcher.check_exam(exam("EX06"), down, today=TODAY)["status"] == "error"
    assert check("EX06", '<html><body><div id="root"></div></body></html>')["status"] == "unreadable"
    assert check("EX06", page("NMMS exam on 20 December 2026"))["status"] == "baseline"
    assert alerts(fan) == []


def test_www_twin_address():
    assert watcher.other_www("https://www.mscepune.in") == "https://mscepune.in"
    assert watcher.other_www("https://mscepune.in/a") == "https://www.mscepune.in/a"
