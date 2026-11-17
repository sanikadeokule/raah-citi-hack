"""Raah API (FastAPI). Run:  uvicorn raah.main:app --reload --port 8000

All numbers come from raah-dataset.xlsx through dataset.get(), which re-reads
the workbook whenever the file's modified time changes.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import dataset, engine
from .auth import current_user, log_sync, save_profile
from .auth import router as auth_router
from .chat import router as chat_router
from .embed import router as embed_router
from .mentors import router as mentors_router
from .modules import router as modules_router
from .money import router as money_router
from .partners import router as partners_router
from .rag import router as rag_router
from .rag import warm as rag_warm
from .teacher import router as teacher_router
from .voice import router as voice_router

app = FastAPI(
    title="Raah API",
    version="0.1.0",
    description="Career, cost & payback, eligibility and money-layer APIs for Raah. "
                "Every figure is read from raah-dataset.xlsx; the AI explains, the data decides.",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _connect_database() -> None:
    """Fail at start with a clear message if PostgreSQL is not set up, instead of on the first sign-in."""
    from . import db
    db.engine()


class Profile(BaseModel):
    name: str | None = None
    age: float | None = None
    gender: str | None = "F"
    class_: float | None = Field(None, alias="class")
    taluka: str | None = None
    lat: float | None = None
    lon: float | None = None
    language: str | None = "en"
    marks_pct: float | None = None
    interests: list[str] = []
    category: str | None = None
    family_income_annual: float | None = None
    max_commute_km: float | None = None
    can_stay_hostel: bool | None = None
    school_type: str | None = None
    domicile: str | None = None
    documents: list[str] = []
    has_bank_account: bool | None = None
    exams_passed: list[str] = []
    disability_pct: float | None = None
    class12_percentile: float | None = None
    class12_top1pct: bool | None = None
    parent_hazardous_occupation: bool | None = None

    model_config = {"populate_by_name": True, "extra": "allow"}

    def as_dict(self) -> dict:
        return self.model_dump(by_alias=True)


class PlanRequest(BaseModel):
    profile: Profile
    plan_id: str
    options: dict[str, Any] = {}


class EligibilityRequest(BaseModel):
    profile: Profile
    plan_id: str | None = None
    hostel: bool | None = None


def data() -> dict:
    return dataset.get()


@app.get("/api/version", tags=["data"])
def version():
    """Cheap check the app polls to notice that the spreadsheet was saved."""
    return data()["version"]


@app.get("/api/data", tags=["data"])
def get_data(request: Request, response: Response):
    """The whole parsed dataset. The browser caches it for offline use."""
    d = data()
    etag = '"' + d["version"]["modified"] + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "no-cache"
    return {k: v for k, v in d.items() if not k.startswith("_")}


@app.post("/api/plan", tags=["student"])
def plan(req: PlanRequest):
    d = data()
    if not any(p["id"] == req.plan_id for p in d["plans"]):
        raise HTTPException(404, f"plan {req.plan_id} not in Plan_Inputs")
    return engine.compute_plan(d, req.profile.as_dict(), req.plan_id, req.options)


@app.post("/api/eligibility", tags=["student"])
def eligibility(req: EligibilityRequest):
    d = data()
    plan = next((p for p in d["plans"] if p["id"] == req.plan_id), None) if req.plan_id else None
    return engine.eligibility(d, req.profile.as_dict(), plan, req.hostel)


@app.post("/api/careers", tags=["student"])
def careers(profile: Profile, n: int = 5):
    return engine.rank_careers(data(), profile.as_dict(), n)


@app.post("/api/roadmap", tags=["student"])
def roadmap(profile: Profile, career_id: str, start_class: int | None = None):
    """Every step from the student's class to the first job, with fees, scholarships, stipends and pay."""
    r = engine.build_roadmap(data(), profile.as_dict(), career_id, start_class)
    if r is None:
        raise HTTPException(404, f"career {career_id} not in Careers_Income")
    return r


@app.post("/api/centres", tags=["student"])
def centres(profile: Profile, centre_type: str | None = None, n: int = 3):
    return engine.nearest_centres(data(), profile.as_dict(), centre_type, n)


@app.post("/api/sync", tags=["data"])
def sync(items: list[dict], user: dict = Depends(current_user)):
    """Receives actions queued while the phone was offline (quiz answers, profile edits, consents)."""
    log_sync(user["id"], items)
    profiles = [i["payload"] for i in items if i.get("kind") == "profile" and isinstance(i.get("payload"), dict)]
    if profiles:
        save_profile(user["id"], profiles[-1])
    return {"received": len(items)}


app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(embed_router)
app.include_router(voice_router)
app.include_router(teacher_router)
app.include_router(money_router)
app.include_router(mentors_router)
app.include_router(modules_router)
app.include_router(partners_router)
app.include_router(rag_router)

if os.environ.get("RAG_WARM", "1") == "1":
    rag_warm()  # build and embed the Ask Raah index in the background

# ------------------------------------------------------------------ static web app (Next.js export)
WEB_OUT = Path(os.environ.get("RAAH_WEB_OUT", Path(__file__).resolve().parents[2] / "web" / "out"))
if WEB_OUT.exists():
    app.mount("/_next", StaticFiles(directory=WEB_OUT / "_next"), name="next")

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def spa(path: str):
        for cand in (WEB_OUT / path, WEB_OUT / f"{path}.html", WEB_OUT / path / "index.html"):
            if cand.is_file():
                return FileResponse(cand)
        return FileResponse(WEB_OUT / "index.html")
