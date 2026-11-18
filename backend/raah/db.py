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
    Column("created_at", Integer, nullable=False),
    UniqueConstraint("module_id", "user_id", name="uq_enrolments_module_user"),
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
