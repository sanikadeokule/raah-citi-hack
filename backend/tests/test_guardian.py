"""Deadline guardian: alerts at 7/3/1/0 days, once each, for tracker cards and roadmap-matched notices."""
from __future__ import annotations

import json
import time
from datetime import date, timedelta

from fastapi.testclient import TestClient

from raah import db, guardian
from raah.main import app

c = TestClient(app)
_n = [0]
TODAY = date(2026, 3, 10)


def _student():
    _n[0] += 1
    phone = str(9000000200 + _n[0])
    c.post("/api/auth/register", json={"name": "Guard Test", "phone": phone, "pin": "7391", "role": "student"})
    r = c.post("/api/auth/login", json={"phone": phone, "pin": "7391", "role": "student"})
    return r.json()["access_token"], r.json()["user"]["id"]


def _card(uid, title, days):
    now = int(time.time())
    with db.connect() as con:
        con.execute("INSERT INTO applications (user_id, kind, title, \"column\", deadline, created_at, updated_at) "
                    "VALUES (?, 'scholarship', ?, 'applied', ?, ?, ?)",
                    (uid, title, (TODAY + timedelta(days=days)).isoformat(), now, now))


def _alerts(tok):
    r = c.get("/api/auth/notifications", headers={"Authorization": f"Bearer {tok}"})
    return [n for n in r.json() if n["kind"] == "deadline_alert"]


def test_bucket_for():
    assert [guardian.bucket_for(d) for d in (-1, 0, 1, 2, 3, 4, 7, 8)] == [None, 0, 1, 3, 3, 7, 7, None]


def test_card_alert_sent_once_per_bucket():
    tok, uid = _student()
    _card(uid, "Guard NSP", 6)
    guardian.run_once(TODAY)
    guardian.run_once(TODAY)  # a repeat run must not duplicate
    a = _alerts(tok)
    assert len(a) == 1 and a[0]["bucket"] == 7 and a[0]["source"] == "tracker"
    guardian.run_once(TODAY + timedelta(days=4))  # now 2 days to go -> the 3-day bucket
    assert sorted(x["bucket"] for x in _alerts(tok)) == [3, 7]


def test_far_and_past_deadlines_are_quiet():
    tok, uid = _student()
    _card(uid, "Far away", 30)
    _card(uid, "Already gone", -2)
    guardian.run_once(TODAY)
    assert _alerts(tok) == []


def test_result_column_is_not_alerted():
    tok, uid = _student()
    now = int(time.time())
    with db.connect() as con:
        con.execute("INSERT INTO applications (user_id, kind, title, \"column\", deadline, created_at, updated_at) "
                    "VALUES (?, 'college', 'Done', 'result', ?, ?, ?)", (uid, TODAY.isoformat(), now, now))
    guardian.run_once(TODAY)
    assert _alerts(tok) == []


def test_matched_notice_alert():
    tok, uid = _student()
    now = int(time.time())
    with db.connect() as con:
        con.execute("INSERT INTO notices (source, hash, title, url, deadline, first_seen, fresh) VALUES (?, ?, ?, ?, ?, ?, 1)",
                    ("test", f"guard-{uid}", "Form last date", "https://example.org/n", (TODAY + timedelta(days=2)).isoformat(), now))
        nid = con.execute("SELECT id FROM notices WHERE hash = ?", (f"guard-{uid}",)).fetchone()["id"]
        con.execute("INSERT INTO user_notices (user_id, notice_id, why, created_at) VALUES (?, ?, 'roadmap', ?)", (uid, nid, now))
    guardian.run_once(TODAY)
    a = _alerts(tok)
    assert len(a) == 1 and a[0]["source"] == "notice" and a[0]["days"] == 2
