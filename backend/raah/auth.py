"""Register and sign in with mobile number + PIN, or Google OAuth2.

Why a PIN and not a password: most of our students and parents type on a phone
keypad, often in Marathi or Hindi. A 4 to 6 digit PIN works the same in every
language, needs only the number pad, and is already familiar from ATM and UPI.
It is safe enough because every PIN is hashed with Argon2 and an account locks
for LOCK_MINUTES after MAX_FAILED_LOGINS wrong tries, so guessing is not practical.

- Accounts live in the database from db.py (Postgres via DATABASE_URL, SQLite file otherwise).
- Register: name + mobile + PIN (+ role). Teachers can register only from a number on RAAH_TEACHER_PHONES.
- Sign in: mobile + PIN (+ role) returns an HS256 JWT signed with RAAH_SIGNING_KEY.
- Google OAuth2: GET /api/auth/google → Google login page → GET /api/auth/google/callback → JWT.
  First Google login asks the user to pick a role (student/teacher); subsequent logins are instant.
  Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env.
- The token and /api/auth/me carry the registered name, so the app greets the real person.
"""
from __future__ import annotations

import json
import os
import re
import time

import httpx
import jwt
import secrets
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

from . import db

router = APIRouter(prefix="/api/auth", tags=["auth"])

SIGNING_KEY = os.environ.get("RAAH_SIGNING_KEY", "dev-only-signing-key-change-me-in-env-file")
TOKEN_TTL_SECONDS = int(os.environ.get("RAAH_TOKEN_TTL_DAYS", "30")) * 86400

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

# state → role mapping for Google OAuth (in-memory; fine for a single-process server)
_oauth_states: dict[str, str] = {}
MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15
ROLES = ("student", "teacher")
PHONE_RE = re.compile(r"^[6-9]\d{9}$")
PIN_RE = re.compile(r"^\d{4,6}$")

_hasher = PasswordHasher()
# verified against when the number is unknown, so a miss takes as long as a hit
_DUMMY_HASH = _hasher.hash("000000-not-a-real-pin")


def teacher_phones() -> set[str]:
    return {p.strip() for p in os.environ.get("RAAH_TEACHER_PHONES", "9000000001,9876543232").split(",") if p.strip()}


def weak_pin(pin: str) -> bool:
    """All the same digit (1111) or a straight run (1234, 9876): the first PINs anyone would try."""
    if len(set(pin)) == 1:
        return True
    steps = {int(b) - int(a) for a, b in zip(pin, pin[1:])}
    return steps in ({1}, {-1})


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
    with db.connect() as con:
        row = con.execute("SELECT id, phone, role, name FROM users WHERE id = ?", (int(claims["sub"]),)).fetchone()
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

def _clean_phone(v: str) -> str:
    v = re.sub(r"\D", "", v or "")[-10:]
    if not PHONE_RE.match(v):
        raise ValueError("enter a 10-digit Indian mobile number")
    return v


def _clean_role(v: str) -> str:
    if v not in ROLES:
        raise ValueError("role must be student or teacher")
    return v


def _clean_pin(v: str) -> str:
    v = (v or "").strip()
    if not PIN_RE.match(v):
        raise ValueError("PIN must be 4 to 6 digits")
    return v


class LoginIn(BaseModel):
    phone: str
    pin: str
    role: str = "student"

    _phone = field_validator("phone")(classmethod(lambda cls, v: _clean_phone(v)))
    _role = field_validator("role")(classmethod(lambda cls, v: _clean_role(v)))
    _pin = field_validator("pin")(classmethod(lambda cls, v: _clean_pin(v)))


class RegisterIn(LoginIn):
    name: str

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = re.sub(r"\s+", " ", v or "").strip()
        if len(v) < 2 or len(v) > 60:
            raise ValueError("enter your name (2 to 60 letters)")
        if re.search(r"[0-9<>{}\[\]\\/@#$%^*=+|~`_]", v):
            raise ValueError("a name can have letters, spaces, dots and hyphens only")
        return v

    @field_validator("pin")
    @classmethod
    def _strong_pin(cls, v: str) -> str:
        v = _clean_pin(v)
        if weak_pin(v):
            raise ValueError("this PIN is too easy to guess (like 1111 or 1234), choose another")
        return v


@router.post("/register", status_code=201)
def register(body: RegisterIn):
    if body.role == "teacher" and body.phone not in teacher_phones():
        raise HTTPException(403, "this number is not on the teacher list, ask the programme admin to add it")
    now = int(time.time())
    pin_hash = _hasher.hash(body.pin)
    with db.connect() as con:
        row = con.execute("SELECT id, pin_hash FROM users WHERE phone = ? AND role = ?", (body.phone, body.role)).fetchone()
        if row is not None and row["pin_hash"]:
            raise HTTPException(409, "this number is already registered, please sign in")
        if row is None:
            con.execute("INSERT INTO users (phone, role, name, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                        (body.phone, body.role, body.name, pin_hash, now))
        else:  # an account from the old OTP login with no PIN yet: let its owner set one
            con.execute("UPDATE users SET name = ?, pin_hash = ?, failed_logins = 0, locked_until = 0 WHERE id = ?",
                        (body.name, pin_hash, row["id"]))
        user = con.execute("SELECT id, phone, role, name FROM users WHERE phone = ? AND role = ?",
                           (body.phone, body.role)).fetchone()
    return {"registered": True, "user": public(dict(user))}


@router.post("/login")
def login(body: LoginIn):
    now = int(time.time())
    with db.connect() as con:
        row = con.execute("SELECT * FROM users WHERE phone = ? AND role = ?", (body.phone, body.role)).fetchone()
    if row is None or not row["pin_hash"]:
        try:
            _hasher.verify(_DUMMY_HASH, body.pin)
        except VerificationError:
            pass
        raise HTTPException(404, "this number is not registered yet, please register first")
    if row["locked_until"] > now:
        mins = max(1, (row["locked_until"] - now + 59) // 60)
        raise HTTPException(429, f"too many wrong PINs, try again in {mins} minutes")
    try:
        _hasher.verify(row["pin_hash"], body.pin)
    except (VerificationError, InvalidHashError):
        failed = row["failed_logins"] + 1
        with db.connect() as con:
            if failed >= MAX_FAILED_LOGINS:
                con.execute("UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?", (now + LOCK_MINUTES * 60, row["id"]))
            else:
                con.execute("UPDATE users SET failed_logins = ? WHERE id = ?", (failed, row["id"]))
        if failed >= MAX_FAILED_LOGINS:
            raise HTTPException(429, f"too many wrong PINs, try again in {LOCK_MINUTES} minutes")
        raise HTTPException(401, f"wrong PIN, {MAX_FAILED_LOGINS - failed} tries left")
    new_hash = _hasher.hash(body.pin) if _hasher.check_needs_rehash(row["pin_hash"]) else row["pin_hash"]
    with db.connect() as con:
        con.execute("UPDATE users SET failed_logins = 0, locked_until = 0, last_login_at = ?, pin_hash = ? WHERE id = ?",
                    (now, new_hash, row["id"]))
    u = {"id": row["id"], "phone": row["phone"], "role": row["role"], "name": row["name"]}
    return {"access_token": issue_token(u), "token_type": "bearer", "expires_in": TOKEN_TTL_SECONDS, "user": public(u)}


class ResetPinIn(BaseModel):
    phone: str
    _phone = field_validator("phone")(classmethod(lambda cls, v: _clean_phone(v)))


@router.post("/reset-pin")
def reset_pin(body: ResetPinIn, teacher: dict = Depends(require_role("teacher"))):
    """A student forgot their PIN: their teacher clears it, and the student registers again with the same
    number to set a new one. Their saved profile and progress stay."""
    with db.connect() as con:
        cur = con.execute("UPDATE users SET pin_hash = NULL, failed_logins = 0, locked_until = 0 "
                          "WHERE phone = ? AND role = 'student'", (body.phone,))
    if cur.rowcount == 0:
        raise HTTPException(404, "no student is registered with this number")
    return {"reset": True}


def public(u: dict) -> dict:
    return {"id": u["id"], "role": u["role"], "name": u.get("name"), "phone": "XXXXXX" + u["phone"][-4:]}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return public(user)


@router.get("/profile")
def get_profile(user: dict = Depends(current_user)):
    with db.connect() as con:
        row = con.execute("SELECT data, updated_at FROM profiles WHERE user_id = ?", (user["id"],)).fetchone()
    return {"profile": json.loads(row["data"]) if row else None, "updated_at": row["updated_at"] if row else None}


@router.put("/profile")
def put_profile(profile: dict, user: dict = Depends(current_user)):
    save_profile(user["id"], profile)
    return {"saved": True}


def save_profile(user_id: int, profile: dict) -> None:
    with db.connect() as con:
        con.execute("INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?) "
                    "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                    (user_id, json.dumps(profile, ensure_ascii=False), int(time.time())))


def log_sync(user_id: int, items: list[dict]) -> None:
    now = int(time.time())
    with db.connect() as con:
        con.executemany("INSERT INTO sync_log (user_id, kind, payload, client_at, received_at) VALUES (?, ?, ?, ?, ?)",
                        [(user_id, str(i.get("kind")), json.dumps(i.get("payload"), ensure_ascii=False), i.get("at"), now)
                         for i in items])


# ------------------------------------------------------------------ students and notifications

def student_profiles() -> list[dict]:
    """Signed-up students who have saved a profile, for the teacher's eligibility checks."""
    with db.connect() as con:
        rows = con.execute("SELECT u.id, u.name, p.data FROM users u JOIN profiles p ON p.user_id = u.id "
                             "WHERE u.role = 'student' ORDER BY u.id").fetchall()
    out = []
    for r in rows:
        prof = json.loads(r["data"])
        out.append({**prof, "user_id": r["id"], "name": prof.get("name") or r["name"] or f"Student {r['id']}"})
    return out


def notify(user_ids: list[int], kind: str, payload: dict, from_user_id: int | None = None) -> int:
    now = int(time.time())
    with db.connect() as con:
        con.executemany("INSERT INTO notifications (user_id, from_user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                        [(u, from_user_id, kind, json.dumps(payload, ensure_ascii=False), now) for u in user_ids])
    return len(user_ids)


@router.get("/notifications")
def my_notifications(user: dict = Depends(current_user)):
    with db.connect() as con:
        rows = con.execute("SELECT n.id, n.kind, n.payload, n.created_at, n.read_at, f.name AS from_name FROM notifications n "
                             "LEFT JOIN users f ON f.id = n.from_user_id WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50",
                             (user["id"],)).fetchall()
    return [{"id": r["id"], "kind": r["kind"], **json.loads(r["payload"]), "from": r["from_name"],
             "created_at": r["created_at"], "read": r["read_at"] is not None} for r in rows]


@router.post("/notifications/{nid}/read")
def read_notification(nid: int, user: dict = Depends(current_user)):
    with db.connect() as con:
        cur = con.execute("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL",
                          (int(time.time()), nid, user["id"]))
    return {"updated": cur.rowcount}


@router.delete("/me")
def delete_me(user: dict = Depends(current_user)):
    """Delete-my-data: removes the account, saved profile and synced activity."""
    with db.connect() as con:
        for t in ("sync_log", "profiles", "notifications", "mentor_requests", "enrolments"):
            con.execute(f"DELETE FROM {t} WHERE user_id = ?", (user["id"],))
        con.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    return {"deleted": True}


# ------------------------------------------------------------------ Google OAuth2

@router.get("/google")
def google_login(role: str = Query(default="student")):
    """Redirect the browser to Google's OAuth consent page.

    The frontend links to /api/auth/google?role=student (or teacher).
    After Google approves, it sends the browser to /api/auth/google/callback.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google sign-in is not configured on this server")
    if role not in ROLES:
        raise HTTPException(400, "role must be student or teacher")
    state = secrets.token_urlsafe(24)
    _oauth_states[state] = role
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{qs}")


@router.get("/google/callback")
def google_callback(code: str = Query(default=""), state: str = Query(default=""),
                    error: str = Query(default="")):
    """Google redirects here after the user signs in.

    Exchanges the code for an id_token, extracts the Google subject ID, name,
    and email, then upserts a user row and returns a JWT via a redirect to the
    frontend so the Next.js app can store it.
    """
    if error:
        return RedirectResponse(f"{FRONTEND_URL}/login?error={error}")
    role = _oauth_states.pop(state, None)
    if role is None:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=invalid_state")

    # Exchange code for tokens
    try:
        resp = httpx.post("https://oauth2.googleapis.com/token", data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        }, timeout=15)
        resp.raise_for_status()
        token_data = resp.json()
    except Exception as e:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=token_exchange_failed")

    # Decode the id_token (no signature check needed: we just fetched it from Google)
    id_token = token_data.get("id_token", "")
    try:
        # JWT is base64url; skip verify since we obtained it directly from Google
        claims = jwt.decode(id_token, options={"verify_signature": False})
    except Exception:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=bad_id_token")

    google_sub = claims.get("sub")
    name = (claims.get("name") or claims.get("email", "").split("@")[0] or "Student").strip()[:60]
    if not google_sub:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=missing_sub")

    now = int(time.time())
    with db.connect() as con:
        row = con.execute("SELECT id, role, name FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
        if row is None:
            # First Google login: create a new account with no phone/PIN
            con.execute(
                "INSERT INTO users (phone, role, name, google_sub, failed_logins, locked_until, created_at) "
                "VALUES (?, ?, ?, ?, 0, 0, ?)",
                ("", role, name, google_sub, now),
            )
            row = con.execute("SELECT id, role, name FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
        else:
            con.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now, row["id"]))

    u = {"id": row["id"], "phone": "", "role": row["role"], "name": row["name"]}
    token = issue_token(u)
    return RedirectResponse(f"{FRONTEND_URL}/login?token={token}&role={u['role']}")
