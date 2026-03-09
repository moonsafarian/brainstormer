"""Core meeting logic: urgency pass + response pass."""
from __future__ import annotations
import asyncio
import json
import re
from collections import Counter
from pathlib import Path
from typing import AsyncIterator, Optional

import yaml

from models import Contribution, Meeting, Participant, Turn, new_id
import openrouter
import tools as tools_module

# ── Load prompt templates from YAML files at startup ─────────────────────────
_PROMPTS_DIR = Path(__file__).parent / "prompts"

def _load_prompt(name: str) -> dict:
    with open(_PROMPTS_DIR / f"{name}.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)

_P_URGENCY = _load_prompt("urgency")
_P_RESPONSE = _load_prompt("response")
_P_REVIVAL = _load_prompt("revival")
_P_SUMMARY = _load_prompt("summary")


def _human_label(meeting: Meeting) -> str:
    return meeting.human_name if meeting.human_name else "Human"


def _format_transcript(meeting: Meeting, current_turn: Turn) -> str:
    """Format the full conversation so far as readable text."""
    lines: list[str] = [f"Meeting topic: {meeting.topic}\n"]
    human_label = _human_label(meeting)
    dnames = _display_names(meeting)

    for turn in meeting.turns:
        lines.append(f"=== Turn {turn.number} ===")
        if turn.human_message:
            lines.append(f"{human_label} said: {turn.human_message}")
        for c in turn.contributions:
            if c.did_speak and c.content:
                name = dnames.get(c.participant_id, c.participant_id)
                lines.append(f"{name} said: {c.content}")
        lines.append("")

    # Current turn so far
    lines.append(f"=== Turn {current_turn.number} (now) ===")
    if current_turn.human_message:
        lines.append(f"{human_label} said: {current_turn.human_message}")
    for c in current_turn.contributions:
        if c.did_speak and c.content:
            name = dnames.get(c.participant_id, c.participant_id)
            lines.append(f"{name} said: {c.content}")

    return "\n".join(lines)


def _participant_by_id(meeting: Meeting, pid: str) -> Optional[Participant]:
    return next((p for p in meeting.participants if p.id == pid), None)


def _display_names(meeting: Meeting) -> dict[str, str]:
    """Return a display name per participant, adding '#1'/'#2' etc. when names collide."""
    name_count = Counter(p.name for p in meeting.participants)
    counters: dict[str, int] = {}
    result: dict[str, str] = {}
    for p in meeting.participants:
        if name_count[p.name] > 1:
            counters[p.name] = counters.get(p.name, 0) + 1
            result[p.id] = f"{p.name} #{counters[p.name]}"
        else:
            result[p.id] = p.name
    return result


# ── Meeting liveliness constants ────────────────────────────────────────────
# Minimum turns before the meeting is allowed to end naturally.
_MIN_TURNS_BEFORE_END = 4
# Every participant must have contributed at least this many times.
_MIN_CONTRIBUTIONS_PER_PARTICIPANT = 2
# In turns 1…N, urgency scores are clamped to at least this value so
# participants can't all silently opt out before any real discussion happens.
_URGENCY_FLOOR_TURNS = 3
_URGENCY_FLOOR_VALUE = 6


def _participant_contribution_counts(meeting: Meeting) -> Counter[str]:
    """Return how many times each participant has spoken across all turns."""
    counts: Counter[str] = Counter()
    for turn in meeting.turns:
        for c in turn.contributions:
            if c.did_speak:
                counts[c.participant_id] += 1
    return counts


def _participants_who_spoke(meeting: Meeting) -> set[str]:
    """Return IDs of participants who have spoken at least once so far."""
    spoken: set[str] = set()
    for turn in meeting.turns:
        for c in turn.contributions:
            if c.did_speak:
                spoken.add(c.participant_id)
    return spoken


def _revival_response_messages(
    participant: Participant, meeting: Meeting, transcript: str
) -> list[dict]:
    """Messages for a participant forced to speak when the discussion stalls too early."""
    others = _other_participants_description(meeting, participant.id)
    display_name = _display_names(meeting)[participant.id]
    havent_spoken = participant.id not in _participants_who_spoke(meeting)
    reason = (
        _P_REVIVAL["reason_not_spoken"] if havent_spoken else _P_REVIVAL["reason_stalled"]
    )
    system = _P_REVIVAL["system"].format(
        display_name=display_name,
        participant_identity=_participant_identity(participant),
        others=others,
        meeting_topic=meeting.topic,
        reason=reason,
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": transcript},
    ]


def _participant_identity(p: Participant) -> str:
    lines = [f"Your persona: {p.persona.name} — {p.persona.description}"]
    if p.description:
        lines.append(f"Your background: {p.description}")
    return "\n".join(lines)


def _other_participants_description(meeting: Meeting, exclude_id: str) -> str:
    others = [p for p in meeting.participants if p.id != exclude_id]
    if not others:
        return "None"
    dnames = _display_names(meeting)
    parts = []
    for p in others:
        line = f"- {dnames[p.id]} ({p.persona.name}): {p.persona.description}"
        if p.description:
            line += f" | Background: {p.description}"
        parts.append(line)
    return "\n".join(parts)


def _urgency_messages(
    participant: Participant, transcript: str, display_name: str,
    turn_number: int, participant_spoke_count: int,
) -> list[dict]:
    # Assemble early_warning from YAML sub-templates
    parts: list[str] = []
    if turn_number <= _URGENCY_FLOOR_TURNS:
        parts.append(_P_URGENCY["early_warning_early_turn"].format(turn_number=turn_number))
    if participant_spoke_count == 0:
        parts.append(_P_URGENCY["early_warning_not_spoken"])
    elif participant_spoke_count < _MIN_CONTRIBUTIONS_PER_PARTICIPANT:
        parts.append(_P_URGENCY["early_warning_under_contributed"].format(spoke_count=participant_spoke_count))
    early_warning = "\n".join(parts)

    system = _P_URGENCY["system"].format(
        display_name=display_name,
        participant_identity=_participant_identity(participant),
        turn_number=turn_number,
        early_warning=early_warning,
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": transcript},
    ]


def _response_messages(
    participant: Participant, meeting: Meeting, transcript: str
) -> list[dict]:
    others = _other_participants_description(meeting, participant.id)
    display_name = _display_names(meeting)[participant.id]
    human_label = _human_label(meeting)
    human_line = (
        f"The human participant's name is {human_label}. Address them by name when responding to them.\n\n"
        if meeting.human_name
        else ""
    )
    system = _P_RESPONSE["system"].format(
        display_name=display_name,
        participant_identity=_participant_identity(participant),
        others=others,
        human_line=human_line,
        meeting_topic=meeting.topic,
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": transcript},
    ]


async def _agentic_response(
    participant: Participant,
    meeting: Meeting,
    transcript: str,
):
    """
    Agentic loop for web-enabled participants.
    Yields ("tool_use", {tool, input}) or ("chunk", text) tuples.
    Runs up to 3 tool-calling rounds, then streams the final text.
    """
    messages = _response_messages(participant, meeting, transcript)

    for _ in range(3):
        result = await openrouter.complete_with_tools(
            messages, participant.model_id, tools_module.TOOL_DEFINITIONS
        )
        choice = result["choices"][0]
        msg = choice["message"]
        tool_calls = msg.get("tool_calls") or []

        if not tool_calls:
            # No tools called — yield the content and exit
            content = msg.get("content") or ""
            if content:
                yield ("chunk", content)
            return

        # Add assistant's tool-call message to history
        messages.append({
            "role": "assistant",
            "content": msg.get("content") or "",
            "tool_calls": tool_calls,
        })

        # Execute each tool call
        for tc in tool_calls:
            fn_name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"])
            except json.JSONDecodeError:
                args = {}

            if fn_name == "search_web":
                query = args.get("query", "")
                yield ("tool_use", {"tool": "search_web", "input": query})
                result_text = await tools_module.search_web(query)
            elif fn_name == "fetch_url":
                url = args.get("url", "")
                yield ("tool_use", {"tool": "fetch_url", "input": url})
                result_text = await tools_module.fetch_url(url)
            else:
                result_text = f"Unknown tool: {fn_name}"

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": result_text,
            })

    # After 3 tool rounds, stream the final response
    async for chunk in openrouter.stream_completion(messages, participant.model_id):
        yield ("chunk", chunk)


def _last_messages_text(meeting: Meeting, human_message: Optional[str]) -> str:
    """Return the text of the most recent human message and last-turn contributions."""
    parts: list[str] = []
    if human_message:
        parts.append(human_message)
    if meeting.turns:
        for c in meeting.turns[-1].contributions:
            if c.did_speak and c.content:
                parts.append(c.content)
    return " ".join(parts)


async def _assess_urgency(
    participant: Participant, transcript: str, display_name: str,
    turn_number: int, spoke_count: int,
) -> dict:
    """Call the model for urgency score. Returns {participant_id, urgency, reason}."""
    try:
        result = await openrouter.complete(
            _urgency_messages(participant, transcript, display_name, turn_number, spoke_count),
            participant.model_id,
        )
        msg = result["choices"][0]["message"]
        raw = (msg.get("content") or msg.get("reasoning") or "").strip()
        # Extract JSON even if the model wraps it in markdown
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            parsed = json.loads(match.group())
            urgency = max(0, min(10, int(parsed.get("urgency", 0))))
            reason = str(parsed.get("reason", ""))
        else:
            urgency, reason = 0, f"Could not parse urgency response: {raw!r}"
            print(f"[urgency] {display_name}: parse failed — {raw!r}")
    except Exception as e:
        urgency, reason = 0, f"Error: {e}"
        print(f"[urgency] {display_name}: exception — {e}")

    return {"participant_id": participant.id, "urgency": urgency, "reason": reason}


async def run_turn(
    meeting: Meeting,
    human_message: Optional[str],
) -> AsyncIterator[str]:
    """
    Async generator that yields SSE-formatted strings for the entire turn.
    Runs urgency pass in parallel, then response pass sequentially in urgency order.
    """
    turn = Turn(id=new_id(), number=len(meeting.turns) + 1, human_message=human_message)
    transcript = _format_transcript(meeting, turn)
    dnames = _display_names(meeting)

    # ── 1. Urgency pass (all participants in parallel) ────────────────────────
    contrib_counts = _participant_contribution_counts(meeting)
    urgency_tasks = [
        _assess_urgency(p, transcript, dnames[p.id], turn.number, contrib_counts.get(p.id, 0))
        for p in meeting.participants
    ]
    urgency_results: list[dict] = await asyncio.gather(*urgency_tasks)

    # ── 1b. Deterministic addressing override ─────────────────────────────────
    recent_text = _last_messages_text(meeting, human_message).lower()
    for result in urgency_results:
        p = _participant_by_id(meeting, result["participant_id"])
        if p and dnames[p.id].lower() in recent_text and result["urgency"] < 9:
            print(f"[urgency] {dnames[p.id]}: addressed directly → overriding {result['urgency']} → 9")
            result["urgency"] = 9
            result["reason"] = "Directly addressed — must respond"

    # ── 1c. Early-turn urgency floor ──────────────────────────────────────────
    if turn.number <= _URGENCY_FLOOR_TURNS:
        for result in urgency_results:
            if result["urgency"] < _URGENCY_FLOOR_VALUE:
                print(f"[urgency] {result['participant_id']}: early-turn floor {result['urgency']} → {_URGENCY_FLOOR_VALUE}")
                result["urgency"] = _URGENCY_FLOOR_VALUE
                result["reason"] = f"Early turn ({turn.number}) — floor applied"

    for result in urgency_results:
        yield _sse("urgency", result)

    # ── 2. Filter and sort ────────────────────────────────────────────────────
    speaking: list[tuple[Participant, dict]] = [
        (p, r)
        for p, r in zip(meeting.participants, urgency_results)
        if r["urgency"] >= meeting.speaking_threshold
    ]
    speaking.sort(key=lambda x: x[1]["urgency"], reverse=True)

    spoken_ids: set[str] = set()

    # ── 3. Response pass (sequential, each sees earlier same-turn replies) ────
    for participant, urg in speaking:
        spoken_ids.add(participant.id)
        # Rebuild transcript to include contributions made so far this turn
        current_transcript = _format_transcript(meeting, turn)

        yield _sse("response_start", {
            "participant_id": participant.id,
            "name": dnames[participant.id],
            "urgency": urg["urgency"],
        })

        full_content = ""
        if participant.web_access:
            async for event_type, data in _agentic_response(
                participant, meeting, current_transcript
            ):
                if event_type == "tool_use":
                    yield _sse("tool_use", {"participant_id": participant.id, **data})
                else:
                    full_content += data
                    yield _sse("response_chunk", {"participant_id": participant.id, "chunk": data})
        else:
            async for chunk in openrouter.stream_completion(
                _response_messages(participant, meeting, current_transcript),
                participant.model_id,
            ):
                full_content += chunk
                yield _sse("response_chunk", {"participant_id": participant.id, "chunk": chunk})

        yield _sse("response_end", {"participant_id": participant.id})

        turn.contributions.append(Contribution(
            participant_id=participant.id,
            urgency=urg["urgency"],
            urgency_reason=urg["reason"],
            did_speak=True,
            content=full_content,
        ))

    # ── 4. Revival pass — if too few spoke and it's too early to end ─────────
    all_participant_ids = set(p.id for p in meeting.participants)
    # Update contribution counts with this turn's speakers
    updated_counts = Counter(contrib_counts)
    for pid in spoken_ids:
        updated_counts[pid] += 1
    # Check if any participant is under the minimum contribution threshold
    under_contributed = {
        pid for pid in all_participant_ids
        if updated_counts.get(pid, 0) < _MIN_CONTRIBUTIONS_PER_PARTICIPANT
    }
    too_early = (
        turn.number < _MIN_TURNS_BEFORE_END
        or bool(under_contributed)
    )
    # Revival triggers when nobody spoke, OR when very few spoke and it's too early
    needs_revival = too_early and (
        len(speaking) == 0
        or (len(speaking) <= 1 and turn.number <= _URGENCY_FLOOR_TURNS)
    )

    if needs_revival:
        # Prefer participants who are under-contributed and didn't speak this turn.
        # Fall back to anyone who didn't speak this turn, or everyone as last resort.
        revival_candidates = under_contributed - spoken_ids
        if not revival_candidates:
            revival_candidates = all_participant_ids - spoken_ids
        if not revival_candidates:
            revival_candidates = all_participant_ids
        revival_targets = [p for p in meeting.participants if p.id in revival_candidates]

        for participant in revival_targets:
            spoken_ids.add(participant.id)
            current_transcript = _format_transcript(meeting, turn)

            yield _sse("response_start", {
                "participant_id": participant.id,
                "name": dnames[participant.id],
                "urgency": 5,
            })

            full_content = ""
            async for chunk in openrouter.stream_completion(
                _revival_response_messages(participant, meeting, current_transcript),
                participant.model_id,
            ):
                full_content += chunk
                yield _sse("response_chunk", {"participant_id": participant.id, "chunk": chunk})

            yield _sse("response_end", {"participant_id": participant.id})

            turn.contributions.append(Contribution(
                participant_id=participant.id,
                urgency=5,
                urgency_reason="Revival: forced to speak — discussion ended too early",
                did_speak=True,
                content=full_content,
            ))

    # ── 5. Record silent participants ─────────────────────────────────────────
    for participant, urg in zip(meeting.participants, urgency_results):
        if participant.id not in spoken_ids:
            turn.contributions.append(Contribution(
                participant_id=participant.id,
                urgency=urg["urgency"],
                urgency_reason=urg["reason"],
                did_speak=False,
                content=None,
            ))

    meeting.turns.append(turn)

    # Only end if no one spoke (including revival) AND it's no longer too early
    meeting_ended = len(spoken_ids) == 0 and not too_early
    if meeting_ended:
        meeting.status = "ended"

    yield _sse("turn_complete", {
        "turn_number": turn.number,
        "meeting_ended": meeting_ended,
    })


async def generate_summary(meeting: Meeting) -> AsyncIterator[str]:
    """Stream the meeting summary."""
    transcript_lines: list[str] = [f"Topic: {meeting.topic}\n"]
    dnames = _display_names(meeting)
    human_label = _human_label(meeting)
    participant_list = ", ".join(
        f"{dnames[p.id]} ({p.persona.name})" for p in meeting.participants
    )

    for turn in meeting.turns:
        transcript_lines.append(f"--- Turn {turn.number} ---")
        if turn.human_message:
            transcript_lines.append(f"[{human_label}]: {turn.human_message}")
        for c in turn.contributions:
            if c.did_speak and c.content:
                p = _participant_by_id(meeting, c.participant_id)
                if p:
                    label = f"{dnames[p.id]} ({p.persona.name})"
                else:
                    label = c.participant_id
                transcript_lines.append(f"[{label}]: {c.content}")
        transcript_lines.append("")

    transcript = "\n".join(transcript_lines)

    _SUMMARY_MODEL_PREF = "openai/gpt-4o-mini"
    available = await openrouter.fetch_models()
    summarization_model = (openrouter.find_best_model(_SUMMARY_MODEL_PREF, available) or {}).get(
        "id", _SUMMARY_MODEL_PREF
    )
    print(f"[summary] using model={summarization_model!r}")

    messages = [
        {"role": "system", "content": _P_SUMMARY["system"]},
        {"role": "user", "content": _P_SUMMARY["user"].format(
            participant_list=participant_list,
            transcript=transcript,
        )},
    ]

    full_summary = ""
    async for chunk in openrouter.stream_completion(messages, summarization_model):
        full_summary += chunk
        yield _sse("summary_chunk", {"chunk": chunk})

    meeting.summary = full_summary
    meeting.status = "ended"
    yield _sse("summary_complete", {})


def _sse(event: str, data: dict) -> str:
    import json
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
