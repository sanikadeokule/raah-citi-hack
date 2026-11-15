"""Phone + OTP login with JWT access tokens and two roles: student and teacher.

- Users, OTP challenges and saved profiles live in SQLite (RAAH_DB, default backend/data/raah.db).
- OTP codes are stored only as salted SHA-256 hashes, expire after OTP_TTL_SECONDS,
  allow OTP_MAX_ATTEMPTS tries and are rate limited per phone number.
- Without an SMS provider configured, the server runs in sandbox mode: the code is
  RAAH_SANDBOX_OTP and the response says so, which keeps the demo working offline.
- Students register themselves on first login. Teachers must be on RAAH_TEACHER_PHONES.
- Tokens are HS256 JWTs signed with RAAH_SIGNING_KEY and carry the user's role.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

router = APIRouter(prefix="/api/auth", tags=["auth"])

SIGNING_KEY = os.environ.get("RAAH_SIGNING_KEY", "dev-only-signing-key-change-me-in-env-file")
DB_PATH = Path(os.environ.get("RAAH_DB", Path(__file__).resolve().parents[1] / "data" / "raah.db"))
TOKEN_TTL_SECONDS = int(os.environ.get("RAAH_TOKEN_TTL_DAYS", "30")) * 86400
OTP_TTL_SECONDS = 300
OTP_MAX_ATTEMPTS = 5
OTP_REQUESTS_PER_WINDOW = 3
OTP_WINDOW_SECONDS = 600
ROLES = ("student", "teacher")
PHONE_RE = re.compile(r"^[6-9]\d{9}$")

_lock = threading.Lock()


def sandbox_mode() -> bool:
    return not os.environ.get("SMS_PROVIDER")


def sandbox_code() -> str:
    return os.environ.get("RAAH_SANDBOX_OTP", "123456")


def teacher_phones() -> set[str]:
    return {p.strip() for p in os.environ.get("RAAH_TEACHER_PHONES", "9000000001").split(",") if p.strip()}


# ------------------------------------------------------------------ storage

def _db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT NOT NULL,
            role TEXT NOT NULL,
            name TEXT,
            created_at INTEGER NOT NULL,
            UNIQUE (phone, role)
        );
        CREATE TABLE IF NOT EXISTS otps (
            phone TEXT NOT NULL,
            role TEXT NOT NULL,
            salt TEXT NOT NULL,
            code_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS profiles (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            client_at TEXT,
            received_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            read_at INTEGER
        );
    """)
    return con


def _hash(code: str, salt: str) -> str:
    return hashlib.sha256((salt + code).encode()).hexdigest()


def _send_sms(phone: str, code: str) -> None:
    """Hook for a real SMS gateway (MSG91, Twilio, AWS SNS...). Configure SMS_PROVIDER to enable."""
    raise HTTPException(501, f"SMS provider '{os.environ.get('SMS_PROVIDER')}' is not wired yet")


# ------------------------------------------------------------------ tokens

def issue_token(user: dict) -> str:
    now = int(time.time())
    return jwt.encode({"sub": str(user["id"]), "role": user["role"], "name": user.get("name"),
                       "iat": now, "exp": now + TOKEN_TTL_SECONDS, "aud": "raah-app"}, SIGNING_KEY, algorithm="HS256")


bearer = HTTPBearer(auto_error=False)


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if cred is None or cred.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "login required", headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = jwt.decode(cred.credentials, SIGNING_KEY, algorithms=["HS256"], audience="raah-app")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    with _lock:
        row = _db().execute("SELECT id, phone, role, name FROM users WHERE id = ?", (int(claims["sub"]),)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "account no longer exists")
    return dict(row)


def require_role(*roles: str):
    def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"needs role: {' or '.join(roles)}")
        return user
    return dep


teacher_only = require_role("teacher")


# ------------------------------------------------------------------ endpoints

class OtpRequest(BaseModel):
    phone: str
    role: str = "student"

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        v = re.sub(r"\D", "", v)[-10:]
        if not PHONE_RE.match(v):
            raise ValueError("enter a 10-digit Indian mobile number")
        return v

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        if v not in ROLES:
            raise ValueError("role must be student or teacher")
        return v


class OtpVerify(OtpRequest):
    code: str
    name: str | None = None


@router.post("/otp/request")
def request_otp(body: OtpRequest):
    if body.role == "teacher" and body.phone not in teacher_phones():
        raise HTTPException(403, "this number is not registered as a teacher")
    now = int(time.time())
    with _lock:
        con = _db()
        recent = con.execute("SELECT COUNT(*) FROM otps WHERE phone = ? AND created_at > ?",
                             (body.phone, now - OTP_WINDOW_SECONDS)).fetchone()[0]
        if recent >= OTP_REQUESTS_PER_WINDOW:
            raise HTTPException(429, "too many OTP requests, try again in a few minutes")
        code = sandbox_code() if sandbox_mode() else f"{secrets.randbelow(10**6):06d}"
        salt = secrets.token_hex(8)
        # older challenges stay (they count towards the rate limit) but only the newest can be used
        con.execute("UPDATE otps SET expires_at = 0 WHERE phone = ? AND role = ?", (body.phone, body.role))
        con.execute("INSERT INTO otps (phone, role, salt, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (body.phone, body.role, salt, _hash(code, salt), now + OTP_TTL_SECONDS, now))
        con.commit()
    if not sandbox_mode():
        _send_sms(body.phone, code)
    return {"sent": True, "expires_in": OTP_TTL_SECONDS, "sandbox": sandbox_mode(),
            "sandbox_hint": f"Sandbox OTP: {code}" if sandbox_mode() else None}


@router.post("/otp/verify")
def verify_otp(body: OtpVerify):
    now = int(time.time())
    with _lock:
        con = _db()
        row = con.execute("SELECT rowid, * FROM otps WHERE phone = ? AND role = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
                          (body.phone, body.role)).fetchone()
        if row is None or row["expires_at"] < now:
            raise HTTPException(400, "OTP expired, request a new one")
        if row["attempts"] >= OTP_MAX_ATTEMPTS:
            raise HTTPException(429, "too many wrong attempts, request a new OTP")
        if not hmac.compare_digest(row["code_hash"], _hash(body.code.strip(), row["salt"])):
            con.execute("UPDATE otps SET attempts = attempts + 1 WHERE rowid = ?", (row["rowid"],))
            con.commit()
            left = OTP_MAX_ATTEMPTS - row["attempts"] - 1
            raise HTTPException(400, f"wrong OTP, {left} attempts left")
        con.execute("UPDATE otps SET expires_at = 0 WHERE rowid = ?", (row["rowid"],))
        user = con.execute("SELECT id, phone, role, name FROM users WHERE phone = ? AND role = ?",
                           (body.phone, body.role)).fetchone()
        if user is None:
            con.execute("INSERT INTO users (phone, role, name, created_at) VALUES (?, ?, ?, ?)",
                        (body.phone, body.role, body.name, now))
            user = con.execute("SELECT id, phone, role, name FROM users WHERE phone = ? AND role = ?",
                               (body.phone, body.role)).fetchone()
        elif body.name and not user["name"]:
            con.execute("UPDATE users SET name = ? WHERE id = ?", (body.name, user["id"]))
            user = con.execute("SELECT id, phone, role, name FROM users WHERE id = ?", (user["id"],)).fetchone()
        con.commit()
    u = dict(user)
    return {"access_token": issue_token(u), "token_type": "bearer", "expires_in": TOKEN_TTL_SECONDS, "user": public(u)}


def public(u: dict) -> dict:
    return {"id": u["id"], "role": u["role"], "name": u.get("name"), "phone": "XXXXXX" + u["phone"][-4:]}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return public(user)


@router.get("/profile")
def get_profile(user: dict = Depends(current_user)):
    with _lock:
        row = _db().execute("SELECT data, updated_at FROM profiles WHERE user_id = ?", (user["id"],)).fetchone()
    return {"profile": json.loads(row["data"]) if row else None, "updated_at": row["updated_at"] if row else None}


@router.put("/profile")
def put_profile(profile: dict, user: dict = Depends(current_user)):
    save_profile(user["id"], profile)
    return {"saved": True}


def save_profile(user_id: int, profile: dict) -> None:
    with _lock:
        con = _db()
        con.execute("INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?) "
                    "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                    (user_id, json.dumps(profile, ensure_ascii=False), int(time.time())))
        con.commit()


def log_sync(user_id: int, items: list[dict]) -> None:
    now = int(time.time())
    with _lock:
        con = _db()
        con.executemany("INSERT INTO sync_log (user_id, kind, payload, client_at, received_at) VALUES (?, ?, ?, ?, ?)",
                        [(user_id, str(i.get("kind")), json.dumps(i.get("payload"), ensure_ascii=False), i.get("at"), now)
                         for i in items])
        con.commit()


# ------------------------------------------------------------------ students and notifications

def student_profiles() -> list[dict]:
    """Signed-up students who have saved a profile, for the teacher's eligibility checks."""
    with _lock:
        rows = _db().execute("SELECT u.id, u.name, p.data FROM users u JOIN profiles p ON p.user_id = u.id "
                             "WHERE u.role = 'student' ORDER BY u.id").fetchall()
    out = []
    for r in rows:
        prof = json.loads(r["data"])
        out.append({**prof, "user_id": r["id"], "name": prof.get("name") or r["name"] or f"Student {r['id']}"})
    return out


def notify(user_ids: list[int], kind: str, payload: dict, from_user_id: int | None = None) -> int:
    now = int(time.time())
    with _lock:
        con = _db()
        con.executemany("INSERT INTO notifications (user_id, from_user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                        [(u, from_user_id, kind, json.dumps(payload, ensure_ascii=False), now) for u in user_ids])
        con.commit()
    return len(user_ids)


@router.get("/notifications")
def my_notifications(user: dict = Depends(current_user)):
    with _lock:
        rows = _db().execute("SELECT n.id, n.kind, n.payload, n.created_at, n.read_at, f.name AS from_name FROM notifications n "
                             "LEFT JOIN users f ON f.id = n.from_user_id WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50",
                             (user["id"],)).fetchall()
    return [{"id": r["id"], "kind": r["kind"], **json.loads(r["payload"]), "from": r["from_name"],
             "created_at": r["created_at"], "read": r["read_at"] is not None} for r in rows]


@router.post("/notifications/{nid}/read")
def read_notification(nid: int, user: dict = Depends(current_user)):
    with _lock:
        con = _db()
        cur = con.execute("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL",
                          (int(time.time()), nid, user["id"]))
        con.commit()
    return {"updated": cur.rowcount}


@router.delete("/me")
def delete_me(user: dict = Depends(current_user)):
    """Delete-my-data: removes the account, saved profile and synced activity."""
    with _lock:
        con = _db()
        for t in ("sync_log", "profiles", "notifications"):
            con.execute(f"DELETE FROM {t} WHERE user_id = ?", (user["id"],))
        con.execute("DELETE FROM users WHERE id = ?", (user["id"],))
        con.commit()
    return {"deleted": True}
