"""The shared student profile as MCP tools: agents can read what a student told Raah and add what they learn,
but never touch what decides eligibility, and never another student's profile."""
import os

os.environ["RAAH_MCP_TRANSPORT"] = "memory"

from fastapi.testclient import TestClient  # noqa: E402

from mcp_servers import data_server as ds  # noqa: E402
from raah import agent  # noqa: E402
from raah.main import app  # noqa: E402

c = TestClient(app)
PIN = "4826"


def login(phone, name):
    c.post("/api/auth/register", json={"phone": phone, "role": "student", "pin": PIN, "name": name})
    r = c.post("/api/auth/login", json={"phone": phone, "role": "student", "pin": PIN})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}, r.json()["user"]["id"]


def test_read_and_learn():
    h, uid = login("9710000001", "Asha")
    assert ds.get_student_profile(uid) == {"profile": None}  # nothing saved yet
    c.put("/api/auth/profile", json={"name": "Asha", "class": 10, "category": "OBC", "family_income_annual": 180000, "interests": ["art"]}, headers=h)
    got = ds.get_student_profile(uid)["profile"]
    assert got["class"] == 10 and got["interests"] == ["art"]

    out = ds.save_student_profile(uid, {"strengths": ["Talking to people", "talking to people"], "interests": ["helping people", "art"],
                                       "ikigai": {"love": ["art"], "good_at": ["maths"]}, "max_commute_km": 25, "can_stay_hostel": False})
    assert sorted(out["saved"]) == ["can_stay_hostel", "ikigai", "interests", "max_commute_km", "strengths"] and out["ignored"] == []
    got = ds.get_student_profile(uid)["profile"]
    assert got["strengths"] == ["talking to people"]  # tidied and de-duplicated
    assert got["interests"] == ["helping people", "art"] and got["ikigai"]["good_at"] == ["maths"]
    assert got["class"] == 10 and got["category"] == "OBC"  # what the student gave is kept


def test_eligibility_fields_and_junk_are_refused():
    h, uid = login("9710000002", "Bina")
    c.put("/api/auth/profile", json={"class": 10, "category": "OBC", "family_income_annual": 180000, "roadmap_career": "CAR01"}, headers=h)
    out = ds.save_student_profile(uid, {"category": "General", "family_income_annual": 1, "class": 12, "marks_pct": 99, "roadmap_career": "CAR02",
                                       "interests": "not a list", "max_commute_km": 5000, "can_stay_hostel": "yes", "ikigai": {"love": ["art"]}})
    assert out["saved"] == [] and len(out["ignored"]) == 9
    got = ds.get_student_profile(uid)["profile"]
    assert got["category"] == "OBC" and got["family_income_annual"] == 180000 and got["class"] == 10 and got["roadmap_career"] == "CAR01"


def test_agent_only_acts_on_the_signed_in_student():
    h, uid = login("9710000003", "Chitra")
    _, other = login("9710000004", "Dev")
    # the model cannot name another student: the server fills in the signed-in id
    agent.run_tool("save_student_profile", {"user_id": other, "learned": {"interests": ["farming"]}}, {}, uid)
    assert ds.get_student_profile(uid)["profile"]["interests"] == ["farming"]
    assert ds.get_student_profile(other) == {"profile": None}
    # signed out: refused, and the tools are not offered at all
    assert agent.run_tool("get_student_profile", {}, {}, None)["error"]
    names = {s["function"]["name"] for s in agent.tool_specs(signed_in=False)}
    assert not names & {"get_student_profile", "save_student_profile", "get_notifications"}
    signed = {s["function"]["name"]: s for s in agent.tool_specs(signed_in=True)}
    assert {"get_student_profile", "save_student_profile"} <= set(signed)
    assert "user_id" not in signed["save_student_profile"]["function"]["parameters"]["properties"]
