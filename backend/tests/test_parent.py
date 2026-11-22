"""Tests for the parent dashboard endpoints (family PIN + read-only view)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from raah.main import app

c = TestClient(app)
BASE_PHONE = "9000000040"
_counter = [0]


def _phone():
    _counter[0] += 1
    return str(int(BASE_PHONE) + _counter[0])


def _register(phone=None, name="Ravi", pin="7391"):
    if phone is None:
        phone = _phone()
    c.post("/api/auth/register", json={"name": name, "phone": phone, "pin": pin, "role": "student"})
    r = c.post("/api/auth/login", json={"phone": phone, "pin": pin, "role": "student"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"], phone


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ── set / remove family PIN ────────────────────────────────────────────────────

def test_set_family_pin():
    tok, _ = _register()
    r = c.post("/api/parent/set-pin", json={"family_pin": "5678"}, headers=_auth(tok))
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_set_family_pin_too_short():
    tok, _ = _register()
    r = c.post("/api/parent/set-pin", json={"family_pin": "12"}, headers=_auth(tok))
    assert r.status_code == 422


def test_remove_family_pin():
    tok, phone = _register()
    c.post("/api/parent/set-pin", json={"family_pin": "1234"}, headers=_auth(tok))
    r = c.delete("/api/parent/pin", headers=_auth(tok))
    assert r.status_code == 200
    # after removal, family_token should fail
    r2 = c.post("/api/parent/token", json={"phone": phone, "family_pin": "1234"})
    assert r2.status_code == 401


# ── family token ──────────────────────────────────────────────────────────────

def test_family_token_ok():
    tok, phone = _register(name="Priya")
    c.post("/api/parent/set-pin", json={"family_pin": "9999"}, headers=_auth(tok))
    r = c.post("/api/parent/token", json={"phone": phone, "family_pin": "9999"})
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data["student_name"] == "Priya"


def test_family_token_wrong_pin():
    tok, phone = _register()
    c.post("/api/parent/set-pin", json={"family_pin": "1234"}, headers=_auth(tok))
    r = c.post("/api/parent/token", json={"phone": phone, "family_pin": "0000"})
    assert r.status_code == 401


def test_family_token_no_pin_set():
    _, phone = _register()
    r = c.post("/api/parent/token", json={"phone": phone, "family_pin": "1234"})
    assert r.status_code == 401


# ── summary ───────────────────────────────────────────────────────────────────

def test_summary_ok():
    tok, phone = _register(name="Anjali")
    c.post("/api/parent/set-pin", json={"family_pin": "2468"}, headers=_auth(tok))
    fam = c.post("/api/parent/token", json={"phone": phone, "family_pin": "2468"}).json()
    r = c.get("/api/parent/summary", headers=_auth(fam["access_token"]))
    assert r.status_code == 200
    body = r.json()
    assert body["student_name"] == "Anjali"
    assert isinstance(body["watched_exams"], list)
    assert isinstance(body["notifications"], list)
    assert isinstance(body["lessons_done"], list)


def test_summary_requires_family_token():
    # a regular student JWT (aud="raah-app") must not work on /parent/summary
    tok, _ = _register()
    r = c.get("/api/parent/summary", headers=_auth(tok))
    assert r.status_code == 401


def test_summary_not_accessible_without_token():
    r = c.get("/api/parent/summary")
    assert r.status_code == 401
