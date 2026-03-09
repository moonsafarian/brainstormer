from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import uuid


BUILT_IN_PERSONAS: list[dict] = [
    {
        "id": "devils-advocate",
        "name": "Devil's Advocate",
        "description": "Challenges every assumption and argues the opposite position to stress-test ideas.",
        "is_built_in": True,
    },
    {
        "id": "pragmatist",
        "name": "Pragmatist",
        "description": "Focuses on what is practical, feasible, and achievable with current resources.",
        "is_built_in": True,
    },
    {
        "id": "visionary",
        "name": "Visionary",
        "description": "Thinks long-term and big-picture, explores ambitious possibilities and future scenarios.",
        "is_built_in": True,
    },
    {
        "id": "risk-analyst",
        "name": "Risk Analyst",
        "description": "Systematically identifies risks, failure modes, edge cases, and second-order consequences.",
        "is_built_in": True,
    },
    {
        "id": "optimist",
        "name": "Optimist",
        "description": "Looks for opportunities and positive outcomes, highlights what could go right.",
        "is_built_in": True,
    },
    {
        "id": "critic",
        "name": "Critic",
        "description": "Provides honest, direct criticism without sugar-coating. Values truth over comfort.",
        "is_built_in": True,
    },
    {
        "id": "mediator",
        "name": "Mediator",
        "description": "Synthesizes opposing views, finds common ground, and works toward consensus.",
        "is_built_in": True,
    },
    {
        "id": "domain-expert",
        "name": "Domain Expert",
        "description": "Brings deep knowledge of the relevant domain to bear, citing specifics and precedents.",
        "is_built_in": True,
    },
]


def new_id() -> str:
    return str(uuid.uuid4())


class Persona(BaseModel):
    id: str
    name: str
    description: str
    is_built_in: bool = True


class Participant(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    model_id: str
    persona: Persona
    description: Optional[str] = None  # extra background, knowledge, or traits
    web_access: bool = True


class Contribution(BaseModel):
    participant_id: str
    urgency: int
    urgency_reason: str
    did_speak: bool
    content: Optional[str] = None


class Turn(BaseModel):
    id: str = Field(default_factory=new_id)
    number: int
    human_message: Optional[str] = None
    contributions: list[Contribution] = []


class Meeting(BaseModel):
    id: str = Field(default_factory=new_id)
    topic: str
    speaking_threshold: int = 5
    human_name: Optional[str] = None
    participants: list[Participant] = []
    turns: list[Turn] = []
    summary: Optional[str] = None
    status: str = "active"
    reopened_count: int = 0
    reopened_at_turn: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.now)


# ── Request/response shapes ──────────────────────────────────────────────────

class ParticipantCreate(BaseModel):
    name: str
    model_id: str
    persona_id: str
    description: Optional[str] = None
    web_access: bool = False


class CreateMeetingRequest(BaseModel):
    topic: str
    speaking_threshold: int = 5
    human_name: Optional[str] = None
    participants: list[ParticipantCreate]


class TurnRequest(BaseModel):
    human_message: Optional[str] = None


class ReopenRequest(BaseModel):
    speaking_threshold: int


class SuggestParticipantsRequest(BaseModel):
    topic: str
    suggestion_model: Optional[str] = None
