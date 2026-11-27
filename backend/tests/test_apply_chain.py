"""Application chain: review gate, parent consent, mock message, reminder, parent agree, and the activity log."""
from fastapi.testclient import TestClient

from raah import db
from raah.main import app

c = TestClient(app)
_n = [0]


def _student(age=16):
    _n[0] += 1
    phone = str(9100000100 + _n[0])
    c.post("/api/auth/register", json={"name": "Asha", "phone": phone, "pin": "4826", "role": "student"})
    tok = c.post("/api/auth/login", json={"phone": phone, "pin": "4826", "role": "student"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    profile = {"name": "Asha", "age": age, "class": 10, "gender": "female", "category": "OBC", "taluka": "Pune",
               "marks_pct": 80, "family_income_annual": 120000, "domicile": "Maharashtra", "school_type": "government"}
    uid = c.get("/api/auth/me", headers=h).json()["id"]
    import json, time
    with db.connect() as con:
        con.execute("INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?)", (uid, json.dumps(profile), int(time.time())))
    return h, uid


def _start(h):
    from raah import dataset, engine
    import json
    uid = c.get("/api/auth/me", headers=h).json()["id"]
    with db.connect() as con:
        prof = json.loads(con.execute("SELECT data FROM profiles WHERE user_id = ?", (uid,)).fetchone()["data"])
    sid = next(e["id"] for e in engine.eligibility(dataset.get(), prof) if e["status"] in ("eligible", "eligible_missing_docs"))
    r = c.post("/api/scholarship-applications", json={"scheme_id": sid}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _acts(uid):
    with db.connect() as con:
        return [r["text_key"] for r in con.execute("SELECT text_key FROM agent_activity WHERE user_id = ? ORDER BY id", (uid,)).fetchall()]


def test_review_blocks_until_details_are_complete():
    h, uid = _student()
    a = _start(h)
    with db.connect() as con:
        con.execute("UPDATE applications SET prefill = '{}' WHERE id = ?", (a["id"],))
    r = c.post(f"/api/scholarship-applications/{a['id']}/approve", headers=h)
    assert r.status_code == 422 and "name" in r.json()["detail"]["missing"]


def test_minor_needs_parent_before_submitting_and_parent_can_agree():
    h, uid = _student(age=16)
    a = _start(h)
    base = f"/api/scholarship-applications/{a['id']}"
    assert c.patch(base, json={"stage": "applied"}, headers=h).status_code == 409  # not approved yet
    assert c.post(f"{base}/approve", headers=h).status_code == 200
    assert c.post(f"{base}/ask-parent", json={"message": "May I apply for this?"}, headers=h).status_code == 409  # no family PIN
    c.post("/api/parent/set-pin", json={"family_pin": "5678"}, headers=h)
    r = c.post(f"{base}/ask-parent", json={"message": "May I apply for this?"}, headers=h)
    assert r.status_code == 200 and r.json()["delivery"] == "mock" and r.json()["parent_sent_at"]
    assert c.patch(base, json={"stage": "applied"}, headers=h).status_code == 409  # parent has not agreed
    phone = str(9100000100 + _n[0])
    ptok = c.post("/api/parent/token", json={"phone": phone, "family_pin": "5678"}).json()["access_token"]
    ph = {"Authorization": f"Bearer {ptok}"}
    assert c.post(f"/api/parent/applications/{a['id']}/agree", headers=ph).status_code == 200
    r = c.patch(base, json={"stage": "applied"}, headers=h)
    assert r.status_code == 200 and r.json()["submitted_at"] and r.json()["parent_agreed_at"]
    assert _acts(uid) == ["act_approved", "act_asked_parent", "act_parent_agreed", "act_submitted"]


def test_adult_needs_no_parent_and_reminder_is_set():
    h, uid = _student(age=19)
    a = _start(h)
    base = f"/api/scholarship-applications/{a['id']}"
    c.post(f"{base}/approve", headers=h)
    assert c.patch(base, json={"stage": "applied"}, headers=h).status_code == 200
    r = c.post(f"{base}/remind", headers=h)
    assert r.status_code == 200 and r.json()["remind_at"] > r.json()["updated_at"] - 1
    assert "act_remind" in _acts(uid)


def test_parent_plan_card_shows_monthly_total_scholarship_payback():
    import json, time
    h, uid = _student()
    with db.connect() as con:
        prof = json.loads(con.execute("SELECT data FROM profiles WHERE user_id = ?", (uid,)).fetchone()["data"])
        prof["roadmap_career"] = "CAR25"
        con.execute("UPDATE profiles SET data = ? WHERE user_id = ?", (json.dumps(prof), uid))
    c.post("/api/parent/set-pin", json={"family_pin": "5678"}, headers=h)
    ptok = c.post("/api/parent/token", json={"phone": str(9100000100 + _n[0]), "family_pin": "5678"}).json()["access_token"]
    card = c.get("/api/parent/plan-card", headers={"Authorization": f"Bearer {ptok}"}).json()["plan"]
    assert card["per_month"] > 0 and card["total"] >= card["net"] and "payback_months" in card
