"""Login: OTP flow, lockout, rate limit, roles and protected endpoints."""
import os
import tempfile

os.environ["RAAH_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ.pop("SMS_PROVIDER", None)

from fastapi.testclient import TestClient  # noqa: E402

from raah import auth  # noqa: E402
from raah.main import app  # noqa: E402

c = TestClient(app)
STUDENT, TEACHER = "9876543210", "9000000001"


def login(phone, role="student", name=None):
    r = c.post("/api/auth/otp/request", json={"phone": phone, "role": role})
    assert r.status_code == 200, r.text
    r = c.post("/api/auth/otp/verify", json={"phone": phone, "role": role, "code": auth.sandbox_code(), "name": name})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}, r.json()["user"]


def test_student_signup_and_me():
    h, user = login(STUDENT, name="Priya")
    assert user["role"] == "student" and user["phone"].endswith("3210") and "98765" not in user["phone"]
    assert c.get("/api/auth/me", headers=h).json()["name"] == "Priya"


def test_invalid_phone_rejected():
    assert c.post("/api/auth/otp/request", json={"phone": "12345", "role": "student"}).status_code == 422


def test_wrong_code_counts_down_then_locks():
    phone = "9123456780"
    c.post("/api/auth/otp/request", json={"phone": phone})
    for left in range(auth.OTP_MAX_ATTEMPTS - 1, -1, -1):
        r = c.post("/api/auth/otp/verify", json={"phone": phone, "code": "000000"})
        assert r.status_code == 400 and f"{left} attempts" in r.json()["detail"]
    r = c.post("/api/auth/otp/verify", json={"phone": phone, "code": auth.sandbox_code()})
    assert r.status_code == 429


def test_otp_is_single_use():
    phone = "9988776655"
    login(phone)
    r = c.post("/api/auth/otp/verify", json={"phone": phone, "code": auth.sandbox_code()})
    assert r.status_code == 400


def test_rate_limit():
    phone = "9811111111"
    for _ in range(auth.OTP_REQUESTS_PER_WINDOW):
        assert c.post("/api/auth/otp/request", json={"phone": phone}).status_code == 200
    assert c.post("/api/auth/otp/request", json={"phone": phone}).status_code == 429


def test_teacher_must_be_allowlisted():
    r = c.post("/api/auth/otp/request", json={"phone": "9822222222", "role": "teacher"})
    assert r.status_code == 403


def test_teacher_endpoints_need_teacher_role():
    assert c.get("/api/teacher/class").status_code == 401
    hs, _ = login("9833333333")
    assert c.get("/api/teacher/class", headers=hs).status_code == 403
    ht, _ = login(TEACHER, role="teacher")
    assert c.get("/api/teacher/class", headers=ht).status_code == 200


def test_money_payments_teacher_only_and_consent_owner_only():
    body = {"kind": "scholarship", "scheme_id": "SCH01", "payees": [{"name": "A", "account": "1", "ifsc": "SNDB0000001"}]}
    hs, _ = login("9844444444")
    assert c.post("/api/money/payments", json=body, headers=hs).status_code == 403
    ht, _ = login(TEACHER, role="teacher")
    assert c.post("/api/money/payments", json=body, headers=ht).status_code == 200
    cons = c.post("/api/money/aa/consent", json={"student_id": "x"}, headers=hs).json()
    other, _ = login("9855555555")
    assert c.get("/api/money/aa/fi-data", params={"consent_id": cons["consentId"]}, headers=other).status_code == 404
    assert c.get("/api/money/aa/fi-data", params={"consent_id": cons["consentId"]}, headers=hs).status_code == 200


def test_bad_token_rejected():
    assert c.get("/api/auth/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_sync_saves_profile_and_delete_removes_account():
    h, _ = login("9866666666")
    c.post("/api/sync", json=[{"kind": "profile", "payload": {"name": "Rohan", "class": 10}, "at": "2026-11-15T10:00:00Z"}], headers=h)
    assert c.get("/api/auth/profile", headers=h).json()["profile"]["name"] == "Rohan"
    assert c.delete("/api/auth/me", headers=h).json()["deleted"]
    assert c.get("/api/auth/me", headers=h).status_code == 401


def test_public_data_stays_open():
    assert c.get("/api/data").status_code == 200
