"""Live notices from official sites (the "notice watcher" in the agentic upgrade plan).

Every few hours (and when a teacher taps "Check official sites now") Raah reads the latest-news list of each
official source below, keeps the notices it has not seen before, and works out from the notice text alone:
  - which exam (Exams sheet) or scholarships (Scholarships sheet) it concerns,
  - its category (result, admit card, application, admission round ...),
  - any dates in it, and which one is a deadline ("last date", "पर्यंत" ...).
None of that uses an AI: it is keyword and date rules over the official text, so it cannot invent a date.
The title, link and published date are stored exactly as the site shows them. An AI, when one is configured,
only adds a one-line English/Hindi/Marathi version of the title, and only if it keeps every number unchanged.

Then students are matched deterministically:
  - a notice about exam EX03 goes to students whose roadmap needs EX03, or who tapped "Notify me" on it;
  - a MahaDBT notice goes to students the eligibility engine finds eligible for a scheme applied for on MahaDBT.
Each match becomes a "notice" notification with the reason ("Your roadmap needs MHT-CET").

Every successful read saves the page in backend/data/snapshots/, so if a site is down (or blocks us on demo
day) the last good copy is used and the status says so.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import threading
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Callable, Iterator
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from lxml import html as lxml_html

from . import dataset, db, engine
from .auth import current_user, notify, student_profiles, teacher_only

router = APIRouter(prefix="/api/notices", tags=["notices"])

SNAPSHOTS = Path(__file__).resolve().parents[1] / "data" / "snapshots"
USER_AGENT = "Mozilla/5.0 (compatible; RaahNoticeReader/0.1; exam and scholarship alerts for students)"
TIMEOUT = 25
MAX_ITEMS = 40          # per source and read
FRESH_DAYS = 21         # a notice published longer ago than this is kept for "All updates" but not sent to students
MATCH_DAYS = 30         # notices first seen in the last 30 days are matched to (new) students
READ_PER_RUN = 6        # notice pages/PDFs opened per source and run, to find dates inside them
SUMMARIES_PER_RUN = 8

# One entry per official site. `items` is where the site lists its notices. `scheme_portal` marks a scholarship
# portal: its notices concern every scheme whose "Apply via" names it.
SOURCES: list[dict] = [
    {"id": "nta", "name": "National Testing Agency", "short": "NTA", "url": "https://nta.ac.in/", "kind": "exam",
     "items": "//marquee[contains(@class,'latestPart')]//a"},
    {"id": "jee", "name": "JEE (Main), NTA", "short": "JEE Main", "url": "https://jeemain.nta.nic.in/", "kind": "exam",
     "items": "//div[contains(@class,'newsticker')]//li/a | //div[contains(@class,'gen-list')]//li/a"},
    {"id": "neet", "name": "NEET (UG), NTA", "short": "NEET", "url": "https://neet.nta.nic.in/", "kind": "exam",
     "items": "//div[contains(@class,'newsticker')]//li/a | //div[contains(@class,'gen-list')]//li/a"},
    {"id": "cetcell", "name": "State CET Cell, Maharashtra", "short": "CET Cell", "url": "https://cetcell.mahacet.org/",
     "kind": "exam", "items": "//ul[contains(@class,'educms-download-marquee-content-items')]//li/a"},
    {"id": "mahadbt", "name": "MahaDBT scholarship portal", "short": "MahaDBT", "url": "https://mahadbt2.maharashtra.gov.in/",
     "kind": "scholarship", "scheme_portal": "mahadbt",
     "items": "//div[contains(@class,'notice-text')] | //span[contains(@class,'latest-item')]"},
]
SOURCE_BY_ID = {s["id"]: s for s in SOURCES}

# read_notice only opens official pages
ALLOWED_HOSTS = (".gov.in", ".nic.in", "nta.ac.in", "mahacet.org", "maharashtracet.org")


# ------------------------------------------------------------------ fetching

def fetch_page(url: str) -> str:
    r = httpx.get(url, follow_redirects=True, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    return _decode(r.content, r.encoding)


def _decode(content: bytes, encoding: str | None = None) -> str:
    # several of these sites send no charset; their pages are UTF-8 (Marathi/Hindi text)
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return content.decode(encoding or "latin-1", "replace")


def allowed(url: str) -> bool:
    p = urlparse(url)
    host = (p.hostname or "").lower()
    return p.scheme in ("http", "https") and any(host == h.lstrip(".") or host.endswith(h) for h in ALLOWED_HOSTS)


def _snapshot_path(source_id: str) -> Path:
    return SNAPSHOTS / f"{source_id}.html"


def read_source(source: dict, fetch: Callable[[str], str] = fetch_page) -> tuple[str | None, str, int | None]:
    """(page, status, snapshot time). Status is "ok", "snapshot" (site failed, last good copy used) or "error"."""
    try:
        page = fetch(source["url"])
        try:
            SNAPSHOTS.mkdir(parents=True, exist_ok=True)
            _snapshot_path(source["id"]).write_text(page, encoding="utf-8")
        except OSError:
            pass
        return page, "ok", None
    except Exception:  # a government site being down is routine
        snap = _snapshot_path(source["id"])
        if snap.exists():
            return snap.read_text(encoding="utf-8"), "snapshot", int(snap.stat().st_mtime)
        return None, "error", None


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def parse_items(source: dict, page: str) -> list[dict]:
    """The notices listed on a source's page: [{title, url}], in page order, without repeats."""
    tree = lxml_html.fromstring(page)
    out, seen = [], set()
    for el in tree.xpath(source["items"]):
        title = _clean(el.text_content())
        a = el if el.tag == "a" else next(iter(el.xpath(".//a[@href]")), None)
        href = (a.get("href") or "").strip() if a is not None else ""
        url = urljoin(source["url"], href) if href and not href.startswith(("#", "javascript:", "mailto:")) else source["url"]
        # skip menu-style links ("Ministry Of Education"): notices are sentences
        if len(title) < 12 or len(title.split()) < 4 or urlparse(url).path in ("", "/") and url != source["url"]:
            continue
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": title[:500], "url": url})
        if len(out) >= MAX_ITEMS:
            break
    return out


def notice_hash(source_id: str, title: str, url: str) -> str:
    return hashlib.sha1(f"{source_id}|{_clean(title).lower()}|{url}".encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ dates

_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    # Marathi
    "जानेवारी": 1, "फेब्रुवारी": 2, "मार्च": 3, "एप्रिल": 4, "मे": 5, "जून": 6, "जुलै": 7, "ऑगस्ट": 8, "सप्टेंबर": 9,
    "ऑक्टोबर": 10, "नोव्हेंबर": 11, "डिसेंबर": 12,
    # Hindi
    "जनवरी": 1, "फरवरी": 2, "अप्रैल": 4, "मई": 5, "जुलाई": 7, "अगस्त": 8, "सितंबर": 9, "सितम्बर": 9, "अक्टूबर": 10,
    "अक्तूबर": 10, "नवंबर": 11, "नवम्बर": 11, "दिसंबर": 12, "दिसम्बर": 12,
}
_EN_MONTH = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])"
_DV_MONTH = "|".join(sorted((m for m in _MONTHS if not m.isascii()), key=len, reverse=True))
_MONTH = rf"(?:{_EN_MONTH}|{_DV_MONTH})"
_DATE_PATTERNS = [
    re.compile(rf"(?<!\d)(?P<d>\d{{1,2}})(?:st|nd|rd|th)?[\s\-./,]*(?P<m>{_MONTH})\.?[\s\-./,]*(?P<y>\d{{4}})(?!\d)", re.I),
    re.compile(rf"(?P<m>{_EN_MONTH})\.?\s+(?P<d>\d{{1,2}})(?:st|nd|rd|th)?,?\s+(?P<y>\d{{4}})(?!\d)", re.I),
    re.compile(r"(?<![\d/.\-])(?P<d>\d{1,2})[./\-](?P<m>\d{1,2})[./\-](?P<y>\d{4}|\d{2})(?![\d/.\-])"),
]
_DEADLINE_BEFORE = re.compile(r"\b(?:last date|till|until|up ?to|extended|extension|closes?|closing|before|deadline|due date)\b|"
                              r"अंतिम|शेवटची|मुदत|अखेरची", re.I)
_DEADLINE_AFTER = re.compile(r"^[\s,.)]*(?:पर्यंत|तक|onwards? is the last)", re.I)
_START_BEFORE = re.compile(r"\b(?:from|opens?|opening|starts?|starting|commenc\w*|begins?|w\.?e\.?f)\b|शुरू|प्रारंभ", re.I)
_START_AFTER = re.compile(r"^[\s,.)]*(?:पासून|से\b|onwards)", re.I)


def _month_number(m: str) -> int | None:
    if m.isdigit():
        n = int(m)
        return n if 1 <= n <= 12 else None
    m = m.lower().rstrip(".")
    return _MONTHS.get(m) or _MONTHS.get(m[:3])


def extract_dates(text: str) -> list[dict]:
    """Every date in the text, as {date: YYYY-MM-DD, text, label}. The label is "deadline", "start" or "date",
    from the words next to it ("last date", "till", "पर्यंत" / "from", "पासून")."""
    t = (text or "").translate(_DEVANAGARI_DIGITS)
    found, taken = [], []
    for pat in _DATE_PATTERNS:
        for m in pat.finditer(t):
            if any(s < m.end() and m.start() < e for s, e in taken):
                continue
            month = _month_number(m.group("m"))
            y = int(m.group("y"))
            y = y + 2000 if y < 100 else y
            try:
                dt = date(y, month, int(m.group("d"))) if month else None
            except ValueError:
                dt = None
            if not dt or not 2000 <= dt.year <= 2100:
                continue
            taken.append((m.start(), m.end()))
            before, after = t[max(0, m.start() - 60):m.start()], t[m.end():m.end() + 25]
            if _DEADLINE_AFTER.search(after):
                label = "deadline"
            elif _START_AFTER.search(after):
                label = "start"
            else:
                # the keyword closest to the date wins: "open from 1 Jun ... last date 30 Jun"
                dl = [x.end() for x in _DEADLINE_BEFORE.finditer(before)]
                st = [x.end() for x in _START_BEFORE.finditer(before)]
                label = "deadline" if dl and (not st or dl[-1] > st[-1]) else "start" if st else "date"
            # translating digits keeps every position, so the slice is the original wording
            found.append({"date": dt.isoformat(), "text": text[m.start():m.end()],
                          "label": label, "_at": m.start()})
    found.sort(key=lambda x: x.pop("_at"))
    out, seen = [], set()
    for f in found:
        if (f["date"], f["label"]) not in seen:
            seen.add((f["date"], f["label"]))
            out.append(f)
    return out


def published_from_url(url: str) -> str | None:
    """Government CMSs put the upload date in the file path: /uploads/2026/10/2026103012.pdf -> 2026-10-30."""
    m = re.search(r"/uploads/(\d{4})/(\d{2})/(\d{4})(\d{2})(\d{2})\d*", url)
    if m and m.group(1) == m.group(3) and m.group(2) == m.group(4):
        try:
            return date(int(m.group(3)), int(m.group(4)), int(m.group(5))).isoformat()
        except ValueError:
            pass
    m = re.search(r"/uploads/(\d{4})/(\d{2})/", url)
    if m:
        name = url.rsplit("/", 1)[-1]
        d = re.search(r"(?<!\d)(\d{2})(\d{2})(" + m.group(1) + r")(?!\d)", name)  # ..._19102026.pdf
        if d and d.group(2) == m.group(2):
            try:
                return date(int(d.group(3)), int(d.group(2)), int(d.group(1))).isoformat()
            except ValueError:
                pass
        return f"{m.group(1)}-{m.group(2)}"
    return None


def next_deadline(dates: list[dict], today: date | None = None) -> str | None:
    today = today or date.today()
    ahead = sorted(d["date"] for d in dates if d["label"] == "deadline" and d["date"] >= today.isoformat())
    return ahead[0] if ahead else None


# ------------------------------------------------------------------ what a notice is about

# Marathi/Hindi spellings of the names used in the Exams sheet
_ALIASES = {"सीईटी": "CET", "नर्सिंग": "Nursing", "आयटीआय": "ITI", "आईटीआई": "ITI", "पॉलिटेक्निक": "Polytechnic",
            "पॉलीटेक्निक": "Polytechnic", "तंत्रनिकेतन": "Polytechnic", "नीट": "NEET", "शिष्यवृत्ती": "scholarship"}
_EXAM_STOP = {"PCM", "PCB", "CAP", "SSC", "MSCE", "NTA", "UG", "PG", "RRC", "MH"}
_EXAM_STOP_WORDS = {"maharashtra", "admission", "central", "diploma", "scholarship", "examination"}

_CATEGORIES = [
    ("result", r"result|answer key|score ?card|topper|merit list|cut-?off|निकाल|गुणवत्ता यादी|परिणाम"),
    ("admit_card", r"admit card|hall ticket|प्रवेशपत्र|प्रवेश पत्र"),
    ("application", r"application|registration|apply|online form|form for|अर्ज|नोंदणी|पंजीकरण|आवेदन"),
    ("admission", r"\bcap\b|round|allotment|admission|counsel+ing|प्रवेश|फेरी"),
    ("exam", r"exam|test|परीक्षा"),
]


def exam_keywords(exam: dict) -> set[str]:
    """Words that name an exam in a notice, from its name in the Exams sheet:
    'MHT-CET (PCM / PCB)' -> {MHT-CET, MHT, CET}; 'MH Nursing CET' -> {Nursing, CET}; 'NEET-UG' -> {NEET-UG, NEET}."""
    name = str(exam.get("name") or "").split("(")[0]
    out = set()
    for tok in re.findall(r"[A-Za-z][A-Za-z\-]+", name):
        parts = [tok] + tok.split("-")
        for p in parts:
            if len(p) >= 3 and p.isupper() and p not in _EXAM_STOP:
                out.add(p)
            elif len(p) >= 7 and p[0].isupper() and p.lower() not in _EXAM_STOP_WORDS:
                out.add(p)
    return out


def _normalise(text: str) -> str:
    for k, v in _ALIASES.items():
        text = text.replace(k, f" {v} ")
    return text


def tag_notice(title: str, source: dict, d: dict, body: str = "") -> dict:
    """{category, exams: [ids], schemes: [ids]} from the notice's own words."""
    text = _normalise(f"{title} {body[:3000]}")
    exams = d.get("exams", [])
    hits: dict[str, set[str]] = {}
    for e in exams:
        for kw in exam_keywords(e):
            if re.search(rf"(?<![A-Za-z]){re.escape(kw)}(?![A-Za-z])", text, re.I if not kw.isupper() else 0):
                hits.setdefault(e["id"], set()).add(kw)
    if len(hits) > 1:
        # "MH Nursing CET" and "MHT-CET" share "CET": keep the exams named by a word only they have
        counts: dict[str, int] = {}
        for kws in hits.values():
            for kw in kws:
                counts[kw] = counts.get(kw, 0) + 1
        specific = {eid for eid, kws in hits.items() if any(counts[k] == 1 for k in kws)}
        if specific:
            hits = {k: v for k, v in hits.items() if k in specific}
    exam_ids = sorted(hits)
    if not exam_ids and source.get("kind") == "exam":
        # a notice on an exam's own site is about that exam (the site in the Exams sheet)
        host = urlparse(source["url"]).hostname or ""
        exam_ids = sorted(e["id"] for e in exams if (urlparse(str(e.get("site") or "")).hostname or "") == host)

    scheme_ids: list[str] = []
    if source.get("scheme_portal"):
        scheme_ids = [s["id"] for s in d.get("scholarships", []) if source["scheme_portal"] in str(s.get("apply_via") or "").lower()]

    category = next((c for c, pat in _CATEGORIES if re.search(pat, text, re.I)), None)
    if category is None:
        category = "scholarship" if source.get("kind") == "scholarship" else "general"
    return {"category": category, "exams": exam_ids, "schemes": scheme_ids}


# ------------------------------------------------------------------ reading one notice

def read_notice(url: str, fetch_bytes: Callable[[str], tuple[bytes, str]] | None = None, max_chars: int = 8000) -> dict:
    """Text of an official notice page or PDF, with the dates found in it. Only official sites are opened."""
    if not allowed(url):
        return {"error": "only official government pages can be opened", "url": url}

    def _get(u: str) -> tuple[bytes, str]:
        r = httpx.get(u, follow_redirects=True, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        return r.content, r.headers.get("content-type", "")

    try:
        content, ctype = (fetch_bytes or _get)(url)
    except Exception as e:  # noqa: BLE001
        return {"error": f"could not open the page ({type(e).__name__})", "url": url}
    if "pdf" in ctype.lower() or content[:5] == b"%PDF-":
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(content))
            text = "\n".join((p.extract_text() or "") for p in reader.pages[:8])
        except ImportError:
            return {"error": "PDF reading needs the pypdf package (pip install -r requirements.txt)", "url": url}
        except Exception as e:  # noqa: BLE001 - damaged or scanned PDF
            return {"error": f"could not read the PDF ({type(e).__name__})", "url": url}
        kind = "pdf"
    else:
        tree = lxml_html.fromstring(_decode(content))
        for bad in tree.xpath("//script|//style|//noscript|//nav|//header|//footer"):
            bad.drop_tree()
        text = tree.text_content()
        kind = "page"
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text).strip()
    return {"url": url, "kind": kind, "text": text[:max_chars], "chars": len(text),
            "dates": extract_dates(text[:20000]),
            "note": None if text.strip() else "No text could be read (it may be a scanned image); open the official link."}


# ------------------------------------------------------------------ AI translation of titles (optional)

def _digits(s: str) -> list[str]:
    return sorted(re.findall(r"\d+", (s or "").translate(_DEVANAGARI_DIGITS)))


def summarise(title: str) -> dict | None:
    """{"en", "hi", "mr"} one-line versions of a notice title, or None. Rejected if any number changes."""
    from . import llm

    try:
        text, _ = llm.chat([
            {"role": "system", "content": "You translate titles of official Indian exam and scholarship notices. Reply with "
             "JSON {\"en\": ..., \"hi\": ..., \"mr\": ...}: one short simple sentence each, same meaning, every number and "
             "date exactly as in the title (you may write them in Latin digits). Add nothing that is not in the title."},
            {"role": "user", "content": title}], json_mode=True, temperature=0.1, max_tokens=400)
        out = llm.parse_json(text)
    except Exception:  # noqa: BLE001 - no AI configured or a bad reply: the original title is shown
        return None
    want = _digits(title)
    res = {}
    for k in ("en", "hi", "mr"):
        v = _clean(str(out.get(k) or ""))
        if v and _digits(v) == want:
            res[k] = v[:300]
    return res or None


# ------------------------------------------------------------------ the watcher run

def _source_rows(con) -> dict:
    rows = con.execute("SELECT ref_id, status, last_checked, last_changed FROM source_watch WHERE kind = 'notices'").fetchall()
    return {r["ref_id"]: dict(r) for r in rows}


def _record_source(con, source: dict, status: str, now: int, changed: bool, count: int) -> None:
    exists = con.execute("SELECT id FROM source_watch WHERE kind = 'notices' AND ref_id = ?", (source["id"],)).fetchone()
    lines = json.dumps({"items": count})
    if exists is None:
        con.execute("INSERT INTO source_watch (kind, ref_id, url, lines, status, last_checked, last_changed) "
                    "VALUES ('notices', ?, ?, ?, ?, ?, ?)", (source["id"], source["url"], lines, status, now, now if changed else None))
    else:
        con.execute("UPDATE source_watch SET url = ?, lines = ?, status = ?, last_checked = ?, "
                    "last_changed = CASE WHEN ? = 1 THEN ? ELSE last_changed END WHERE id = ?",
                    (source["url"], lines, status, now, 1 if changed else 0, now, exists["id"]))


def _is_fresh(published: str | None, deadline: str | None, first_run: bool, today: date) -> bool:
    if deadline:
        return True  # a deadline still ahead always matters
    if published:
        try:
            pub = date.fromisoformat(published if len(published) == 10 else f"{published}-28")
        except ValueError:
            pub = None
        if pub is not None:
            return pub >= today - timedelta(days=FRESH_DAYS)
    # no date: on the first ever read it is part of the baseline (already public); later it is new
    return not first_run


def check_source(source: dict, fetch: Callable[[str], str] = fetch_page, read: Callable[[str], dict] | None = None,
                 today: date | None = None) -> dict:
    """Read one source, store its new notices. Returns {source, status, found, new, fresh, snapshot_at}."""
    today = today or date.today()
    now = int(time.time())
    d = dataset.get()
    page, status, snap_at = read_source(source, fetch)
    items = parse_items(source, page) if page else []
    with db.connect() as con:
        known = {r["hash"] for r in con.execute("SELECT hash FROM notices WHERE source = ?", (source["id"],)).fetchall()}
    first_run = not known  # nothing stored yet from this source: what is on the page now is the baseline
    new = []
    for it in items:
        h = notice_hash(source["id"], it["title"], it["url"])
        if h in known:
            continue
        dates = extract_dates(it["title"])
        published = published_from_url(it["url"])
        new.append({**it, "hash": h, "dates": dates, "published": published, "tags": tag_notice(it["title"], source, d)})

    # open the newest notices to find dates written inside them (deadlines are often only in the PDF)
    reader = read or read_notice
    opened = 0
    for n in new:
        if opened >= READ_PER_RUN or n["url"] == source["url"]:
            continue
        if not _is_fresh(n["published"], next_deadline(n["dates"], today), first_run, today):
            continue
        opened += 1
        body = reader(n["url"])
        if body.get("text"):
            seen = {(x["date"], x["label"]) for x in n["dates"]}
            n["dates"] += [x for x in body["dates"] if (x["date"], x["label"]) not in seen][:12]
            n["tags"] = tag_notice(n["title"], source, d, body["text"])

    fresh_count = 0
    with db.connect() as con:
        for n in new:
            deadline = next_deadline(n["dates"], today)
            fresh = _is_fresh(n["published"], deadline, first_run, today)
            fresh_count += fresh
            con.execute("INSERT INTO notices (source, hash, title, url, published, category, exams, schemes, dates, deadline, "
                        "fresh, first_seen, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                        (source["id"], n["hash"], n["title"], n["url"], n["published"], n["tags"]["category"],
                         json.dumps(n["tags"]["exams"]), json.dumps(n["tags"]["schemes"]),
                         json.dumps(n["dates"], ensure_ascii=False), deadline, 1 if fresh else 0, now))
        _record_source(con, source, status, now, bool(new), len(items))
    return {"source": source["id"], "name": source["short"], "status": status, "found": len(items), "new": len(new),
            "fresh": fresh_count, "snapshot_at": snap_at}


def roadmap_exams(d: dict, career_id: str | None) -> set[str]:
    """Exams on a career's roadmap: its path's stages (Roadmap_Stages) and its cost plan (Plan_Inputs)."""
    if not career_id:
        return set()
    career = next((c for c in d["careers"] if c["id"] == career_id), None)
    stages = (d.get("roadmap") or {}).get((career or {}).get("roadmap_path") or "", [])
    return ({x for s in stages for x in s.get("exams", [])}
            | {x for p in d["plans"] if p["career_id"] == career_id for x in p.get("exams", [])})


def match_students(now: int | None = None) -> dict:
    """Send every recent, visible notice to the students it concerns (once each). Returns counts."""
    from mcp_servers.data_server import clean_profile

    now = now or int(time.time())
    d = dataset.get()
    exam_names = {e["id"]: e["name"] for e in d["exams"]}
    scheme_names = {s["id"]: s["name"] for s in d["scholarships"]}
    with db.connect() as con:
        active = [dict(r) for r in con.execute(
            "SELECT * FROM notices WHERE hidden = 0 AND fresh = 1 AND first_seen >= ? ORDER BY id",
            (now - MATCH_DAYS * 86400,)).fetchall()]
        watching: dict[int, set[str]] = {}
        for r in con.execute("SELECT user_id, ref_id FROM interests WHERE kind = 'exam'").fetchall():
            watching.setdefault(r["user_id"], set()).add(r["ref_id"])
        sent = {(r["user_id"], r["notice_id"]) for r in con.execute("SELECT user_id, notice_id FROM user_notices").fetchall()}
    if not active:
        return {"notices": 0, "students": 0, "sent": 0}

    deliveries = []
    students = student_profiles()
    # a student who tapped "Notify me" on an exam is told even before saving a profile
    have = {s["user_id"] for s in students}
    students += [{"user_id": uid} for uid in watching if uid not in have]
    for s in students:
        uid = s["user_id"]
        roadmap = roadmap_exams(d, s.get("roadmap_career"))
        watched = watching.get(uid, set())
        ok_schemes = None  # eligibility is only worked out when a scholarship notice needs it
        for n in active:
            if (uid, n["id"]) in sent:
                continue
            why = ref = None
            exams = json.loads(n["exams"] or "[]")
            hit = [e for e in exams if e in roadmap] or [e for e in exams if e in watched]
            if hit:
                why = "roadmap" if hit[0] in roadmap else "watching"
                ref = exam_names.get(hit[0], hit[0])
            else:
                schemes = json.loads(n["schemes"] or "[]")
                if schemes:
                    if ok_schemes is None:
                        ok_schemes = [e["id"] for e in engine.eligibility(d, clean_profile(s))
                                      if e["status"] in ("eligible", "eligible_missing_docs")]
                    both = [x for x in ok_schemes if x in schemes]
                    if both:
                        why, ref = "scheme", scheme_names.get(both[0], both[0])
            if why:
                deliveries.append((uid, n, why, ref))

    with db.connect() as con:
        for uid, n, why, ref in deliveries:
            con.execute("INSERT INTO user_notices (user_id, notice_id, why, ref, created_at) VALUES (?, ?, ?, ?, ?)",
                        (uid, n["id"], why, ref, now))
    for uid, n, why, ref in deliveries:
        src = SOURCE_BY_ID.get(n["source"], {})
        notify([uid], "notice", {"notice_id": n["id"], "title": n["title"], "url": n["url"], "source": src.get("short", n["source"]),
                                 "category": n["category"], "published": n["published"], "deadline": n["deadline"],
                                 "why": why, "why_ref": ref})
    return {"notices": len(active), "students": len({u for u, *_ in deliveries}), "sent": len(deliveries)}


def add_summaries(limit: int = SUMMARIES_PER_RUN) -> int:
    with db.connect() as con:
        rows = con.execute("SELECT id, title FROM notices WHERE summary IS NULL AND fresh = 1 AND hidden = 0 "
                           "ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    done = 0
    for r in rows:
        s = summarise(r["title"])
        with db.connect() as con:  # "{}" marks a title the AI could not translate safely, so it is not retried
            con.execute("UPDATE notices SET summary = ? WHERE id = ?", (json.dumps(s or {}, ensure_ascii=False), r["id"]))
        done += bool(s)
    return done


def run_steps(fetch: Callable[[str], str] = fetch_page, read: Callable[[str], dict] | None = None,
              summaries: bool = True) -> Iterator[dict]:
    """The whole watcher run as a stream of events (shown live on the teacher's screen)."""
    totals = {"new": 0, "fresh": 0}
    for src in SOURCES:
        yield {"type": "source_start", "source": src["id"], "name": src["short"]}
        try:
            res = check_source(src, fetch, read)
        except Exception as e:  # noqa: BLE001 - one bad source must not stop the others
            res = {"source": src["id"], "name": src["short"], "status": "error", "found": 0, "new": 0, "fresh": 0,
                   "error": f"{type(e).__name__}: {str(e)[:120]}"}
        totals["new"] += res["new"]
        totals["fresh"] += res["fresh"]
        yield {"type": "source_done", **res}
    yield {"type": "matching"}
    m = match_students()
    if summaries and totals["fresh"]:
        yield {"type": "translating"}
        add_summaries()
    yield {"type": "done", **totals, **m, "checked_at": int(time.time())}


def run_once(**kw) -> dict:
    last = {}
    for ev in run_steps(**kw):
        last = ev
    return last


_started = threading.Event()
_run_lock = threading.Lock()


def start_background(interval_hours: float | None = None) -> bool:
    """Read all sources every RAAH_NOTICES_INTERVAL_HOURS (default 6). 0 turns it off."""
    hours = float(os.environ.get("RAAH_NOTICES_INTERVAL_HOURS", "6")) if interval_hours is None else interval_hours
    if hours <= 0 or _started.is_set():
        return False
    _started.set()

    def loop() -> None:
        time.sleep(90)
        while True:
            if _run_lock.acquire(blocking=False):
                try:
                    run_once()
                except Exception:  # noqa: BLE001
                    pass
                finally:
                    _run_lock.release()
            time.sleep(hours * 3600)

    threading.Thread(target=loop, name="notice-watcher", daemon=True).start()
    return True


# ------------------------------------------------------------------ reading back

def source_status() -> list[dict]:
    try:
        with db.connect() as con:
            rows = _source_rows(con)
    except Exception:  # noqa: BLE001 - no database (MCP server run on its own)
        rows = {}
    return [{"id": s["id"], "name": s["name"], "short": s["short"], "url": s["url"],
             "status": rows.get(s["id"], {}).get("status"), "last_checked": rows.get(s["id"], {}).get("last_checked")}
            for s in SOURCES]


def _names() -> tuple[dict, dict]:
    d = dataset.get()
    return {e["id"]: e["name"] for e in d["exams"]}, {s["id"]: s["name"] for s in d["scholarships"]}


def serialise(r, today: date | None = None, names: tuple[dict, dict] | None = None) -> dict:
    today = today or date.today()
    exam_names, scheme_names = names or _names()
    src = SOURCE_BY_ID.get(r["source"], {})
    deadline = r["deadline"]
    days_left = (date.fromisoformat(deadline) - today).days if deadline else None
    return {"id": r["id"], "source": r["source"], "source_name": src.get("name", r["source"]), "source_short": src.get("short", r["source"]),
            "title": r["title"], "url": r["url"], "published": r["published"], "category": r["category"],
            "exams": [{"id": x, "name": exam_names.get(x, x)} for x in json.loads(r["exams"] or "[]")],
            "schemes": [{"id": x, "name": scheme_names.get(x, x)} for x in json.loads(r["schemes"] or "[]")][:5],
            "scheme_count": len(json.loads(r["schemes"] or "[]")),
            "dates": json.loads(r["dates"] or "[]"), "deadline": deadline, "days_left": days_left,
            "summary": json.loads(r["summary"]) if r["summary"] else None,
            "verified": r["verified_at"] is not None, "first_seen": r["first_seen"]}


def _order_key(n: dict):
    return (n["published"] or "", n["first_seen"])


def list_notices(tab: str, user_id: int | None, limit: int = 60) -> list[dict]:
    today, names = date.today(), _names()
    with db.connect() as con:
        if tab == "for_you":
            if not user_id:
                return []
            rows = con.execute("SELECT n.*, u.why, u.ref FROM notices n JOIN user_notices u ON u.notice_id = n.id "
                               "WHERE u.user_id = ? AND n.hidden = 0 ORDER BY u.id DESC LIMIT ?", (user_id, limit)).fetchall()
            return [{**serialise(r, today, names), "why": r["why"], "why_ref": r["ref"]} for r in rows]
        why = {}
        if user_id:
            why = {r["notice_id"]: (r["why"], r["ref"]) for r in
                   con.execute("SELECT notice_id, why, ref FROM user_notices WHERE user_id = ?", (user_id,)).fetchall()}
        if tab == "deadlines":
            rows = con.execute("SELECT * FROM notices WHERE hidden = 0 AND deadline IS NOT NULL AND deadline >= ? "
                               "ORDER BY deadline LIMIT ?", (today.isoformat(), limit)).fetchall()
            out = [serialise(r, today, names) for r in rows]
        else:
            rows = con.execute("SELECT * FROM notices WHERE hidden = 0 ORDER BY id DESC LIMIT 400").fetchall()
            out = sorted((serialise(r, today, names) for r in rows), key=_order_key, reverse=True)[:limit]
    for n in out:
        if n["id"] in why:
            n["why"], n["why_ref"] = why[n["id"]]
    return out


def search_notices(query: str = "", exam_id: str = "", scheme_id: str = "", limit: int = 8) -> list[dict]:
    """Stored notices whose title or tags match, newest first (for the Ask Raah agent)."""
    with db.connect() as con:
        rows = con.execute("SELECT * FROM notices WHERE hidden = 0 ORDER BY id DESC LIMIT 500").fetchall()
    out, names = [], _names()
    words = [w for w in re.findall(r"\w+", _normalise(query or "").lower()) if len(w) >= 3]
    for r in rows:
        n = serialise(r, names=names)
        if exam_id and exam_id.upper() not in {e["id"] for e in n["exams"]}:
            continue
        if scheme_id and scheme_id.upper() not in json.loads(r["schemes"] or "[]"):
            continue
        hay = _normalise(f"{n['title']} {n['source_short']} {n['source_name']} {n['category']} "
                         f"{' '.join(e['name'] for e in n['exams'])}").lower()
        if words and not any(w in hay for w in words):
            continue
        out.append(n)
    return sorted(out, key=_order_key, reverse=True)[:limit]


# ------------------------------------------------------------------ API

@router.get("")
def get_notices(tab: str = Query("all", pattern="^(all|deadlines|for_you)$"), user: dict = Depends(current_user)):
    items = list_notices(tab, user["id"])
    status = source_status()
    checked = [s["last_checked"] for s in status if s["last_checked"]]
    return {"tab": tab, "items": items, "sources": status, "last_checked": max(checked) if checked else None}


@router.get("/sources")
def get_sources(_: dict = Depends(current_user)):
    return source_status()


@router.post("/refresh")
def refresh(_: dict = Depends(teacher_only)):
    """Teacher's "Check official sites now": the run's steps stream as Server-Sent Events."""
    def stream():
        if not _run_lock.acquire(blocking=False):
            yield f"data: {json.dumps({'type': 'busy'})}\n\n"
            return
        try:
            for ev in run_steps():
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except Exception as e:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'error': f'{type(e).__name__}: {str(e)[:160]}'})}\n\n"
        finally:
            _run_lock.release()
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/teacher")
def teacher_notices(_: dict = Depends(teacher_only)):
    """Recent notices with how many students each was sent to, newest first."""
    with db.connect() as con:
        rows = con.execute("SELECT * FROM notices WHERE fresh = 1 ORDER BY id DESC LIMIT 60").fetchall()
        counts = {r["notice_id"]: r["n"] for r in
                  con.execute("SELECT notice_id, COUNT(*) AS n FROM user_notices GROUP BY notice_id").fetchall()}
    names = _names()
    out = [{**serialise(r, names=names), "students": counts.get(r["id"], 0), "hidden": bool(r["hidden"])} for r in rows]
    return {"items": sorted(out, key=_order_key, reverse=True), "sources": source_status()}


def _set(nid: int, sql: str, params: tuple) -> dict:
    with db.connect() as con:
        cur = con.execute(sql, params + (nid,))
    if not cur.rowcount:
        raise HTTPException(404, "No such notice")
    return {"id": nid, "updated": True}


@router.post("/{nid}/verify")
def verify(nid: int, user: dict = Depends(teacher_only)):
    return _set(nid, "UPDATE notices SET verified_at = ?, verified_by = ? WHERE id = ?", (int(time.time()), user["id"]))


@router.post("/{nid}/hide")
def hide(nid: int, _: dict = Depends(teacher_only)):
    return _set(nid, "UPDATE notices SET hidden = 1 WHERE id = ?", ())


@router.post("/{nid}/unhide")
def unhide(nid: int, _: dict = Depends(teacher_only)):
    return _set(nid, "UPDATE notices SET hidden = 0 WHERE id = ?", ())
