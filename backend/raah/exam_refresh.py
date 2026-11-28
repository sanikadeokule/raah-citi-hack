"""Exam dates refresh: a cron job that keeps the Exams sheet of raah-dataset.xlsx up to date.

    fetch -> extract -> model_fill -> verify   (one run per exam), then one write to the workbook

For each exam the job reads the pages named in the sheet itself (the 'Official site' cell first, then the 'Source' cell,
never a hardcoded address), finds the lines about this exam that carry a date, and works out the next application
opening, the application deadline and the exam date. Rules do the reading; when they leave a gap and a model is
reachable, the model may point at a line, and the verify step keeps its answer only if that exact date is printed in
that exact line. Only upcoming dates are kept.

The result goes into its own columns of the Exams sheet (Applications open, Applications close, Exam date, Dates evidence,
Dates found on, Dates auto-checked), with the published line kept as evidence. The hand-written 'Last cycle dates' cell is
never touched. A page that cannot be read leaves the row as it was. The workbook is saved to a temp file and swapped in,
so the app (which reloads the sheet when the file changes) never sees half a file.

Run it by hand:   python -m raah.exam_refresh            (dry run, prints what it would change)
                  python -m raah.exam_refresh --write    (writes raah-dataset.xlsx)
In the server it runs every RAAH_REFRESH_INTERVAL_HOURS (default 24, 0 = off), like the exam watcher.
"""
from __future__ import annotations

import argparse
import json
import operator
import os
import re
import tempfile
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Callable, TypedDict

from . import dataset

COLUMNS = {
    "open": "Applications open",
    "close": "Applications close",
    "exam": "Exam date",
    "evidence": "Dates evidence",
    "found_on": "Dates found on",
    "checked": "Dates auto-checked",
}
FIELDS = ("open", "close", "exam")
HORIZON_DAYS = 730  # a date more than two years out is a typo or an old archive page, not the next cycle

_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*"
_ORD = r"(?:st|nd|rd|th)?"
_SEP = r"\s*(?:-|–|—|to|till|until)\s*"
RANGE_TXT = re.compile(
    rf"\b(\d{{1,2}}){_ORD}(?:[\s\-]+({_MONTH})\.?)?(?:,?\s+(\d{{4}}))?{_SEP}(\d{{1,2}}){_ORD}[\s\-]+({_MONTH})\.?,?[\s\-]+(\d{{4}})\b",
    re.I)
RANGE_MDY = re.compile(
    rf"\b({_MONTH})\.?\s+(\d{{1,2}}){_ORD}(?:,?\s+(\d{{4}}))?{_SEP}(?:({_MONTH})\.?\s+)?(\d{{1,2}}){_ORD},?\s+(\d{{4}})\b", re.I)
# 'January 20, 21, 22 and 28, 2027' / 'April 2,3,4 and 7 2027' / '20, 21 and 24 Jan 2027': a list of exam days, first day kept
LIST_MDY = re.compile(rf"\b({_MONTH})\.?\s+(\d{{1,2}})(?:\s*,\s*\d{{1,2}})*(?:,?\s*and\s+\d{{1,2}}),?\s+(\d{{4}})\b", re.I)
LIST_DMY = re.compile(rf"\b(\d{{1,2}})(?:\s*,\s*\d{{1,2}})*(?:,?\s*and\s+\d{{1,2}})\s+({_MONTH})\.?,?\s+(\d{{4}})\b", re.I)
RANGE_NUM = re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})" + _SEP + r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b", re.I)
SINGLE_PATTERNS = (
    ("dmy_num", re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b")),
    ("dmy_txt", re.compile(rf"\b(\d{{1,2}}){_ORD}[\s\-]+({_MONTH})\.?,?[\s\-]+(\d{{4}})\b", re.I)),
    ("mdy_txt", re.compile(rf"\b({_MONTH})\.?\s+(\d{{1,2}}){_ORD},?\s+(\d{{4}})\b", re.I)),
)
CLOSE_RE = re.compile(r"last\s+date|deadline|clos(?:e|es|ed|ing)|\bends?\b|end\s+date|\btill\b|\buntil\b|extended", re.I)
OPEN_RE = re.compile(r"start(?:s|ed|ing)?|begin(?:s|ning)?|\bopen(?:s|ed|ing)?\b|commenc|\bfrom\b|launch", re.I)
APP_RE = re.compile(r"registration|regist|apply|application|online\s+form|form\s+filling|submission", re.I)
SKIP_RE = re.compile(r"correction|admit\s+card|hall\s+ticket|city\s+intimation|answer\s+key|result|late\s+fee|notification\s*$|"
                     r"published|uploaded|posted", re.I)
EXAM_TAIL_RE = re.compile(r"\b(?:exam|examination|test|cbt)\s*[:\-–]?\s*(?:on\s+)?$|\b(?:held|conducted|scheduled)\s+(?:on|from|for)?\s*$", re.I)
EXAM_RE = re.compile(
    r"exam(?:ination)?\s+date|date\s+of\s+(?:the\s+)?(?:exam|examination|test)|test\s+date|exam(?:ination)?\s+(?:will\s+be\s+|to\s+be\s+|is\s+)?"
    r"(?:held|conducted|scheduled)|exam(?:ination)?\s+on\b|exam(?:ination)?\s*:|\bcbt\b|written\s+(?:exam|test)|test\s+on\b|\bexam\s+in\b", re.I)


def _month(m: str) -> int:
    return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].index(m[:3].lower()) + 1


def _mk(y, m, d) -> date | None:
    try:
        return date(int(y), int(m), int(d))
    except (TypeError, ValueError):
        return None


def date_mentions(line: str) -> list[dict]:
    """Every date in a line that names a year, in order: {'start', 'end', 'pos', 'stop'}; end is set for a range
    such as '24 Jan-24 Feb 2026' or '2-22 Dec 2026'. Numbers are day-first, as on Indian sites."""
    found, taken = [], []

    def free(a, b):
        return all(b <= s or a >= e for s, e in taken)

    for m in RANGE_TXT.finditer(line):
        d1, m1, y1, d2, m2, y2 = m.groups()
        end = _mk(y2, _month(m2), d2)
        start = _mk(y1 or y2, _month(m1 or m2), d1)
        if start and end and start > end and not y1:  # '26 Dec-25 Jan 2027' crosses a year
            start = _mk(int(y2) - 1, _month(m1 or m2), d1)
        if start and end and start <= end:
            found.append({"start": start, "end": end, "pos": m.start(), "stop": m.end()})
            taken.append(m.span())
    for m in RANGE_MDY.finditer(line):
        if not free(*m.span()):
            continue
        m1, d1, y1, m2, d2, y2 = m.groups()
        end = _mk(y2, _month(m2 or m1), d2)
        start = _mk(y1 or y2, _month(m1), d1)
        if start and end and start > end and not y1:
            start = _mk(int(y2) - 1, _month(m1), d1)
        if start and end and start <= end:
            found.append({"start": start, "end": end, "pos": m.start(), "stop": m.end()})
            taken.append(m.span())
    for rx, order in ((LIST_MDY, "mdy"), (LIST_DMY, "dmy")):
        for m in rx.finditer(line):
            if not free(*m.span()):
                continue
            a, b, y = m.groups()
            d = _mk(y, _month(a), b) if order == "mdy" else _mk(y, _month(b), a)
            if d:
                found.append({"start": d, "end": None, "pos": m.start(), "stop": m.end()})
                taken.append(m.span())
    for m in RANGE_NUM.finditer(line):
        if not free(*m.span()):
            continue
        d1, m1, y1, d2, m2, y2 = m.groups()
        start, end = _mk(y1, m1, d1), _mk(y2, m2, d2)
        if start and end and start <= end:
            found.append({"start": start, "end": end, "pos": m.start(), "stop": m.end()})
            taken.append(m.span())
    for kind, rx in SINGLE_PATTERNS:
        for m in rx.finditer(line):
            if not free(*m.span()):
                continue
            g = m.groups()
            d = _mk(g[2], g[1], g[0]) if kind == "dmy_num" else _mk(g[2], _month(g[1]), g[0]) if kind == "dmy_txt" else _mk(g[2], _month(g[0]), g[1])
            if d:
                found.append({"start": d, "end": None, "pos": m.start(), "stop": m.end()})
                taken.append(m.span())
    return sorted(found, key=lambda x: x["pos"])


def classify(line: str) -> list[tuple[str, date]]:
    """(field, date) pairs a line states. Each date is read with the words between it and the date before it, so
    'Registration 2-22 Dec 2026; exam on 11 Apr 2027' gives open, close and exam. A date with no telling word is skipped."""
    out, prev = [], 0
    for d in date_mentions(line):
        window = line[prev:d["pos"]]
        prev = d["stop"]
        if SKIP_RE.search(window):  # correction windows, admit cards, results: dates, but not the ones we keep
            continue
        is_app, is_close, is_open, is_exam = (bool(rx.search(window)) for rx in (APP_RE, CLOSE_RE, OPEN_RE, EXAM_RE))
        is_exam = is_exam or bool(EXAM_TAIL_RE.search(window))
        if d["end"]:  # a range
            if is_exam and not is_app:
                out.append(("exam", d["start"]))
            elif is_app or is_open or is_close:
                out += [("open", d["start"]), ("close", d["end"])]
        elif is_close and (is_app or not is_exam):
            out.append(("close", d["start"]))
        elif is_exam:
            out.append(("exam", d["start"]))
        elif is_open and is_app:
            out.append(("open", d["start"]))
    return out


def _relevant(line: str, exam: dict) -> bool:
    from .watcher import is_relevant  # same rule as the exam watcher: shared sites only count lines naming this exam
    return is_relevant(line, exam)


def pick(found: list[dict], today: date) -> dict:
    """The next cycle's dates: the earliest upcoming value per field, with the deadline after the opening."""
    limit = today + timedelta(days=HORIZON_DAYS)
    up = [f for f in found if today <= f["date"] <= limit]
    best: dict = {}
    for field in FIELDS:
        cands = sorted((f for f in up if f["field"] == field), key=lambda f: f["date"])
        if field == "close" and "open" in best:
            cands = [f for f in cands if f["date"] >= best["open"]["date"]] or cands
        if cands:
            best[field] = cands[0]
    return best


# ------------------------------------------------------------------ the graph

class Refresh(TypedDict, total=False):
    exam: dict
    today: date
    lines: list           # [{"url", "line"}] relevant dated lines from the pages
    errors: list
    found: list           # [{"field", "date", "line", "url", "by"}]
    best: dict
    mode: str
    trace: Annotated[list, operator.add]


def make_graph(fetch: Callable[[str], str], use_model: bool = True):
    from langgraph.graph import END, START, StateGraph

    from .watcher import page_lines

    def fetch_node(state: Refresh) -> dict:
        exam, lines, errors = state["exam"], [], []
        site = exam.get("site")
        queue, seen = page_urls(exam), set()
        while queue:
            url = queue.pop(0)
            if url in seen:
                continue
            seen.add(url)
            try:
                markup = fetch(url)
                for ln in page_lines(markup):
                    if date_mentions(ln) and _relevant(ln, exam):
                        lines.append({"url": url, "line": ln})
                if url == site:  # follow the official home page's notices once, one level deep
                    queue[:0] = [u for u in notice_links(markup, url, exam) if u not in seen]
            except Exception as exc:  # a government site being down is routine
                errors.append(f"{url}: {type(exc).__name__}")
        return {"lines": lines, "errors": errors, "trace": [f"fetch: {len(lines)} dated lines, {len(errors)} pages failed"]}

    def extract(state: Refresh) -> dict:
        found = [{"field": f, "date": d, "line": x["line"], "url": x["url"], "by": "rule"}
                 for x in state["lines"] for f, d in classify(x["line"])]
        best = pick(found, state["today"])
        return {"found": found, "best": best, "mode": "rule", "trace": [f"extract: {len(found)} dates read, next cycle {sorted(best)}"]}

    def model_fill(state: Refresh) -> dict:
        """Only for gaps the rules left, and only if a model answers. Its picks still go through verify."""
        gaps = [f for f in FIELDS if f not in state["best"]]
        upcoming = [x for x in state["lines"] if any(m["start"] >= state["today"] or (m["end"] and m["end"] >= state["today"])
                                                       for m in date_mentions(x["line"]))][:40]
        if not use_model or not gaps or not upcoming:
            return {"trace": ["model_fill: skipped"]}
        from . import llm
        numbered = "\n".join(f"{i}. {x['line']}" for i, x in enumerate(upcoming))
        prompt = (f"Lines published about {state['exam']['name']} (today is {state['today'].isoformat()}):\n{numbered}\n\n"
                  f"Find the next {', '.join(gaps)} date(s). open = applications open, close = last date to apply, exam = exam date. "
                  'Reply with JSON only, e.g. {"close": {"date": "YYYY-MM-DD", "line": 3}}. Leave out anything the lines do not state.')
        try:
            text, _ = llm.chat([{"role": "system", "content": "You read Indian exam notices. Never invent a date."},
                                {"role": "user", "content": prompt}], json_mode=True, max_tokens=200)
            picks = llm.parse_json(text)
        except Exception:
            return {"trace": ["model_fill: no model"]}
        found = []
        for f in gaps:
            p = picks.get(f) if isinstance(picks, dict) else None
            if not isinstance(p, dict):
                continue
            try:
                d, x = date.fromisoformat(str(p.get("date"))), upcoming[int(p.get("line"))]
            except (ValueError, TypeError, IndexError):
                continue
            found.append({"field": f, "date": d, "line": x["line"], "url": x["url"], "by": "model"})
        return {"found": state["found"] + found, "trace": [f"model_fill: {len(found)} suggested"]}

    def verify(state: Refresh) -> dict:
        """A model pick stays only if its date is printed in the line it points at (rule picks are read from the line already)."""
        kept, dropped = [], 0
        for f in state["found"]:
            if f["by"] == "model":
                printed = {m["start"] for m in date_mentions(f["line"])} | {m["end"] for m in date_mentions(f["line"]) if m["end"]}
                if f["date"] not in printed:
                    dropped += 1
                    continue
            kept.append(f)
        best = pick(kept, state["today"])
        mode = "model" if any(b["by"] == "model" for b in best.values()) else "rule"
        return {"found": kept, "best": best, "mode": mode, "trace": [f"verify: {dropped} model picks dropped"]}

    g = StateGraph(Refresh)
    for name, fn in (("fetch", fetch_node), ("extract", extract), ("model_fill", model_fill), ("verify", verify)):
        g.add_node(name, fn)
    g.add_edge(START, "fetch")
    g.add_edge("fetch", "extract")
    g.add_edge("extract", "model_fill")
    g.add_edge("model_fill", "verify")
    g.add_edge("verify", END)
    return g.compile()


def fetch_page(url: str) -> str:
    """The page as HTML. Official notices are often PDFs: their text comes back as one paragraph per line."""
    import httpx
    r = httpx.get(url, follow_redirects=True, timeout=30, headers={"User-Agent": "RaahDatesRefresh/0.1 (student exam dates)"})
    r.raise_for_status()
    if r.content[:5] == b"%PDF-" or "pdf" in r.headers.get("content-type", ""):
        return pdf_as_html(r.content)
    return r.text


def pdf_as_html(data: bytes, max_pages: int = 30) -> str:
    import html
    import io

    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    lines = []
    for pg in reader.pages[:max_pages]:
        lines += (pg.extract_text() or "").splitlines()
    return "<html><body>" + "".join(f"<p>{html.escape(ln)}</p>" for ln in lines if ln.strip()) + "</body></html>"


NOTICE_RE = re.compile(r"important\s+dates|schedule|public\s+notice|notice|notification|information\s+bulletin|bulletin|brochure|"
                       r"advertisement|advt|calendar|time\s*table|registration|application\s+form|apply\s+online", re.I)
MAX_LINKS = 4  # notices a site's home page links to; the dates usually live there, not on the home page


def notice_links(markup: str, base: str, exam: dict) -> list[str]:
    """Links on an official page that look like a notice for this exam (schedule, bulletin, notification...), same site only."""
    from urllib.parse import urljoin, urlparse

    from lxml import html as lxml_html
    try:
        tree = lxml_html.fromstring(markup)
    except Exception:
        return []
    host = urlparse(base).hostname or ""
    root = ".".join(host.split(".")[-3:])  # nta.nic.in, mahacet.org ...: notices often sit on a sister subdomain
    out = []
    for a in tree.iter("a"):
        text, href = re.sub(r"\s+", " ", a.text_content() or "").strip(), a.get("href") or ""
        if not href or href.startswith(("#", "mailto:", "javascript:")) or not NOTICE_RE.search(text + " " + href):
            continue
        url = urljoin(base, href)
        h = urlparse(url).hostname or ""
        if url.startswith("http") and (h == host or h.endswith("." + root) or h == root) and _relevant(text or href, exam):
            out.append(url)
    return list(dict.fromkeys(out))[:MAX_LINKS]


def page_urls(exam: dict) -> list[str]:
    """The official site first, then every address in the Source cell (some cells list two, split by ';')."""
    urls = re.findall(r"https?://[^\s;|,]+", " ".join(str(exam.get(k) or "") for k in ("site", "source")))
    return list(dict.fromkeys(u.rstrip(".)") for u in urls))


# ------------------------------------------------------------------ writing the workbook

def _cell_date(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v).strip()[:10]) if v not in (None, "") else None
    except ValueError:
        return None


def write_sheet(results: list[dict], path: Path, today: date, mtime: float | None = None, save: bool = True) -> list[dict]:
    """Write each exam's next dates into the Exams sheet. Returns the cell changes. A stored date is replaced only by a
    different upcoming date the pages printed; nothing is cleared because a page was down or said nothing."""
    import openpyxl

    mtime = path.stat().st_mtime if mtime is None else mtime
    wb = openpyxl.load_workbook(path)
    ws = wb["Exams"]
    head = {str(c.value).strip(): c.column for c in ws[1] if c.value is not None}
    for key in COLUMNS.values():
        if key not in head:
            col = ws.max_column + 1
            ws.cell(row=1, column=col, value=key)
            head[key] = col
    rows = {str(ws.cell(row=r, column=head["ID"]).value).strip(): r for r in range(2, ws.max_row + 1)
            if ws.cell(row=r, column=head["ID"]).value}
    changes = []
    for res in results:
        r = rows.get(res["exam"])
        if r is None or res["status"] == "error":
            continue
        best, evidence, url = res.get("best") or {}, [], None
        for field in FIELDS:
            if field not in best:
                continue
            b = best[field]
            cell = ws.cell(row=r, column=head[COLUMNS[field]])
            if _cell_date(cell.value) != b["date"]:
                changes.append({"exam": res["exam"], "field": field, "old": str(cell.value or ""), "new": b["date"].isoformat()})
                cell.value = b["date"].isoformat()
            if b["line"] not in evidence:
                evidence.append(b["line"])
            url = url or b["url"]
        if evidence:
            ws.cell(row=r, column=head[COLUMNS["evidence"]], value=" | ".join(evidence)[:600])
            ws.cell(row=r, column=head[COLUMNS["found_on"]], value=url)
        ws.cell(row=r, column=head[COLUMNS["checked"]], value=today.isoformat())
    if not save:
        return changes

    if path.stat().st_mtime != mtime:  # someone saved the workbook while we were reading the sites: keep their edit
        raise RuntimeError("raah-dataset.xlsx changed during the refresh; run again")
    fd, tmp = tempfile.mkstemp(prefix=".raah-dataset-", suffix=".xlsx", dir=str(path.parent))
    os.close(fd)
    try:
        wb.save(tmp)
        os.replace(tmp, path)  # fails on Windows while Excel has the file open; the next run will catch up
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return changes


# ------------------------------------------------------------------ running it

_run_lock = threading.Lock()
last_run: dict = {}


def refresh(fetch: Callable[[str], str] | None = None, write: bool = True, path: Path | None = None,
            today: date | None = None, use_model: bool = True, only: list[str] | None = None) -> dict:
    path = Path(path or dataset.DATASET_PATH)
    today = today or date.today()
    graph = make_graph(fetch or fetch_page, use_model=use_model)
    results = []
    with _run_lock:
        mtime = path.stat().st_mtime
        exams = [e for e in dataset.load(path)["exams"] if not only or e["id"] in only]
        for exam in exams:
            out = graph.invoke({"exam": exam, "today": today, "trace": []})
            readable = bool(out["lines"]) or len(out["errors"]) < len(page_urls(exam))
            results.append({"exam": exam["id"], "name": exam["name"], "best": out["best"], "mode": out["mode"],
                            "status": "error" if not readable else ("found" if out["best"] else "nothing new"),
                            "errors": out["errors"], "trace": out["trace"]})
        changes = write_sheet(results, path, today, mtime=mtime, save=write)
        summary = {"ran_at": datetime.now().isoformat(timespec="seconds"), "written": write, "changes": changes,
                   "results": [{**r, "best": {f: {"date": b["date"].isoformat(), "line": b["line"], "url": b["url"], "by": b["by"]}
                                              for f, b in r["best"].items()}} for r in results]}
        last_run.clear()
        last_run.update(summary)
    return summary


_started = threading.Event()


def start_background(interval_hours: float | None = None) -> bool:
    """Start the refresh thread once. RAAH_REFRESH_INTERVAL_HOURS=0 turns it off (default 24)."""
    hours = float(os.environ.get("RAAH_REFRESH_INTERVAL_HOURS", "24")) if interval_hours is None else interval_hours
    if hours <= 0 or _started.is_set():
        return False
    _started.set()

    def loop() -> None:
        time.sleep(300)  # let the server settle and the watcher take its first look
        while True:
            try:
                refresh()
            except Exception as exc:
                last_run.update({"ran_at": datetime.now().isoformat(timespec="seconds"), "error": f"{type(exc).__name__}: {exc}"[:300]})
            time.sleep(hours * 3600)

    threading.Thread(target=loop, name="exam-refresh", daemon=True).start()
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Refresh exam dates in raah-dataset.xlsx from the sites the Exams sheet names.")
    ap.add_argument("--write", action="store_true", help="save the changes (default: dry run)")
    ap.add_argument("--no-model", action="store_true", help="rules only, never ask a model")
    ap.add_argument("--exam", action="append", help="only this exam ID (repeatable)")
    ap.add_argument("--json", action="store_true", help="print the full result as JSON")
    a = ap.parse_args(argv)
    out = refresh(write=a.write, use_model=not a.no_model, only=a.exam)
    if a.json:
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0
    for r in out["results"]:
        dates = ", ".join(f"{f} {b['date']}" for f, b in r["best"].items()) or "-"
        print(f"{r['exam']:5} {r['status']:12} {dates}{'  (' + '; '.join(r['errors']) + ')' if r['errors'] else ''}")
    print(f"\n{len(out['changes'])} cell(s) {'written' if a.write else 'would change (dry run, add --write)'}")
    for c in out["changes"]:
        print(f"  {c['exam']} {c['field']}: {c['old'] or '(empty)'} -> {c['new']}")
    return 0


def _router():
    from fastapi import APIRouter, Depends

    from .auth import teacher_only

    r = APIRouter(prefix="/api/refresh", tags=["exam dates refresh"])

    @r.post("/exams")
    def run_now(write: bool = True, _: dict = Depends(teacher_only)):
        return refresh(write=write)

    @r.get("/exams")
    def status(_: dict = Depends(teacher_only)):
        return last_run or {"ran_at": None}

    return r


router = _router()


if __name__ == "__main__":
    raise SystemExit(main())
