"""Ask Raah (RAG): chunking, hybrid search, grounded answers with citations, re-indexing."""
import hashlib
import json
import os
import shutil
import tempfile

os.environ.setdefault("RAAH_DB", os.path.join(tempfile.mkdtemp(), "t.db"))

import numpy as np  # noqa: E402
import openpyxl  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from raah import dataset, embed, llm, rag  # noqa: E402
from raah.main import app  # noqa: E402

c = TestClient(app)


def no_models(monkeypatch):
    def down(*a, **k):
        raise llm.LLMUnavailable("ollama: ConnectError")

    def edown(*a, **k):
        raise embed.EmbedUnavailable("ollama: ConnectError")
    monkeypatch.setattr(llm, "chat", down)
    monkeypatch.setattr(embed, "embed", edown)


def fake_embedder(monkeypatch):
    """Hashed bag-of-words vectors: deterministic, shares words -> similar."""
    def _embed(texts, kind="query"):
        out = []
        for t in texts:
            v = np.zeros(64)
            for w in rag.tokens(t):
                v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 64] += 1
            out.append(v.tolist())
        return out, "fake:bow"
    monkeypatch.setattr(embed, "embed", _embed)
    rag._state["index"] = None


def fake_llm(answer):
    def _chat(messages, **kw):
        if "search keywords" in messages[0]["content"]:
            return "scholarship girls hostel", "test"
        return (answer(messages) if callable(answer) else answer), "test"
    return _chat


# ------------------------------------------------------------------ chunking

def test_one_chunk_per_row_with_path_row_and_source():
    idx = rag.get_index()
    ch = {x["id"]: x for x in idx.chunks}
    s = ch["Scholarships:SCH01"]
    assert s["path"] == "Scholarships > SCH01" and s["excel_rows"] == [2]
    assert s["source"].startswith("http") and "NMMSS" in s["title"]
    assert s["text"].startswith("Scholarships > SCH01 |")
    # demo students are not knowledge; mentor phone numbers never enter the index
    assert not any(x["sheet"] == "Demo_Students" for x in idx.chunks)
    assert all("+91" not in x["text"] for x in idx.chunks if x["sheet"] == "Mentors")
    # a scheme's eligibility rules stay together in one chunk
    rules = ch["Eligibility_Rules:SCH01"]
    assert len(rules["excel_rows"]) > 1 and rules["text"].count("Rule:") == len(rules["excel_rows"])


def test_doc_chunks_keep_tables_whole_and_heading_path(tmp_path):
    rows = "\n".join(f"| Trade {i} | ₹{i},000 |" for i in range(200))
    doc = tmp_path / "guide.md"
    doc.write_text(f"# Guide\nintro\n## Fees\n| Trade | Fee |\n|---|---|\n{rows}\n\nafter table\n")
    chunks = rag.doc_chunks(doc, tmp_path)
    table = [x for x in chunks if "| Trade 0 |" in x["text"]]
    assert len(table) == 1 and "| Trade 199 |" in table[0]["text"]  # a long table is never split
    assert table[0]["path"] == "guide.md > Guide > Fees"


# ------------------------------------------------------------------ search

def test_bm25_finds_exact_codes(monkeypatch):
    no_models(monkeypatch)
    idx = rag.get_index()
    r = rag.search("E06242700019")
    assert r["method"] == "bm25" and idx.chunks[r["hits"][0][0]]["id"] == "Apprenticeships_NAPS:NAP01"


def test_hybrid_search_uses_vectors_and_keywords(monkeypatch):
    fake_embedder(monkeypatch)
    r = rag.search("fitter railway apprentice")
    idx = rag.get_index()
    ids = [idx.chunks[i]["id"] for i, _ in r["hits"]]
    assert r["method"] == "hybrid" and r["model"] == "fake:bow"
    assert any(i.startswith("Apprenticeships_Railway") for i in ids)


def test_marathi_question_finds_rows_without_any_model(monkeypatch):
    no_models(monkeypatch)
    r = c.post("/api/ask", json={"question": "मुलींसाठी वसतिगृह शिष्यवृत्ती", "lang": "mr"}).json()
    assert r["found"] and r["fallback"]
    assert any(x["sheet"] == "Scholarships" for x in r["citations"])
    assert r["answer"].startswith("Raah च्या")


def test_reindexes_when_spreadsheet_changes(monkeypatch, tmp_path):
    no_models(monkeypatch)
    copy = tmp_path / "raah-dataset.xlsx"
    shutil.copy(dataset.DATASET_PATH, copy)
    monkeypatch.setattr(dataset, "DATASET_PATH", copy)
    rag._state["index"] = None
    assert not rag.search("Zorbatron")["hits"]
    wb = openpyxl.load_workbook(copy)
    ws = wb["Scholarships"]
    ws.append(["SCH99", "Zorbatron Hostel Grant", "State"] + [None] * 8 + ["https://example.org/zorbatron", "2026-11-16"])
    wb.save(copy)
    os.utime(copy, (1e9, 1e9))
    idx = rag.get_index()
    hit = rag.search("Zorbatron")["hits"][0][0]
    assert idx.chunks[hit]["id"] == "Scholarships:SCH99" and idx.chunks[hit]["source"] == "https://example.org/zorbatron"
    rag._state["index"] = None


# ------------------------------------------------------------------ answers

def test_answer_cites_numbered_sources(monkeypatch):
    fake_embedder(monkeypatch)

    def ans(messages):
        src = messages[-1]["content"]
        assert "[1] (" in src and "Question:" in src
        return "NMMSS pays ₹12,000 per year [1]."
    monkeypatch.setattr(llm, "chat", fake_llm(ans))
    r = c.post("/api/ask", json={"question": "How much does NMMSS scholarship pay?", "lang": "en"}).json()
    assert r["fallback"] is False and r["grounded"] is True
    assert r["citations"][0]["n"] == 1 and r["citations"][0]["source"].startswith("http")
    assert r["citations"][0]["excel_rows"]


def test_invented_number_is_rejected(monkeypatch):
    fake_embedder(monkeypatch)
    monkeypatch.setattr(llm, "chat", fake_llm("NMMSS pays ₹99,999 per year [1]."))
    r = c.post("/api/ask", json={"question": "How much does NMMSS pay?"}).json()
    assert r["fallback"] is True and r["grounded"] is False
    assert "99,999" not in r["answer"] and r["citations"]


def test_grounding_reads_devanagari_digits_and_ignores_citation_markers():
    ctx = "Amount: ₹12,000 per year"
    assert rag.grounded("दर वर्षी ₹१२,००० मिळतात [3].", ctx)
    assert not rag.grounded("दर वर्षी ₹१५,००० मिळतात [1].", ctx)


def test_no_model_lists_matching_rows(monkeypatch):
    no_models(monkeypatch)
    r = c.post("/api/ask", json={"question": "Which railway apprentice trades are there in Pune?"}).json()
    assert r["fallback"] is True and r["answer"].startswith("These rows")
    assert len(r["citations"]) == 3


def test_nothing_found_says_so(monkeypatch):
    no_models(monkeypatch)
    r = c.post("/api/ask", json={"question": "qwertyuiop", "lang": "hi"}).json()
    assert r["found"] is False and "नहीं मिली" in r["answer"]


def test_status_reports_index():
    s = c.get("/api/ask/status").json()
    assert s["chunks"] > 200 and s["sheets"]["Scholarships"] == len(dataset.load()["scholarships"]) and s["alpha"] == 0.7


# ------------------------------------------------------------------ optional Weaviate store

def test_weaviate_store_used_when_configured(monkeypatch):
    fake_embedder(monkeypatch)
    calls = []

    class R:
        def __init__(self, j=None):
            self._j = j or {}

        def raise_for_status(self):
            pass

        def json(self):
            return self._j

    def post(url, json=None, **kw):
        calls.append(url)
        if url.endswith("/v1/graphql"):
            assert json["variables"]["a"] == 0.7 and len(json["variables"]["v"]) == 64
            return R({"data": {"Get": {"RaahChunk": [{"chunk_id": "Scholarships:SCH02", "_additional": {"score": "0.9"}}]}}})
        return R()
    monkeypatch.setattr(rag.httpx, "post", post)
    monkeypatch.setattr(rag.httpx, "delete", lambda *a, **k: R())
    monkeypatch.setenv("WEAVIATE_URL", "http://weaviate:8080")
    r = rag.search("OBC scholarship")
    idx = rag.get_index()
    assert r["store"] == "weaviate" and idx.chunks[r["hits"][0][0]]["id"] == "Scholarships:SCH02"
    assert any(u.endswith("/v1/batch/objects") for u in calls) and any(u.endswith("/v1/schema") for u in calls)
    # a dead Weaviate falls back to the in-memory hybrid
    monkeypatch.setattr(rag.httpx, "post", lambda *a, **k: (_ for _ in ()).throw(ConnectionError()))
    rag.get_index().weaviate_synced = False
    r2 = rag.search("OBC scholarship")
    assert r2["store"] == "python" and r2["method"] == "hybrid"
    rag._weaviate_down["at"] = 0
