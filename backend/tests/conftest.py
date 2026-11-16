import os
import tempfile

# several teacher numbers so tests can register teachers independently
os.environ["RAAH_TEACHER_PHONES"] = "9000000001,9000000002,9000000003"

# Tests never touch the real database. Set TEST_DATABASE_URL to run them against a scratch
# PostgreSQL database (recommended); otherwise they use a throwaway SQLite file.
os.environ["RAAH_TESTING"] = "1"
os.environ.setdefault("DISABLE_SQLALCHEMY_CEXT_RUNTIME", "1")  # same as raah/db.py, set before any sqlalchemy import
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db")

if os.environ.get("TEST_DATABASE_URL"):
    # start every run from empty tables in the scratch database
    from sqlalchemy import create_engine  # noqa: E402

    from raah import db  # noqa: E402

    _eng = create_engine(db.database_url())
    db.metadata.drop_all(_eng)
    _eng.dispose()

os.environ.setdefault("RAG_WARM", "0")  # no background embedding during tests
os.environ.setdefault("RAG_CACHE", os.path.join(tempfile.mkdtemp(), "rag_vectors.json"))
