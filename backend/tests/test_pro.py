"""Raah Pro gate: off by default, turned on per account, always on for teachers."""
from fastapi.testclient import TestClient

from raah import db
from raah.main import app

c = TestClient(app)
PIN = "4826"


def login(phone, role="student"):
    c.post("/api/auth/register", json={"phone": phone, "role": role, "pin": PIN, "name": "Pro Test"})
    r = c.post("/api/auth/login", json={"phone": phone, "role": role, "pin": PIN})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}, r.json()["user"]


def test_pro_is_off_until_granted():
    h, user = login("9711000001")
    assert user["is_pro"] is False
    assert c.get("/api/auth/me", headers=h).json()["is_pro"] is False
    with db.connect() as con:
        con.execute("UPDATE users SET is_pro = 1 WHERE id = ?", (user["id"],))
    assert c.get("/api/auth/me", headers=h).json()["is_pro"] is True


def test_teachers_always_have_pro():
    h, user = login("9000000003", role="teacher")
    assert user["is_pro"] is True
