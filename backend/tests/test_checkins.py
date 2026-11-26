"""Follow-up check-ins: asked once after the wait, shown as Today's step, and the answer moves the tracker card."""
from __future__ import annotations

import time

from fastapi.testclient import TestClient

from raah import auth, checkins, db
from raah.main import app
from raah.today import decide

c = TestClient(app)
_n = [0]
DAY = 86400


def _student():
    _n[0] += 1
    phone = str(9000000400 + _n[0])
    c.post("/api/auth/register", json={"name": "Check Test", "phone": phone, "pin": "7391", "role": "student"})
    r = c.post("/api/auth/login", json={"phone": phone, "pin": "7391", "role": "student"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["id"]


def _card(uid, title, column="researching", days_ago=5):
    t = int(time.time()) - days_ago * DAY
    with db.connect() as con:
        return con.execute("INSERT INTO applications (user_id, kind, title, \"column\", created_at, updated_at) "
                           "VALUES (?, 'scholarship', ?, ?, ?, ?) RETURNING id", (uid, title, column, t, t)).fetchone()["id"]


def _column(card_id):
    with db.connect() as con:
        return con.execute("SELECT \"column\" FROM applications WHERE id = ?", (card_id,)).fetchone()["column"]


def test_waits_then_asks_once():
    h, uid = _student()
    _card(uid, "Fresh card", days_ago=1)
    old = _card(uid, "NMMS", days_ago=5)
    assert checkins.run_once(uid, wait_days=3) == 1, "only the card older than the wait"
    assert checkins.run_once(uid, wait_days=3) == 0, "never the same question twice"
    due = c.get("/api/checkins", headers=h).json()
    assert [d["text_key"] for d in due] == ["ci_applied"]
    assert due[0]["vars"]["item"] == "NMMS" and due[0]["vars"]["card"] == old and due[0]["vars"]["days"] >= 5


def test_due_checkin_is_todays_step_and_yes_moves_the_card():
    h, uid = _student()
    auth.save_profile(uid, {"class": 10, "interests": ["computers"], "roadmap_career": "CAR01", "roadmap_at": "2026-11-26"})
    card = _card(uid, "Post-matric scholarship")
    checkins.run_once(uid, wait_days=3)
    step = decide(uid)
    assert step["key"] == "ci_applied" and step["href"] == "/tracker/"
    cid = step["vars"]["checkin"]

    r = c.post(f"/api/checkins/{cid}", json={"answer": "yes"}, headers=h).json()
    assert r == {"status": "done", "moved_to": "applied"}
    assert _column(card) == "applied"
    assert c.get("/api/checkins", headers=h).json() == []
    acts = c.get("/api/activity", headers=h).json()
    assert any(a["kind"] == "checkin" and a["text_key"] == "act_ci_applied" for a in acts), "logged on What Raah did for you"
    assert decide(uid)["key"] != "ci_applied"


def test_not_yet_asks_again_later():
    h, uid = _student()
    _card(uid, "Scholarship A")
    checkins.run_once(uid, wait_days=3)
    cid = c.get("/api/checkins", headers=h).json()[0]["id"]
    assert c.post(f"/api/checkins/{cid}", json={"answer": "later"}, headers=h).json()["status"] == "open"
    assert c.get("/api/checkins", headers=h).json() == [], "not due again until 3 days later"
    later = checkins.due(uid, now=int(time.time()) + 4 * DAY)
    assert [d["id"] for d in later] == [cid] and later[0]["asked"] == 1


def test_mentor_request_and_demo_refresh():
    h, uid = _student()
    with db.connect() as con:
        con.execute("INSERT INTO mentor_requests (user_id, mentor_id, shared, created_at) VALUES (?, 'MEN03', '{}', ?)", (uid, int(time.time())))
    assert c.post("/api/checkins/refresh", headers=h).json()["created"] == 0, "a request made just now is not asked about yet"
    r = c.post("/api/checkins/refresh?soon=1", headers=h).json()
    assert r["created"] == 1 and r["due"][0]["text_key"] == "ci_mentor" and r["due"][0]["vars"]["item"]


def test_yes_never_moves_a_card_back_and_others_cannot_answer():
    h, uid = _student()
    card = _card(uid, "Scholarship B")
    checkins.run_once(uid, wait_days=3)
    cid = c.get("/api/checkins", headers=h).json()[0]["id"]
    with db.connect() as con:
        con.execute("UPDATE applications SET \"column\" = 'waiting' WHERE id = ?", (card,))
    other, _ = _student()
    assert c.post(f"/api/checkins/{cid}", json={"answer": "yes"}, headers=other).status_code == 404
    assert c.post(f"/api/checkins/{cid}", json={"answer": "maybe"}, headers=h).status_code == 422
    assert c.post(f"/api/checkins/{cid}", json={"answer": "yes"}, headers=h).json()["moved_to"] is None
    assert _column(card) == "waiting"
