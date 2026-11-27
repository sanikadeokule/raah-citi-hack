"""Interested students are notified when an exam's official page gains a new dated line."""
from fastapi.testclient import TestClient

from raah import dataset, watcher
from raah.main import app

c = TestClient(app)
PIN = "4826"


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
    assert watcher.check_exam(exam, lambda u: base)["status"] == "baseline"
    assert watcher.check_exam(exam, lambda u: base)["notified"] == 0

    fresh = page("Registration open", "Exam date: 10 January 2027", "Last date to apply: 28 February 2027")
    res = watcher.check_exam(exam, lambda u: fresh)
    assert res["status"] == "changed" and res["notified"] == 1

    inbox = c.get("/api/auth/notifications", headers=hi).json()
    assert inbox[0]["kind"] == "exam_update" and inbox[0]["exam_id"] == exam["id"] and "28 February 2027" in inbox[0]["body"]
    assert c.get("/api/auth/notifications", headers=hn).json() == []

    assert watcher.check_exam(exam, lambda u: fresh)["notified"] == 0  # nothing new the second time

    def down(u):
        raise RuntimeError("site down")
    assert watcher.check_exam(exam, down)["status"] == "error"

    assert c.delete(f"/api/watch/interests/exam/{exam['id']}", headers=hi).json()["watching"] is False


def test_only_teachers_can_trigger_a_run():
    assert c.post("/api/watch/run", headers=login("9700000023")).status_code == 403


def _run(exam, before, after):
    watcher.check_exam(exam, lambda u: before)
    return watcher.check_exam(exam, lambda u: after)


def _follow(phone, exam_id):
    h = login(phone)
    c.put(f"/api/watch/interests/exam/{exam_id}", headers=h)
    return h


def test_dates_in_and_upcoming():
    from datetime import date
    assert watcher.dates_in("Closes 05/03/2027 and 7 Apr 2027 or Jan 9, 2028") == [date(2027, 3, 5), date(2027, 4, 7), date(2028, 1, 9)]
    assert watcher.is_upcoming("Result declared on 1 June 2020", date(2026, 11, 18)) is False
    assert watcher.is_upcoming("Exam in May", date(2026, 11, 18)) is True


def test_past_dates_do_not_alert():
    exam = next(e for e in dataset.get()["exams"] if e["id"] == "EX05")
    h = _follow("9700000031", exam["id"])
    res = _run(exam, page("Registration open"), page("Registration open", "Result declared on 1 June 2020"))
    assert res["notified"] == 0
    assert c.get("/api/auth/notifications", headers=h).json() == []


def test_shared_site_only_alerts_the_named_exam():
    exams = {e["id"]: e for e in dataset.get()["exams"]}
    assert exams["EX03"]["site"] == exams["EX04"]["site"]
    hm = _follow("9700000032", "EX03")
    hn = _follow("9700000033", "EX04")
    base = page("Admissions notice")
    line = "Nursing CET registration last date 30 December 2030"
    assert _run(exams["EX03"], base, page("Admissions notice", line))["notified"] == 0
    assert _run(exams["EX04"], base, page("Admissions notice", line))["notified"] == 1
    assert c.get("/api/auth/notifications", headers=hm).json() == []
    assert len(c.get("/api/auth/notifications", headers=hn).json()) == 1


def test_unrelated_notice_on_own_site_does_not_alert():
    exam = next(e for e in dataset.get()["exams"] if e["id"] == "EX02")
    _follow("9700000034", exam["id"])
    res = _run(exam, page("Admissions"), page("Admissions", "Drone challenge application till 20 March 2030"))
    assert res["notified"] == 0


def test_changing_last_updated_line_is_ignored():
    got = watcher.page_lines(page("Last updated on 18 November 2026", "Registration open"))
    assert got == ["Registration open"]


def test_table_row_keeps_label_and_date_together():
    markup = "<table><tr><td>Last date to apply</td><td>28 February 2030</td></tr></table>"
    assert watcher.page_lines(markup) == ["Last date to apply 28 February 2030"]


def test_failed_first_read_is_not_a_baseline():
    exam = next(e for e in dataset.get()["exams"] if e["id"] == "EX06")
    _follow("9700000035", exam["id"])

    def down(u):
        raise RuntimeError("site down")
    assert watcher.check_exam(exam, down)["status"] == "error"
    res = watcher.check_exam(exam, lambda u: page("Registration last date 28 February 2030"))
    assert res["status"] == "baseline" and res["notified"] == 0


def test_the_exam_date_agent_writes_per_student_messages_and_drops_invented_dates(monkeypatch):
    import json
    from raah import llm
    exam = next(e for e in dataset.get()["exams"] if e.get("site"))
    ha, hb = login("9700000031"), login("9700000032")
    for h in (ha, hb):
        c.put(f"/api/watch/interests/exam/{exam['id']}", headers=h)
    base = page("Registration open")
    watcher.check_exam(exam, lambda u: base)
    answers = iter([{"urgent": True, "message": "Registration closes on 28 February 2027, apply soon."},
                    {"urgent": False, "message": "Registration closes on 5 March 2027."}])  # a date the site never published

    def fake_chat(messages, **kw):
        return json.dumps(next(answers)), "test"
    monkeypatch.setattr(llm, "chat", fake_chat)
    res = watcher.check_exam(exam, lambda u: page("Registration open", "Last date to apply: 28 February 2027"))
    assert res["notified"] == 2 and res["agent"]["mode"] == "model"
    assert any("dropped" in t and not t.startswith("verify: 2 kept, 0") for t in res["agent"]["trace"])
    bodies = {json.dumps(n["body"]) for h in (ha, hb) for n in c.get("/api/auth/notifications", headers=h).json()[:1]}
    assert any("apply soon" in b for b in bodies)
    assert not any("5 March" in b for b in bodies), "an invented date never reaches a student"


def test_exam_alert_graph_uses_saved_language_in_model_prompt(monkeypatch):
    import json
    from raah import db, llm, watch_graph

    h = login("9700000091")
    uid = c.get("/api/auth/me", headers=h).json()["id"]
    with db.connect() as con:
        con.execute("INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, 0)",
                    (uid, json.dumps({"language": "bn"})))
    prompts = []

    def fake_chat(messages, **kwargs):
        prompts.append(messages[-1]["content"])
        return json.dumps({"urgent": False, "message": "Registration is open."}), "test"

    monkeypatch.setattr(llm, "chat", fake_chat)
    monkeypatch.setattr(watch_graph, "notify", lambda *args: None)
    monkeypatch.setattr("raah.today.log_activity", lambda *args: None)
    out = watch_graph.run({"id": "EX01", "name": "Exam", "site": "https://example.org"},
                          ["Registration is open."], [uid])
    assert out["mode"] == "model"
    assert "in Bengali" in prompts[0]
