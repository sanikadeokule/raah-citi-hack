"""Register then sign in: PIN hashing, lockout, roles, real-name greeting and protected endpoints."""
import os


from fastapi.testclient import TestClient  # noqa: E402

from raah import auth, db  # noqa: E402
from raah.main import app  # noqa: E402

c = TestClient(app)
STUDENT, TEACHER = "9876543210", "9000000001"
PIN = "4826"


def register(phone, name="Test Student", role="student", pin=PIN):
    return c.post("/api/auth/register", json={"phone": phone, "name": name, "role": role, "pin": pin})


def login(phone, role="student", name="Test Student", pin=PIN):
    register(phone, name=name, role=role, pin=pin)
    r = c.post("/api/auth/login", json={"phone": phone, "role": role, "pin": pin})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}, r.json()["user"]


def test_register_then_sign_in_greets_by_registered_name():
    r = register(STUDENT, name="  Sanika   Deokule ")
    assert r.status_code == 201 and r.json()["user"]["name"] == "Sanika Deokule"
    assert "access_token" not in r.json()  # registering does not sign you in; the sign-in step does
    r = c.post("/api/auth/login", json={"phone": STUDENT, "pin": PIN})
    assert r.status_code == 200
    user = r.json()["user"]
    assert user["name"] == "Sanika Deokule" and user["role"] == "student"
    assert user["phone"].endswith("3210") and "98765" not in user["phone"]
    h = {"Authorization": "Bearer " + r.json()["access_token"]}
    assert c.get("/api/auth/me", headers=h).json()["name"] == "Sanika Deokule"


def test_pin_is_stored_hashed_not_plain():
    register("9123400001", pin="5739")
    with db.connect() as con:
        row = con.execute("SELECT pin_hash FROM users WHERE phone = ?", ("9123400001",)).fetchone()
    assert row["pin_hash"].startswith("$argon2") and "5739" not in row["pin_hash"]


def test_duplicate_registration_rejected():
    register("9123400002")
    r = register("9123400002", name="Someone Else")
    assert r.status_code == 409 and "sign in" in r.json()["detail"]


def test_unregistered_number_told_to_register():
    r = c.post("/api/auth/login", json={"phone": "9123400003", "pin": PIN})
    assert r.status_code == 404 and "register" in r.json()["detail"]


def test_input_validation():
    assert register("12345").status_code == 422                     # not a mobile number
    assert register("9123400004", name="A").status_code == 422      # name too short
    assert register("9123400004", name="R2D2").status_code == 422   # digits in name
    assert register("9123400004", pin="12").status_code == 422      # PIN too short
    assert register("9123400004", pin="abcd").status_code == 422    # PIN not digits
    for weak in ("1111", "1234", "9876", "000000"):
        assert register("9123400004", pin=weak).status_code == 422, weak
    assert register("9123400004", name="सानिका देवकुळे").status_code == 201  # Devanagari names work


def test_wrong_pin_counts_down_then_locks():
    phone = "9123400005"
    register(phone)
    for left in range(auth.MAX_FAILED_LOGINS - 1, 0, -1):
        r = c.post("/api/auth/login", json={"phone": phone, "pin": "9071"})
        assert r.status_code == 401 and f"{left} tries left" in r.json()["detail"]
    assert c.post("/api/auth/login", json={"phone": phone, "pin": "9071"}).status_code == 429
    # even the right PIN is refused while locked
    assert c.post("/api/auth/login", json={"phone": phone, "pin": PIN}).status_code == 429


def test_successful_login_resets_failed_count():
    phone = "9123400006"
    register(phone)
    for _ in range(auth.MAX_FAILED_LOGINS - 1):
        c.post("/api/auth/login", json={"phone": phone, "pin": "9071"})
    assert c.post("/api/auth/login", json={"phone": phone, "pin": PIN}).status_code == 200
    r = c.post("/api/auth/login", json={"phone": phone, "pin": "9071"})
    assert f"{auth.MAX_FAILED_LOGINS - 1} tries left" in r.json()["detail"]


def test_same_number_needs_its_own_registration_per_role():
    register(TEACHER, name="Meena Teacher", role="teacher")
    # registered as a teacher, not as a student
    assert c.post("/api/auth/login", json={"phone": TEACHER, "pin": PIN, "role": "student"}).status_code == 404


def test_teacher_must_be_allowlisted():
    r = register("9822222222", role="teacher")
    assert r.status_code == 403


def test_teacher_endpoints_need_teacher_role():
    assert c.get("/api/teacher/class").status_code == 401
    hs, _ = login("9833333333")
    assert c.get("/api/teacher/class", headers=hs).status_code == 403
    ht, user = login(TEACHER, role="teacher", name="Meena Teacher")
    assert user["role"] == "teacher"
    assert c.get("/api/teacher/class", headers=ht).status_code == 200


def test_money_payments_teacher_only_and_consent_owner_only():
    body = {"kind": "scholarship", "scheme_id": "SCH01", "payees": [{"name": "A", "account": "1", "ifsc": "SNDB0000001"}]}
    hs, _ = login("9844444444")
    assert c.post("/api/money/payments", json=body, headers=hs).status_code == 403
    ht, _ = login(TEACHER, role="teacher", name="Meena Teacher")
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
    # the number is free to register again
    assert register("9866666666").status_code == 201


def test_old_otp_account_can_set_a_pin():
    """Accounts made by the earlier OTP login have no PIN; registering sets one instead of failing."""
    with db.connect() as con:
        con.execute("INSERT INTO users (phone, role, name, created_at) VALUES (?, ?, ?, ?)", ("9877700000", "student", None, 0))
    assert register("9877700000", name="Old User").status_code == 201
    _, user = login("9877700000", name="Old User")
    assert user["name"] == "Old User"


def test_teacher_can_reset_a_forgotten_pin_and_profile_stays():
    hs, _ = login("9877711111", name="Forgetful Student")
    c.put("/api/auth/profile", json={"name": "Forgetful Student", "class": 9}, headers=hs)
    # students cannot reset PINs
    assert c.post("/api/auth/reset-pin", json={"phone": "9877711111"}, headers=hs).status_code == 403
    ht, _ = login(TEACHER, role="teacher", name="Meena Teacher")
    assert c.post("/api/auth/reset-pin", json={"phone": "9877799999"}, headers=ht).status_code == 404
    assert c.post("/api/auth/reset-pin", json={"phone": "9877711111"}, headers=ht).json()["reset"]
    assert c.post("/api/auth/login", json={"phone": "9877711111", "pin": PIN}).status_code == 404
    assert register("9877711111", name="Forgetful Student", pin="5091").status_code == 201
    h2, _ = login("9877711111", name="Forgetful Student", pin="5091")
    assert c.get("/api/auth/profile", headers=h2).json()["profile"]["class"] == 9


def test_public_data_stays_open():
    assert c.get("/api/data").status_code == 200
