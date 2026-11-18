"""Interested students are notified when an exam's official page gains a new dated line."""
from datetime import date

from fastapi.testclient import TestClient

from raah import dataset, watcher
from raah.main import app

c = TestClient(app)
PIN = "4826"
TODAY = date(2026, 11, 18)


def login(phone, role="student"):
    c.post("/api/auth/register", json={"phone": phone, "role": role, "pin": PIN, "name": "Watcher Test"})
    r = c.post("/api/auth/login", json={"phone": phone, "role": role, "pin": PIN})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def page(*lines):
    return "<html><body><script>var x = '1 Jan 2020';</script>" + "".join(f"<p>{ln}</p>" for ln in lines) + "</body></html>"


def test_page_lines_keep_only_date_and_process_lines():
    got = watcher.page_lines(page("Welcome to the portal", "Last date to apply: 15 March 2027", "Visitors: 52,001", "Admit card released"))
    assert got == ["Last date to apply: 15 March 2027", "Admit card released"]


def test_new_dated_line_notifies_only_interested_students():
    exam = next(e for e in dataset.get()["exams"] if e.get("site"))
    hi, hn = login("9700000021"), login("9700000022")
    assert c.put(f"/api/watch/interests/exam/{exam['id']}", headers=hi).json()["watching"] is True
    assert c.put(f"/api/watch/interests/exam/{exam['id']}", headers=hi).status_code == 200  # idempotent
    assert c.get("/api/watch/interests", headers=hi).json() == [{"kind": "exam", "ref_id": exam["id"]}]
    assert c.put("/api/watch/interests/exam/NOPE", headers=hi).status_code == 404

    base = page("Registration open", "Exam date: 10 January 2027")
    assert watcher.check_exam(exam, lambda u: base, today=TODAY)["status"] == "baseline"
    assert watcher.check_exam(exam, lambda u: base, today=TODAY)["notified"] == 0

    fresh = page("Registration open", "Exam date: 10 January 2027", "Last date to apply: 28 February 2027")
    res = watcher.check_exam(exam, lambda u: fresh, today=TODAY)
    assert res["status"] == "changed" and res["notified"] == 1

    inbox = c.get("/api/auth/notifications", headers=hi).json()
    assert inbox[0]["kind"] == "exam_update" and inbox[0]["exam_id"] == exam["id"] and "28 February 2027" in inbox[0]["body"]
    assert c.get("/api/auth/notifications", headers=hn).json() == []

    assert watcher.check_exam(exam, lambda u: fresh, today=TODAY)["notified"] == 0  # nothing new the second time

    def down(u):
        raise RuntimeError("site down")
    assert watcher.check_exam(exam, down)["status"] == "error"

    assert c.delete(f"/api/watch/interests/exam/{exam['id']}", headers=hi).json()["watching"] is False


def test_only_teachers_can_trigger_a_run():
    assert c.post("/api/watch/run", headers=login("9700000023")).status_code == 403
