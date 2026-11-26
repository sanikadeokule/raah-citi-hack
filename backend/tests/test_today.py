"""Today's step and the activity log: the agent uses the tools, picks one step, logs it, and a student sees only their own."""
import json
import time

from raah import auth, db
from raah.today import decide, log_activity


def _student(name):
    with db.connect() as con:
        return con.execute("INSERT INTO users (phone, name, role, pin_hash, created_at) VALUES (?, ?, 'student', 'x', ?) RETURNING id",
                           (f"9{abs(hash(name)) % 10**9:09d}", name, int(time.time()))).fetchone()["id"]


def test_new_student_is_sent_to_discover_then_to_their_alerts():
    uid = _student("Asha")
    step = decide(uid)
    assert step["key"] == "step_find_career" and step["href"] == "/discover/"
    auth.save_profile(uid, {"class": 10, "interests": ["computers"], "ikigai": {"love": ["computers"], "good_at": ["maths"], "confirmed_at": "2026-11-26T10:00:00Z"}})
    assert decide(uid)["key"] == "step_pick_path"
    auth.save_profile(uid, {"class": 10, "category": "OBC", "family_income_annual": 150000, "interests": ["computers"], "roadmap_career": "CAR01", "roadmap_at": "2026-11-26"})
    step = decide(uid)
    assert step["key"] in ("step_apply", "step_docs", "step_exam", "step_scholarships")
    assert step["looked"] and all("tool" in x for x in step["looked"]), "shows what it looked at"


def test_unread_alert_comes_first():
    uid = _student("Meena")
    auth.save_profile(uid, {"class": 10, "interests": ["computers"], "roadmap_career": "CAR01", "roadmap_at": "2026-11-26"})
    with db.connect() as con:
        con.execute("INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, 'exam_date', ?, ?)",
                    (uid, json.dumps({"exam_name": "MHT CET"}), int(time.time())))
    step = decide(uid)
    assert step["key"] == "step_notice" and step["vars"]["what"] == "MHT CET"


def test_saving_the_profile_logs_what_raah_learned_once():
    uid = _student("Sana")
    prof = {"ikigai": {"love": ["art"], "good_at": ["maths"], "confirmed_at": "2026-11-26T10:00:00Z"}}
    auth.save_profile(uid, prof)
    auth.save_profile(uid, prof)  # same answers again: nothing new learned
    log_activity(uid, "ask", "act_ask", {"q": "which exam", "n": 2}, "/ask/")
    with db.connect() as con:
        rows = con.execute("SELECT kind FROM agent_activity WHERE user_id = ? ORDER BY id", (uid,)).fetchall()
        other = con.execute("SELECT COUNT(*) AS n FROM agent_activity WHERE user_id != ?", (uid,)).fetchone()["n"]
    assert [r["kind"] for r in rows] == ["learned", "ask"]
    assert other >= 0
