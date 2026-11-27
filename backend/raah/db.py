"""Database: PostgreSQL.

Set DATABASE_URL (backend/.env), e.g.
    DATABASE_URL=postgresql://raah:raah@localhost:5432/raah
`scripts/setup_postgres.ps1` (Windows) or `scripts/setup_postgres.sh` (Mac/Linux), or
`docker compose up -d db` from the repository root, creates exactly that database.

The schema is defined once below with SQLAlchemy and created on startup
(init_db). init_db also adds columns that are newer than an existing table, so
the database keeps working after an upgrade.

Queries elsewhere use plain SQL with "?" placeholders through `connect()`.
The automated tests may point DATABASE_URL at a throwaway SQLite file, so the
SQL is kept portable, but the app itself refuses to start without Postgres.
"""
from __future__ import annotations

import os
import re
import threading
from contextlib import contextmanager
from typing import Any, Iterator

# Windows Application Control / Smart App Control can block SQLAlchemy's compiled (Cython) helpers
# with "DLL load failed ... An Application Control policy has blocked this file". SQLAlchemy 2.0
# (pinned <2.1 in requirements.txt; 2.1 has no pure-Python fallback) skips them when this is set.
# The pure-Python path is a little slower and makes no difference at Raah's scale.
os.environ.setdefault("DISABLE_SQLALCHEMY_CEXT_RUNTIME", "1")

from sqlalchemy import (Column, Float, ForeignKey, Integer, MetaData, String, Table, Text, UniqueConstraint,
                        create_engine, event, inspect, text)
from sqlalchemy.engine import Connection, CursorResult, Engine

metadata = MetaData()

users = Table(
    "users", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("phone", String(10), nullable=False),
    Column("role", String(16), nullable=False),
    Column("name", String(80)),
    Column("pin_hash", Text),
    Column("failed_logins", Integer, nullable=False, server_default="0"),
    Column("locked_until", Integer, nullable=False, server_default="0"),
    Column("last_login_at", Integer),
    Column("created_at", Integer, nullable=False),
    Column("google_sub", Text),
    # Raah Pro: unlocks the financial aid calculator, parent dashboard and application tracker.
    # There is no payment flow yet; set it with backend/scripts/set_pro.py.
    Column("is_pro", Integer, nullable=False, server_default="0"),
    # Family PIN: a separate 4–8 digit code the student sets so a parent can view their dashboard.
    Column("family_pin_hash", Text),
    UniqueConstraint("phone", "role", name="uq_users_phone_role"),
    UniqueConstraint("google_sub", name="uq_users_google_sub"),
)

profiles = Table(
    "profiles", metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, autoincrement=False),
    Column("data", Text, nullable=False),
    Column("updated_at", Integer, nullable=False),
)

sync_log = Table(
    "sync_log", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("kind", Text, nullable=False),
    Column("payload", Text, nullable=False),
    Column("client_at", Text),
    Column("received_at", Integer, nullable=False),
)

notifications = Table(
    "notifications", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("from_user_id", Integer, ForeignKey("users.id", ondelete="SET NULL")),
    Column("kind", Text, nullable=False),
    Column("payload", Text, nullable=False),
    Column("created_at", Integer, nullable=False),
    Column("read_at", Integer),
)

applications = Table(
    "applications", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("kind", Text, nullable=False),   # "college" | "scholarship"
    Column("ref_id", Text),                 # dataset id when seeded from the roadmap
    Column("title", Text, nullable=False),
    Column("column", Text, nullable=False, server_default="'researching'"),  # kanban column
    Column("notes", Text, server_default="''"),
    Column("deadline", Text),               # ISO date string or null
    Column("checklist", Text, nullable=False, server_default="'[]'"),
    Column("prefill", Text, nullable=False, server_default="'{}'"),
    Column("parent_message", Text),
    Column("parent_message_approved_at", Integer),
    Column("student_approved_at", Integer),   # student's own yes on the review screen
    Column("parent_sent_at", Integer),        # when the (mock) message to the parent was logged
    Column("parent_agreed_at", Integer),      # parent said yes in Parent mode
    Column("submitted_at", Integer),          # student says they submitted on the official portal
    Column("remind_at", Integer),             # Raah will check the missing documents again then
    Column("created_at", Integer, nullable=False),
    Column("updated_at", Integer, nullable=False),
)

interests = Table(
    "interests", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("kind", Text, nullable=False),
    Column("ref_id", Text, nullable=False),
    Column("created_at", Integer, nullable=False),
    UniqueConstraint("user_id", "kind", "ref_id", name="uq_interests_user_kind_ref"),
)

source_watch = Table(
    "source_watch", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("kind", Text, nullable=False),
    Column("ref_id", Text, nullable=False),
    Column("url", Text, nullable=False),
    Column("lines", Text, nullable=False, server_default="[]"),
    Column("status", Text),
    Column("last_checked", Integer),
    Column("last_changed", Integer),
    UniqueConstraint("kind", "ref_id", name="uq_source_watch_kind_ref"),
)

mentor_requests = Table(
    "mentor_requests", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("mentor_id", Text, nullable=False),
    Column("shared", Text, nullable=False),
    Column("created_at", Integer, nullable=False),
    UniqueConstraint("user_id", "mentor_id", name="uq_mentor_requests_user_mentor"),
)

modules = Table(
    "modules", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("teacher_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("title", Text, nullable=False),
    Column("lang", Text, nullable=False),
    Column("lesson", Text, nullable=False),
    Column("quiz", Text, nullable=False),
    Column("price_model", Text, nullable=False),
    Column("price", Float, nullable=False),
    Column("published", Integer, nullable=False, server_default="1"),
    Column("created_at", Integer, nullable=False),
)

enrolments = Table(
    "enrolments", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("module_id", Integer, ForeignKey("modules.id", ondelete="CASCADE"), nullable=False),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("paid", Float, nullable=False),
    Column("teacher_share", Float, nullable=False),
    Column("score", Integer),
    Column("completed_at", Integer),
    Column("completion_payout", Float, nullable=False, server_default="0"),
    Column("payout_id", Text),
    # Existing enrollments were only simulated; preserve access but never count them as captured revenue.
    Column("payment_status", String(24), nullable=False, server_default="'legacy_sandbox'"),
    Column("razorpay_order_id", String(80), unique=True),
    Column("razorpay_payment_id", String(80), unique=True),
    Column("created_at", Integer, nullable=False),
    UniqueConstraint("module_id", "user_id", name="uq_enrolments_module_user"),
)

module_payouts = Table(
    "module_payouts", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("teacher_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("reference", Text, nullable=False, unique=True),
    Column("amount", Float, nullable=False),
    Column("status", String(24), nullable=False),
    Column("provider", String(40), nullable=False),
    Column("created_at", Integer, nullable=False),
    Column("details", Text, nullable=False, server_default="{}"),
)

payment_webhook_events = Table(
    "payment_webhook_events", metadata,
    Column("event_id", String(100), primary_key=True),
    Column("event", String(80), nullable=False),
    Column("received_at", Integer, nullable=False),
)


agent_runs = Table(
    "agent_runs", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="SET NULL")),
    Column("question", Text, nullable=False),
    Column("mode", String(16), nullable=False),
    Column("provider", String(32)),
    Column("steps", Text, nullable=False, server_default="[]"),
    Column("answer", Text),
    Column("grounded", Integer),
    Column("ms", Integer),
    Column("created_at", Integer, nullable=False),
)


# what Raah did for a student, shown on "What Raah did for you": one row per action, text kept as a key + values so the
# page can show it in the student's language
agent_activity = Table(
    "agent_activity", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("kind", String(24), nullable=False),
    Column("text_key", String(48), nullable=False),
    Column("vars", Text, nullable=False, server_default="{}"),
    Column("href", String(120)),
    Column("source", Text),
    Column("created_at", Integer, nullable=False),
)


# follow-up check-ins (raah/checkins.py): "Did you apply for X?" a few days after something happened.
# key is stable per student ("card:12:applied", "mentor:MEN03"), so the same question is never created twice.
checkins = Table(
    "checkins", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("key", String(80), nullable=False),
    Column("text_key", String(48), nullable=False),
    Column("vars", Text, nullable=False, server_default="{}"),
    Column("href", String(120)),
    Column("status", String(8), nullable=False, server_default="open"),  # open | done
    Column("due_at", Integer, nullable=False),
    Column("asked", Integer, nullable=False, server_default="0"),  # times "Not yet" was answered
    Column("answered_at", Integer),
    Column("created_at", Integer, nullable=False),
    UniqueConstraint("user_id", "key", name="uq_checkins_user_key"),
)


# notices read from official sites (NTA, CET Cell, MahaDBT ...) by raah/notices.py. The title, link and
# published date are kept exactly as the site shows them; exams/schemes/dates are worked out from that text.
notices = Table(
    "notices", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("source", String(32), nullable=False),
    Column("hash", String(64), nullable=False, unique=True),
    Column("title", Text, nullable=False),
    Column("url", Text, nullable=False),
    Column("published", String(10)),  # YYYY-MM-DD, or YYYY-MM when only the upload month is known
    Column("category", String(24)),
    Column("exams", Text, nullable=False, server_default="[]"),
    Column("schemes", Text, nullable=False, server_default="[]"),
    Column("dates", Text, nullable=False, server_default="[]"),
    Column("deadline", String(10)),
    Column("summary", Text),  # {"en": ..., "hi": ..., "mr": ...} one-line translations of the title, when an AI was available
    Column("fresh", Integer, nullable=False, server_default="0"),  # 1 = new enough to send to students
    Column("first_seen", Integer, nullable=False),
    Column("verified_at", Integer),
    Column("verified_by", Integer, ForeignKey("users.id", ondelete="SET NULL")),
    Column("hidden", Integer, nullable=False, server_default="0"),
)

# which student was sent which notice, and why ("your roadmap needs MHT-CET"); also stops repeats
user_notices = Table(
    "user_notices", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("notice_id", Integer, ForeignKey("notices.id", ondelete="CASCADE"), nullable=False),
    Column("why", String(16), nullable=False),
    Column("ref", Text),
    Column("created_at", Integer, nullable=False),
    UniqueConstraint("user_id", "notice_id", name="uq_user_notices_user_notice"),
)


class DatabaseNotConfigured(RuntimeError):
    pass


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise DatabaseNotConfigured(
            "DATABASE_URL is not set. Raah stores accounts in PostgreSQL: run scripts/setup_postgres.ps1 (Windows) "
            "or scripts/setup_postgres.sh (Mac/Linux), or `docker compose up -d db`, then put "
            "DATABASE_URL=postgresql://raah:raah@localhost:5432/raah in backend/.env")
    if url.startswith("sqlite") and os.environ.get("RAAH_TESTING") != "1":
        raise DatabaseNotConfigured("SQLite is only used by the automated tests; set DATABASE_URL to a PostgreSQL URL")
    # Hosting providers give postgres:// URLs; SQLAlchemy wants a driver name. Raah uses pg8000, a
    # pure-Python driver, because psycopg's compiled libpq wrapper is blocked by Windows Application
    # Control on some laptops. Older .env files that name psycopg are moved over too.
    return re.sub(r"^postgres(ql)?(\+psycopg2?)?://", "postgresql+pg8000://", url)


_engine: Engine | None = None
_engine_url: str | None = None
_init_lock = threading.Lock()
# SQLite allows one writer at a time; serialising keeps "database is locked" away. Postgres needs no lock.
_sqlite_lock = threading.RLock()


def engine() -> Engine:
    """The shared engine, created (and the schema initialised) on first use or when DATABASE_URL/RAAH_DB changes."""
    global _engine, _engine_url
    url = database_url()
    if _engine is not None and _engine_url == url:
        return _engine
    with _init_lock:
        if _engine is None or _engine_url != url:
            if url.startswith("sqlite"):
                eng = create_engine(url, connect_args={"check_same_thread": False})

                @event.listens_for(eng, "connect")
                def _fk_on(dbapi_con, _):  # SQLite ignores foreign keys unless asked
                    dbapi_con.execute("PRAGMA foreign_keys = ON")
            else:
                eng = create_engine(url, pool_pre_ping=True)
            init_db(eng)
            _engine, _engine_url = eng, url
    return _engine


def is_sqlite() -> bool:
    return engine().dialect.name == "sqlite"


def init_db(eng: Engine) -> None:
    """Create missing tables, then add any columns that are newer than the existing tables."""
    metadata.create_all(eng)
    insp = inspect(eng)
    with eng.begin() as con:
        for table in metadata.sorted_tables:
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl_type = col.type.compile(dialect=eng.dialect)
                default = f" DEFAULT {col.server_default.arg}" if col.server_default is not None else ""
                not_null = " NOT NULL" if (not col.nullable and default) else ""
                con.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {ddl_type}{default}{not_null}'))


_QMARK = re.compile(r"\?")


def _named(sql: str, params: Any) -> tuple[str, dict]:
    """Turn "?" placeholders into :p0, :p1 ... so one SQL string works on every driver."""
    if isinstance(params, dict):
        return sql, params
    params = tuple(params or ())
    counter = iter(range(len(params)))
    sql = _QMARK.sub(lambda _: f":p{next(counter)}", sql)
    return sql, {f"p{i}": v for i, v in enumerate(params)}


class Result:
    def __init__(self, res: CursorResult):
        self._res = res

    @property
    def rowcount(self) -> int:
        return self._res.rowcount

    def fetchone(self):
        return self._res.mappings().fetchone() if self._res.returns_rows else None

    def fetchall(self) -> list:
        return list(self._res.mappings().fetchall()) if self._res.returns_rows else []

    def scalar(self):
        return self._res.scalar()


class DB:
    """A small wrapper over a SQLAlchemy connection in one transaction."""

    def __init__(self, con: Connection):
        self.con = con

    def execute(self, sql: str, params: Any = ()) -> Result:
        q, p = _named(sql, params)
        return Result(self.con.execute(text(q), p))

    def executemany(self, sql: str, rows: list) -> None:
        if not rows:
            return
        q, _ = _named(sql, rows[0])
        self.con.execute(text(q), [_named(sql, r)[1] for r in rows])

    def commit(self) -> None:
        """Kept for readability at call sites; the transaction commits when the `with` block ends."""


@contextmanager
def connect() -> Iterator[DB]:
    """One transaction: commits when the block ends, rolls back if it raises."""
    eng = engine()
    lock = _sqlite_lock if eng.dialect.name == "sqlite" else None
    if lock:
        lock.acquire()
    try:
        with eng.begin() as con:
            yield DB(con)
    finally:
        if lock:
            lock.release()
