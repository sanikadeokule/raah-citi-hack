"""Tests for the application tracker endpoints (Kanban board)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from raah import db
from raah.main import app

c = TestClient(app)
_counter = [0]


def _phone():
    _counter[0] += 1
    return str(9000000050 + _counter[0])


def _register(phone=None, name="Tracker Test", pin="7391", set_pro=False):
    if phone is None:
        phone = _phone()
    c.post("/api/auth/register", json={"name": name, "phone": phone, "pin": pin, "role": "student"})
    r = c.post("/api/auth/login", json={"phone": phone, "pin": pin, "role": "student"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    uid = r.json()["user"]["id"]
    if set_pro:
        with db.connect() as con:
            con.execute("UPDATE users SET is_pro = 1 WHERE id = ?", (uid,))
    return tok


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ── Pro gate ──────────────────────────────────────────────────────────────────

def test_requires_pro():
    tok = _register()
    r = c.get("/api/tracker", headers=_auth(tok))
    assert r.status_code == 403


# ── CRUD ──────────────────────────────────────────────────────────────────────

def test_add_and_list():
    tok = _register(set_pro=True)
    r = c.post("/api/tracker", json={"kind": "scholarship", "title": "NSP", "ref_id": "nsp-01"},
               headers=_auth(tok))
    assert r.status_code == 201
    card = r.json()
    assert card["title"] == "NSP"
    assert card["column"] == "researching"

    r2 = c.get("/api/tracker", headers=_auth(tok))
    assert any(c2["ref_id"] == "nsp-01" for c2 in r2.json())


def test_duplicate_ref_id_returns_existing():
    tok = _register(set_pro=True)
    r1 = c.post("/api/tracker", json={"kind": "scholarship", "title": "NSP", "ref_id": "nsp-dup"},
                headers=_auth(tok))
    r2 = c.post("/api/tracker", json={"kind": "scholarship", "title": "NSP again", "ref_id": "nsp-dup"},
                headers=_auth(tok))
    assert r1.json()["id"] == r2.json()["id"]


def test_move_column():
    tok = _register(set_pro=True)
    card = c.post("/api/tracker", json={"kind": "college", "title": "IIT Delhi"},
                  headers=_auth(tok)).json()
    r = c.patch(f"/api/tracker/{card['id']}", json={"column": "applied"}, headers=_auth(tok))
    assert r.status_code == 200
    assert r.json()["column"] == "applied"


def test_invalid_column_rejected():
    tok = _register(set_pro=True)
    card = c.post("/api/tracker", json={"kind": "college", "title": "Some College"},
                  headers=_auth(tok)).json()
    r = c.patch(f"/api/tracker/{card['id']}", json={"column": "not_a_column"}, headers=_auth(tok))
    assert r.status_code == 422


def test_update_notes_and_deadline():
    tok = _register(set_pro=True)
    card = c.post("/api/tracker", json={"kind": "scholarship", "title": "Merit Award"},
                  headers=_auth(tok)).json()
    r = c.patch(f"/api/tracker/{card['id']}", json={"notes": "Need 2 ref letters", "deadline": "2026-02-01"},
                headers=_auth(tok))
    assert r.status_code == 200
    j = r.json()
    assert j["notes"] == "Need 2 ref letters"
    assert j["deadline"] == "2026-02-01"


def test_delete_card():
    tok = _register(set_pro=True)
    card = c.post("/api/tracker", json={"kind": "college", "title": "Delete me"},
                  headers=_auth(tok)).json()
    r = c.delete(f"/api/tracker/{card['id']}", headers=_auth(tok))
    assert r.status_code == 200
    cards = c.get("/api/tracker", headers=_auth(tok)).json()
    assert not any(c2["id"] == card["id"] for c2 in cards)


def test_cannot_edit_another_students_card():
    tok1 = _register(set_pro=True)
    tok2 = _register(set_pro=True)
    card = c.post("/api/tracker", json={"kind": "scholarship", "title": "My card"},
                  headers=_auth(tok1)).json()
    r = c.patch(f"/api/tracker/{card['id']}", json={"column": "applied"}, headers=_auth(tok2))
    assert r.status_code == 404
