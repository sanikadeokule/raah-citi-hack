"""Ask Raah: retrieval-augmented answers grounded in raah-dataset.xlsx.

Ingestion (whenever the spreadsheet or a knowledge file changes)
  1. every sheet row becomes one chunk; its section path is "<Sheet> > <row ID>", and the
     Excel row number and Source link travel with it. Eligibility rules are grouped per
     scheme so a scheme's rules stay together. The README sheet is one chunk.
     Optional .md/.txt files in backend/knowledge/ are split by heading; a table always
     stays whole inside one chunk, and each chunk keeps its heading path.
  2. chunks are embedded with the same multilingual model as interest matching
     (embed.py: Ollama bge-m3 by default). Vectors are cached by text hash, so a re-index
     only embeds rows that changed.
  3. the index lives in memory (pure Python BM25 + cosine, default) or, if WEAVIATE_URL
     is set, is also pushed to Weaviate (vector index + BM25 keyword index).

Question time
  4. hybrid search: 70% vector meaning + 30% BM25 keywords (RAG_ALPHA), so exact codes like
     SCH05 or an establishment code are not missed. A Marathi or Hindi question is also
     turned into English keywords by the LLM for the keyword half.
  5. the LLM answers ONLY from the top chunks and cites them as [1], [2]...
  6. "AI explains, data decides": every number in the answer must appear in the retrieved
     chunks (or the question/profile). If not, or if no model answers, the matching rows are
     shown as they are, with their sources.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import time
import uuid
from collections import Counter
from pathlib import Path

import httpx
import numpy as np
import openpyxl
from fastapi import APIRouter
from pydantic import BaseModel, Field

from . import dataset, embed, llm

router = APIRouter(prefix="/api/ask", tags=["ai"])

ALPHA = float(os.environ.get("RAG_ALPHA", "0.7"))  # share of the vector score in the hybrid
TOP_K = int(os.environ.get("RAG_TOP_K", "6"))
KNOWLEDGE_DIR = Path(os.environ.get("RAAH_KNOWLEDGE_DIR", Path(__file__).resolve().parents[1] / "knowledge"))
CACHE_FILE = Path(os.environ.get("RAG_CACHE", Path(__file__).resolve().parents[1] / "data" / "rag_vectors.json"))
WEAVIATE_CLASS = "RaahChunk"

# sheets that are not knowledge: synthetic demo students, map points
SKIP_SHEETS = {"Demo_Students", "Talukas"}
# columns never put in a chunk (mentor phones are server-only; coordinates are noise)
SKIP_COLS = {"Phone", "Lat", "Lon"}
ID_COLS = ("ID", "Plan ID", "Career ID", "Scheme ID", "Student ID", "Key", "Apprentice category", "Taluka")
TITLE_COLS = ("Scheme", "Career", "Exam / admission", "Course / trade", "Course", "Trade", "Name",
              "Path shown to student", "Key", "Apprentice category")
SOURCE_COLS = ("Source", "Official site", "Source / status")
# fields shown first when the matching rows are listed without the LLM
SUMMARY_COLS = ("Amount", "Income limit", "Category", "Class / course", "Stipend (as listed)", "Current minimum stipend",
                "Seats", "Location", "Courses", "Fees", "Income while training", "Income after training / entry pay",
                "Application fee (Open / General)", "Usual timing", "Fee", "Duration / level", "Value", "Unit",
                "Revised minimum (per month, from 11 Sep 2025)", "Can help with")

_TOKEN = re.compile(r"[\wऀ-ॿ]+")  # keep Devanagari vowel signs inside words
_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_STOP = {"the", "a", "an", "of", "for", "to", "in", "on", "and", "or", "is", "are", "be", "can", "i", "me", "my",
         "what", "which", "who", "how", "do", "does", "with", "per", "any", "there", "it", "this", "that", "get"}


def tokens(text: str) -> list[str]:
    return [t for t in _TOKEN.findall((text or "").lower().translate(_DEVANAGARI_DIGITS)) if t not in _STOP]


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


# ------------------------------------------------------------------ 1. chunking

def _chunk(cid, sheet, row_id, title, fields, rows, source="", kind="row") -> dict:
    path = f"{sheet} > {row_id}" if row_id else sheet
    body = "\n".join(f"{k}: {v}" for k, v in fields if v)
    text = f"{path} | {title}\n{body}" if title else f"{path}\n{body}"
    return {"id": cid, "sheet": sheet, "row_id": row_id, "title": title or row_id or sheet, "path": path,
            "fields": [[k, v] for k, v in fields if v], "excel_rows": rows, "source": source, "kind": kind, "text": text}


def sheet_chunks(path: Path) -> list[dict]:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out: list[dict] = []
    try:
        for ws in wb.worksheets:
            name = ws.title
            if name in SKIP_SHEETS:
                continue
            rows = list(ws.iter_rows(values_only=True))
            if name == "README":
                lines = [_cell(r[0]) for r in rows if r and r[0]]
                if lines:
                    out.append(_chunk("README", "README", "", "About the Raah dataset", [("Notes", "\n".join(lines))],
                                      list(range(1, len(rows) + 1))))
                continue
            if not rows:
                continue
            header = [_cell(h) for h in rows[0]]
            idc = next((h for h in ID_COLS if h in header), header[0])
            titlec = next((h for h in TITLE_COLS if h in header and h != idc), None)
            grouped: dict[str, dict] = {}
            for i, r in enumerate(rows[1:], start=2):
                rec = {h: _cell(v) for h, v in zip(header, r) if h}
                if not any(rec.values()):
                    continue
                rid = rec.get(idc) or f"row {i}"
                title = rec.get(titlec, "") if titlec else ""
                if title and rec.get("Establishment") and titlec != "Establishment":
                    title = f"{title} - {rec['Establishment']}"
                source = next((rec[c] for c in SOURCE_COLS if rec.get(c, "").startswith("http")), "")
                fields = [(h, v) for h, v in rec.items() if h not in SKIP_COLS and h != idc and v]
                if name == "Eligibility_Rules":  # one chunk per scheme: its rules belong together
                    g = grouped.setdefault(rid, {"fields": [], "rows": []})
                    g["fields"].append(("Rule", "; ".join(f"{h}: {v}" for h, v in fields)))
                    g["rows"].append(i)
                    continue
                out.append(_chunk(f"{name}:{rid}", name, rid, title, fields, [i], source))
            for rid, g in grouped.items():
                out.append(_chunk(f"{name}:{rid}", name, rid, f"Eligibility rules for {rid}", g["fields"], g["rows"]))
    finally:
        wb.close()
    return out


_HEADING = re.compile(r"^(#{1,6})\s+(.*)")
MAX_CHARS = 1500


def doc_chunks(path: Path, root: Path) -> list[dict]:
    """Split a text document by headings. Tables (lines starting with |) are never split."""
    rel = path.relative_to(root).as_posix()
    heads: list[str] = []
    out, blocks, buf = [], [], []

    def flush_block():
        if buf:
            blocks.append("\n".join(buf).strip())
            buf.clear()

    def flush_section():
        flush_block()
        parts, cur = [], ""
        for b in [b for b in blocks if b]:
            if cur and len(cur) + len(b) > MAX_CHARS:
                parts.append(cur)
                cur = ""
            cur = f"{cur}\n\n{b}" if cur else b
        if cur:
            parts.append(cur)
        for j, p in enumerate(parts):
            section = " > ".join(heads) or rel
            sid = f"{rel}#{section}" + (f" ({j + 1})" if len(parts) > 1 else "")
            out.append(_chunk(sid, rel, section, heads[-1] if heads else rel, [("Text", p)], [], "", kind="doc"))
        blocks.clear()

    in_table = False
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = _HEADING.match(line)
        if m:
            flush_section()
            level = len(m.group(1))
            heads[:] = heads[:level - 1] + [m.group(2).strip()]
            in_table = False
            continue
        is_table = line.lstrip().startswith("|")
        if is_table != in_table or (not line.strip() and not in_table):
            flush_block()
        in_table = is_table
        if line.strip():
            buf.append(line)
    flush_section()
    return out


def knowledge_files() -> list[Path]:
    if not KNOWLEDGE_DIR.is_dir():
        return []
    return sorted(p for p in KNOWLEDGE_DIR.rglob("*") if p.suffix.lower() in (".md", ".txt") and p.is_file())


# ------------------------------------------------------------------ 2-3. the index

class Index:
    def __init__(self, chunks: list[dict], version: str):
        self.chunks = chunks
        self.version = version
        self.toks = [tokens(c["text"]) for c in chunks]
        self.tf = [Counter(t) for t in self.toks]
        self.avgdl = (sum(len(t) for t in self.toks) / len(self.toks)) if self.toks else 0
        df = Counter(w for t in self.toks for w in set(t))
        n = len(chunks)
        self.idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in df.items()}
        self.vectors: np.ndarray | None = None
        self.model: str | None = None
        self.weaviate_synced = False

    def bm25(self, q: list[str], k1=1.5, b=0.75) -> np.ndarray:
        s = np.zeros(len(self.chunks))
        for i, tf in enumerate(self.tf):
            dl = len(self.toks[i]) or 1
            for w in set(q):
                f = tf.get(w)
                if f:
                    s[i] += self.idf[w] * f * (k1 + 1) / (f + k1 * (1 - b + b * dl / self.avgdl))
        return s


_lock = threading.Lock()
_state: dict = {"index": None}
_vec_cache: dict[str, list[float]] = {}
_vec_cache_loaded = False


def _version() -> str:
    parts = [str(dataset.DATASET_PATH.stat().st_mtime)]
    parts += [f"{p}:{p.stat().st_mtime}" for p in knowledge_files()]
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]


def get_index() -> Index:
    """The current index, rebuilt whenever the spreadsheet or a knowledge file changes."""
    v = _version()
    with _lock:
        idx = _state["index"]
        if idx is None or idx.version != v:
            chunks = sheet_chunks(dataset.DATASET_PATH)
            for f in knowledge_files():
                chunks += doc_chunks(f, KNOWLEDGE_DIR)
            idx = Index(chunks, v)
            _state["index"] = idx
        return idx


def _load_cache():
    global _vec_cache_loaded
    if not _vec_cache_loaded:
        _vec_cache_loaded = True
        try:
            _vec_cache.update(json.loads(CACHE_FILE.read_text()))
        except Exception:
            pass


def _save_cache():
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(_vec_cache))
    except Exception:
        pass


def ensure_vectors(idx: Index) -> bool:
    """Embed chunks that are not cached yet. False when no embedding model is reachable."""
    if idx.vectors is not None:
        return True
    _load_cache()
    try:
        (_probe,), model = embed.embed(["probe"], "query")
    except embed.EmbedUnavailable:
        return False
    keys = [f"{model}:{hashlib.sha1(c['text'].encode()).hexdigest()}" for c in idx.chunks]
    todo = [i for i, k in enumerate(keys) if k not in _vec_cache]
    try:
        for s in range(0, len(todo), 32):
            batch = todo[s:s + 32]
            vecs, _ = embed.embed([idx.chunks[i]["text"] for i in batch], "passage")
            for i, v in zip(batch, vecs):
                _vec_cache[keys[i]] = v
    except embed.EmbedUnavailable:
        return False
    finally:
        if todo:
            _save_cache()
    m = np.array([_vec_cache[k] for k in keys], dtype=np.float32)
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    idx.vectors = m / np.where(norms == 0, 1, norms)
    idx.model = model
    return True


# ------------------------------------------------------------------ optional Weaviate store

_weaviate_down = {"at": 0.0}


def _weaviate_url() -> str | None:
    u = os.environ.get("WEAVIATE_URL", "").rstrip("/")
    return u if u and time.time() - _weaviate_down["at"] > 60 else None


def _wid(cid: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"raah:{cid}"))


def weaviate_sync(idx: Index, url: str):
    """Replace the Weaviate collection with this index (bring-your-own vectors)."""
    httpx.delete(f"{url}/v1/schema/{WEAVIATE_CLASS}", timeout=10)
    httpx.post(f"{url}/v1/schema", timeout=10, json={
        "class": WEAVIATE_CLASS, "vectorizer": "none",
        "properties": [{"name": "chunk_id", "dataType": ["text"], "tokenization": "field"},
                       {"name": "text", "dataType": ["text"], "tokenization": "word"}]}).raise_for_status()
    for s in range(0, len(idx.chunks), 100):
        objs = [{"class": WEAVIATE_CLASS, "id": _wid(c["id"]), "vector": idx.vectors[s + j].tolist(),
                 "properties": {"chunk_id": c["id"], "text": c["text"]}} for j, c in enumerate(idx.chunks[s:s + 100])]
        httpx.post(f"{url}/v1/batch/objects", json={"objects": objs}, timeout=60).raise_for_status()
    idx.weaviate_synced = True


def weaviate_search(idx: Index, url: str, text: str, qvec: np.ndarray, k: int) -> list[tuple[int, float]]:
    if not idx.weaviate_synced:
        weaviate_sync(idx, url)
    gql = {"query": "query($q: String!, $v: [Float!], $a: Float!, $k: Int!) { Get { %s(hybrid: {query: $q, vector: $v, alpha: $a, "
                    "fusionType: relativeScoreFusion}, limit: $k) { chunk_id _additional { score } } } }" % WEAVIATE_CLASS,
           "variables": {"q": text, "v": qvec.tolist(), "a": ALPHA, "k": k}}
    r = httpx.post(f"{url}/v1/graphql", json=gql, timeout=15)
    r.raise_for_status()
    j = r.json()
    if j.get("errors"):
        raise RuntimeError(str(j["errors"])[:200])
    pos = {c["id"]: i for i, c in enumerate(idx.chunks)}
    hits = j["data"]["Get"][WEAVIATE_CLASS] or []
    return [(pos[h["chunk_id"]], float(h["_additional"]["score"])) for h in hits if h["chunk_id"] in pos]


# ------------------------------------------------------------------ 4. hybrid search

def _norm(s: np.ndarray) -> np.ndarray:
    lo, hi = float(s.min()), float(s.max())
    return (s - lo) / (hi - lo) if hi > lo else np.zeros_like(s)


def search(query: str, k: int = TOP_K, keywords: str = "") -> dict:
    """Top-k chunks for the query. `keywords` adds extra words (e.g. an English rewrite) to the BM25 half."""
    idx = get_index()
    bm = idx.bm25(tokens(f"{query} {keywords}"))
    method, store, scores = "bm25", "python", None
    if ensure_vectors(idx):
        try:
            (qv,), _ = embed.embed([query], "query")
            qv = np.asarray(qv, dtype=np.float32)
            qv /= np.linalg.norm(qv) or 1
            url = _weaviate_url()
            if url:
                try:
                    hits = weaviate_search(idx, url, f"{query} {keywords}".strip(), qv, k)
                    return {"hits": hits, "method": "hybrid", "store": "weaviate", "model": idx.model}
                except Exception:
                    _weaviate_down["at"] = time.time()
                    idx.weaviate_synced = False
            vec = idx.vectors @ qv
            scores = ALPHA * _norm(vec) + (1 - ALPHA) * _norm(bm)
            method = "hybrid"
        except embed.EmbedUnavailable:
            scores = None
    if scores is None:
        scores = bm
    order = [int(i) for i in np.argsort(-scores)[:k] if scores[i] > 0]
    return {"hits": [(i, round(float(scores[i]), 4)) for i in order], "method": method, "store": store,
            "model": idx.model if method == "hybrid" else None}


# ------------------------------------------------------------------ 5-6. grounded answer

LANG_NAME = {"mr": "Marathi", "hi": "Hindi", "en": "English"}
MSG = {
    "not_found": {"en": "I could not find this in Raah's data. Please ask your teacher, or try other words.",
                  "hi": "यह जानकारी Raah के डेटा में नहीं मिली। कृपया अपने शिक्षक से पूछें या दूसरे शब्दों में पूछें।",
                  "mr": "ही माहिती Raah च्या डेटामध्ये सापडली नाही. कृपया तुमच्या शिक्षकांना विचारा किंवा दुसऱ्या शब्दांत विचारा."},
    "rows": {"en": "These rows in Raah's data match your question:",
             "hi": "Raah के डेटा में ये पंक्तियाँ आपके सवाल से मेल खाती हैं:",
             "mr": "Raah च्या डेटामधील या ओळी तुमच्या प्रश्नाशी जुळतात:"},
}


def _digits(text: str) -> set[str]:
    text = re.sub(r"\[\d+\]", " ", (text or "").translate(_DEVANAGARI_DIGITS))
    return {n.replace(",", "").rstrip(".") for n in _NUM.findall(text)}


def grounded(answer: str, context: str) -> bool:
    """Every number in the answer (citation markers aside) must appear in the context."""
    return _digits(answer) <= _digits(context)


def _source_block(chunks: list[dict]) -> str:
    out = []
    for n, c in enumerate(chunks, 1):
        where = f"row {c['excel_rows'][0]}" if c["excel_rows"] else c["sheet"]
        src = f"\nSource link: {c['source']}" if c["source"] else ""
        out.append(f"[{n}] ({c['path']}, {where})\n{c['text']}{src}")
    return "\n\n".join(out)


def _summary(c: dict) -> str:
    f = dict(c["fields"])
    picked = [k for k in SUMMARY_COLS if f.get(k)][:3] or [k for k, _ in c["fields"]][:2]
    return "; ".join(f"{k}: {f[k]}" for k in picked)


def _citation(n: int, c: dict) -> dict:
    return {"n": n, "id": c["id"], "sheet": c["sheet"], "row_id": c["row_id"], "title": c["title"], "path": c["path"],
            "excel_rows": c["excel_rows"], "source": c["source"], "summary": _summary(c)}


def rows_answer(chunks: list[dict], lang: str) -> str:
    lines = [MSG["rows"].get(lang, MSG["rows"]["en"])]
    lines += [f"[{n}] {c['title']}: {_summary(c)}" for n, c in enumerate(chunks[:3], 1)]
    return "\n".join(lines)


# word stems -> English words, so a Marathi/Hindi question still finds rows when no model is running.
# Vocabulary only, no dataset values. Matched as prefixes because words inflect (मुलींसाठी, शिष्यवृत्तीसाठी).
GLOSSARY = {
    "शिष्यवृत्त": "scholarship", "छात्रवृत्त": "scholarship", "स्कॉलरश": "scholarship",
    "वसतिगृह": "hostel", "छात्रावास": "hostel", "हॉस्टेल": "hostel",
    "मुली": "girl female women", "लड़कि": "girl female women", "लड़की": "girl female women", "महिला": "women female",
    "मुलगा": "boy male", "मुलां": "boy male", "लड़के": "boy male",
    "शुल्क": "fee fees", "फी": "fee fees", "फीस": "fee fees",
    "अप्रेंटिस": "apprentice apprenticeship", "शिकाऊ": "apprentice apprenticeship", "प्रशिक्षु": "apprentice apprenticeship",
    "विद्यावेतन": "stipend", "स्टायपेंड": "stipend", "वजीफ": "stipend",
    "पगार": "salary income pay", "वेतन": "salary income pay", "कमाई": "income earnings", "उत्पन्न": "income", "आय": "income",
    "नोकरी": "job", "नौकरी": "job", "परीक्षा": "exam", "प्रवेश": "admission",
    "आयटीआय": "ITI", "आईटीआई": "ITI", "नर्स": "nursing", "परिचारिका": "nursing", "इलेक्ट्रिशियन": "electrician",
    "कागदपत्र": "documents certificate", "दस्तावेज": "documents certificate", "प्रमाणपत्र": "certificate",
    "जात": "caste category", "ओबीसी": "OBC", "एससी": "SC", "एसटी": "ST", "रेल्वे": "railway", "रेलवे": "railway",
    "कोर्स": "course", "अभ्यासक्रम": "course", "पाठ्यक्रम": "course", "केंद्र": "centre", "पुणे": "Pune",
    "अपंग": "disability", "दिव्यांग": "disability", "मोफत": "free", "मुफ्त": "free",
}


def glossary_keywords(question: str) -> str:
    words = _TOKEN.findall(question or "")
    return " ".join(dict.fromkeys(en for w in words for stem, en in GLOSSARY.items() if w.startswith(stem)))


def english_keywords(question: str) -> str:
    """For a Marathi/Hindi question, English search words for the BM25 half (the index text is English):
    the glossary always, plus an LLM rewrite when a model answers."""
    if not re.search(r"[ऀ-ॿ]", question):
        return ""
    gloss = glossary_keywords(question)
    try:
        text, _ = llm.chat([{"role": "system", "content": "Translate the user's question into short English search keywords. "
                             "Reply with the keywords only, on one line."},
                            {"role": "user", "content": question}], temperature=0, max_tokens=40)
        return f"{text.strip()[:200]} {gloss}".strip()
    except llm.LLMUnavailable:
        return gloss


class AskIn(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    lang: str = "en"
    history: list[dict] = []
    profile: dict | None = None


def answer(body: AskIn) -> dict:
    lang = body.lang if body.lang in LANG_NAME else "en"
    prev = [str(m.get("content", ""))[:300] for m in body.history[-4:] if m.get("role") == "user"]
    query = " ".join(prev[-1:] + [body.question])  # a follow-up ("what documents?") keeps the last topic
    kw = english_keywords(body.question)
    res = search(query, TOP_K, kw)
    idx = get_index()
    chunks = [idx.chunks[i] for i, _ in res["hits"]]
    retrieval = {"method": res["method"], "store": res["store"], "model": res["model"], "keywords": kw or None,
                 "hits": [{"id": idx.chunks[i]["id"], "score": s} for i, s in res["hits"]]}
    if not chunks:
        return {"answer": MSG["not_found"][lang], "citations": [], "fallback": False, "grounded": True,
                "found": False, "provider": None, "retrieval": retrieval}

    sources = _source_block(chunks)
    profile = {k: v for k, v in (body.profile or {}).items()
               if k in ("class", "gender", "category", "family_income_annual", "taluka", "marks_pct", "can_stay_hostel", "age")}
    about = f"\nAbout the person asking (use it to judge what fits them): {json.dumps(profile, ensure_ascii=False)}" if profile else ""
    system = (f"You are Raah, a helpful guide for rural students, parents and teachers in Maharashtra. Answer in "
              f"{LANG_NAME[lang]} in short, simple sentences a Class 9 student understands.\n"
              + llm.off_topic_rule(lang) +
              "Use ONLY the numbered sources. After each fact write its source number in square brackets, like [2].\n"
              "Copy every amount, date, percentage, age and limit exactly as the source writes it (same digits); "
              "never convert units, add up, round or estimate.\n"
              "If the sources do not answer the question, say plainly that Raah's data does not have it and suggest asking "
              "the teacher. Never use outside knowledge. Call figures marked 'Estimate' estimates, and say a mentor marked "
              f"'Synthetic' is a demo.{about}")
    msgs = [{"role": "system", "content": system}]
    msgs += [{"role": m["role"], "content": str(m.get("content", ""))[:600]} for m in body.history[-4:]
             if m.get("role") in ("user", "assistant")]
    msgs.append({"role": "user", "content": f"Sources:\n{sources}\n\nQuestion: {body.question}"})
    base = {"retrieval": retrieval, "found": True}
    try:
        text, provider = llm.chat(msgs, temperature=0.2, max_tokens=500)
    except llm.LLMUnavailable as e:
        return {**base, "answer": rows_answer(chunks, lang), "citations": [_citation(n, c) for n, c in enumerate(chunks[:3], 1)],
                "fallback": True, "grounded": True, "provider": None, "reason": str(e)}
    text = text.strip()
    context = f"{sources}\n{body.question}\n{json.dumps(profile)}"
    if not text or not grounded(text, context):
        return {**base, "answer": rows_answer(chunks, lang), "citations": [_citation(n, c) for n, c in enumerate(chunks[:3], 1)],
                "fallback": True, "grounded": False, "provider": provider, "reason": "model used a figure that is not in the data"}
    cited = sorted({int(n) for n in re.findall(r"\[(\d+)\]", text) if 1 <= int(n) <= len(chunks)})
    return {**base, "answer": text, "citations": [_citation(n, chunks[n - 1]) for n in cited],
            "fallback": False, "grounded": True, "provider": provider}


@router.post("")
def ask(body: AskIn):
    return answer(body)


@router.get("/status")
def status():
    idx = get_index()
    sheets = Counter(c["sheet"] for c in idx.chunks)
    return {"chunks": len(idx.chunks), "sheets": dict(sheets), "version": idx.version, "alpha": ALPHA,
            "embedding_model": idx.model, "vectors_ready": idx.vectors is not None,
            "store": "weaviate" if os.environ.get("WEAVIATE_URL") else "python", "llm": llm.status()}


def warm():
    """Build the index and embed it in the background so the first question is fast."""
    def run():
        try:
            ensure_vectors(get_index())
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()
