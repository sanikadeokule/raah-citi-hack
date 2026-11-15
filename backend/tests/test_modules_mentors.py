"""Mentor accept-to-reveal, teacher modules, enrolment, completion and earnings payout."""
import os
import tempfile

os.environ.setdefault("RAAH_DB", os.path.join(tempfile.mkdtemp(), "test.db"))
os.environ.pop("SMS_PROVIDER", None)

from fastapi.testclient import TestClient  # noqa: E402

from raah import auth, dataset  # noqa: E402
from raah.main import app  # noqa: E402

c = TestClient(app)


def login(phone, role="student", name=None):
    c.post("/api/auth/otp/request", json={"phone": phone, "role": role})
    r = c.post("/api/auth/otp/verify", json={"phone": phone, "role": role, "code": auth.sandbox_code(), "name": name})
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def test_mentor_phone_is_never_in_public_data_and_revealed_only_after_accepting():
    data = c.get("/api/data").json()
    assert "_private" not in data and data["mentors"] and "phone" not in data["mentors"][0]
    mid = data["mentors"][0]["id"]
    h = login("9600000001", name="Kavya Patil")
    c.put("/api/auth/profile", json={"name": "Kavya Patil", "class": 10, "taluka": "Junnar"}, headers=h)
    assert c.post(f"/api/mentors/{mid}/request", json={"accept_sharing": False}, headers=h).status_code == 400
    r = c.post(f"/api/mentors/{mid}/request", json={"accept_sharing": True}, headers=h).json()
    assert r["contact"]["phone"] == dataset.get()["_private"]["mentor_contacts"][mid]["phone"]
    assert r["shared_with_mentor"] == {"first_name": "Kavya", "class": 10, "taluka": "Junnar"}
    assert [m["mentor_id"] for m in c.get("/api/mentors/mine", headers=h).json()] == [mid]
    t = login("9000000002", role="teacher")
    assert c.get("/api/mentors/requests", headers=t).json()[0]["student"]["first_name"] == "Kavya"
    assert c.get("/api/mentors/requests", headers=h).status_code == 403


QUIZ = [{"q": "What is NAPS?", "options": ["Apprenticeship scheme", "Exam"], "answer": 0},
        {"q": "Who pays the stipend?", "options": ["Student", "Employer"], "answer": 1}]


def test_module_sale_completion_and_payout_use_spreadsheet_settings():
    a = dataset.get()["assumptions"]
    share, per = a["teacher_share_of_module_sales"]["value"], a["payout_per_completed_enrolment"]["value"]
    t = login("9000000002", role="teacher")
    bad = c.post("/api/modules", json={"title": "Paid", "lesson": "x" * 30, "quiz": QUIZ, "price_model": "per_module", "price": 0}, headers=t)
    assert bad.status_code == 422
    m = c.post("/api/modules", json={"title": "Apprenticeship basics", "lang": "mr", "lesson": "An apprentice learns at work and gets a stipend.",
                                     "quiz": QUIZ, "price_model": "per_module", "price": 50}, headers=t).json()
    s = login("9600000002", name="Ravi")
    listed = next(x for x in c.get("/api/modules", headers=s).json() if x["id"] == m["id"])
    assert "answer" not in listed["quiz"][0]
    assert c.post(f"/api/modules/{m['id']}/enrol", headers=t).status_code == 403
    assert c.post(f"/api/modules/{m['id']}/enrol", headers=s).json()["paid"] == 50
    assert c.post(f"/api/modules/{m['id']}/complete", json={"answers": [0, 0]}, headers=s).json()["score"] == 1

    e = c.get("/api/modules/earnings", headers=t).json()
    assert e["sales_share"] == round(50 * share, 2) and e["completion_payouts"] == per
    assert e["unpaid"] == round(50 * share + per, 2)
    pay = c.post("/api/modules/earnings/payout", json={}, headers=t).json()
    assert pay["amount_each"] == e["unpaid"] and "pain.001.001.09" in pay["xml"]
    assert c.get("/api/modules/earnings", headers=t).json()["unpaid"] == 0
    assert c.post("/api/modules/earnings/payout", json={}, headers=t).status_code == 400


def test_subscription_charges_once_per_teacher_per_month():
    t = login("9000000003", role="teacher")
    ids = [c.post("/api/modules", json={"title": f"Sub {i}", "lesson": "A lesson that is long enough.", "quiz": QUIZ,
                                        "price_model": "subscription", "price": 99}, headers=t).json()["id"] for i in range(2)]
    s = login("9600000003")
    assert c.post(f"/api/modules/{ids[0]}/enrol", headers=s).json()["paid"] == 99
    assert c.post(f"/api/modules/{ids[1]}/enrol", headers=s).json()["paid"] == 0
