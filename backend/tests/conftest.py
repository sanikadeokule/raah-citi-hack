import os

# several teacher numbers so tests don't hit the per-phone OTP rate limit
os.environ["RAAH_TEACHER_PHONES"] = "9000000001,9000000002,9000000003"
import tempfile  # noqa: E402

os.environ.setdefault("RAG_WARM", "0")  # no background embedding during tests
os.environ.setdefault("RAG_CACHE", os.path.join(tempfile.mkdtemp(), "rag_vectors.json"))
