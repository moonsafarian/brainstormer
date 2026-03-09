from __future__ import annotations
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from models import (
    BUILT_IN_PERSONAS,
    CreateMeetingRequest,
    Meeting,
    Participant,
    Persona,
    ReopenRequest,
    SuggestParticipantsRequest,
    TurnRequest,
)
import openrouter
import meeting_engine

app = FastAPI(title="Brainstormer API")

# CORS — only needed for dev (Vite dev server on different port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Serve frontend build (production) ────────────────────────────────────────
_FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

# In-memory store (session-only)
meetings: dict[str, Meeting] = {}


async def _inject_key(x_api_key: str = Header(default="")) -> None:
    """Extract X-Api-Key header and make it available to openrouter calls."""
    if x_api_key:
        openrouter.set_request_api_key(x_api_key)


# ── Personas ──────────────────────────────────────────────────────────────────

@app.get("/api/personas")
def get_personas():
    return BUILT_IN_PERSONAS


# ── Models ────────────────────────────────────────────────────────────────────

@app.get("/api/models")
async def get_models(_: None = Depends(_inject_key)):
    try:
        models = await openrouter.fetch_models()
        return models
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Participant suggestions ───────────────────────────────────────────────────

@app.post("/api/suggest-participants")
async def suggest_participants(req: SuggestParticipantsRequest, _: None = Depends(_inject_key)):
    try:
        suggestions = await openrouter.suggest_participants(req.topic, BUILT_IN_PERSONAS, req.suggestion_model)
        return suggestions
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Meetings ──────────────────────────────────────────────────────────────────

@app.post("/api/meetings")
def create_meeting(req: CreateMeetingRequest) -> Meeting:
    persona_map = {p["id"]: p for p in BUILT_IN_PERSONAS}

    participants: list[Participant] = []
    for pc in req.participants:
        raw = persona_map.get(pc.persona_id)
        if not raw:
            raise HTTPException(status_code=400, detail=f"Unknown persona: {pc.persona_id}")
        participants.append(
            Participant(
                name=pc.name,
                model_id=pc.model_id,
                persona=Persona(**raw),
                description=pc.description or None,
                web_access=pc.web_access,
            )
        )

    meeting = Meeting(
        topic=req.topic,
        speaking_threshold=req.speaking_threshold,
        human_name=req.human_name or None,
        participants=participants,
    )
    meetings[meeting.id] = meeting
    return meeting


@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: str) -> Meeting:
    meeting = meetings.get(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


# ── Reopen ────────────────────────────────────────────────────────────────────

@app.post("/api/meetings/{meeting_id}/reopen")
def reopen_meeting(meeting_id: str, req: ReopenRequest) -> Meeting:
    meeting = meetings.get(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting.speaking_threshold = req.speaking_threshold
    meeting.status = "active"
    return meeting


# ── Turn ──────────────────────────────────────────────────────────────────────

@app.post("/api/meetings/{meeting_id}/turn")
async def run_turn(meeting_id: str, req: TurnRequest, _: None = Depends(_inject_key)):
    meeting = meetings.get(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if meeting.status != "active":
        raise HTTPException(status_code=400, detail="Meeting is not active")

    async def generate():
        async for chunk in meeting_engine.run_turn(meeting, req.human_message):
            yield chunk

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Summary ───────────────────────────────────────────────────────────────────

@app.post("/api/meetings/{meeting_id}/summary")
async def get_summary(meeting_id: str, _: None = Depends(_inject_key)):
    meeting = meetings.get(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    async def generate():
        async for chunk in meeting_engine.generate_summary(meeting):
            yield chunk

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Frontend static files (must be last — catch-all) ─────────────────────────

if _FRONTEND_DIST.is_dir():
    # Serve assets (JS, CSS, images) at /assets/
    app.mount("/assets", StaticFiles(directory=_FRONTEND_DIST / "assets"), name="assets")

    # SPA catch-all: any non-API route serves index.html
    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        # Try to serve the exact file first (favicon.ico, etc.)
        file_path = _FRONTEND_DIST / full_path
        if full_path and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(_FRONTEND_DIST / "index.html")
