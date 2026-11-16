"""Teacher recommendations reach signed-up students in their app."""
import os


from fastapi.testclient import TestClient  # noqa: E402

from raah import dataset, engine  # noqa: E402
from raah.main import app  # noqa: E402

c = TestClient(app)


PIN = "4826"


def login(phone, role="student", name=None):
    c.post("/api/auth/register", json={"phone": phone, "role": role, "pin": PIN, "name": name or "Test Student"})
    r = c.post("/api/auth/login", json={"phone": phone, "role": role, "pin": PIN})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}, r.json()["user"]


def test_recommendation_reaches_eligible_student_only():
    d = dataset.get()
    profile = dict(d["students"][0])
    scheme = next(s for s in d["scholarships"] if s["rules"] and engine.check_scheme(s, profile)["status"] in ("eligible", "eligible_missing_docs"))

    hs, student = login("9700000011", name="Kavya")
    assert c.put("/api/auth/profile", json=profile, headers=hs).status_code == 200
    ho, _ = login("9700000012", name="Other")  # signed up but no saved profile: not in the class

    ht, _ = login("9000000001", role="teacher")
    e = c.get(f"/api/teacher/eligible/{scheme['id']}", params={"plan_id": ""}, headers=ht).json()
    mine = [s for s in e["students"] if s["real"]]
    assert [s["user_id"] for s in mine] == [student["id"]]

    r = c.post("/api/teacher/recommend", json={"scheme_id": scheme["id"], "plan_id": None}, headers=ht).json()
    assert r["sent_to_app"] == 1 and r["sent"] >= 1

    inbox = c.get("/api/auth/notifications", headers=hs).json()
    assert inbox[0]["scheme_id"] == scheme["id"] and inbox[0]["scheme_name"] == scheme["name"]
    assert inbox[0]["read"] is False and "from" in inbox[0]
    assert c.get("/api/auth/notifications", headers=ho).json() == []

    assert c.post(f"/api/auth/notifications/{inbox[0]['id']}/read", headers=ho).json()["updated"] == 0
    assert c.post(f"/api/auth/notifications/{inbox[0]['id']}/read", headers=hs).json()["updated"] == 1
    assert c.get("/api/auth/notifications", headers=hs).json()[0]["read"] is True


def test_students_cannot_recommend():
    hs, _ = login("9700000013")
    assert c.post("/api/teacher/recommend", json={"scheme_id": "SCH01"}, headers=hs).status_code == 403
