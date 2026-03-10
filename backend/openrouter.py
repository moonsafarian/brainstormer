"""OpenRouter API client."""
from __future__ import annotations
import os
import re
import json
import httpx
from contextvars import ContextVar
from typing import AsyncIterator

BASE_URL = "https://openrouter.ai/api/v1"
HEADERS = {
    "HTTP-Referer": "https://brainstormer.local",
    "X-Title": "Brainstormer",
}

# Per-request API key override (set from the X-Api-Key request header).
# Falls back to the OPENROUTER_API_KEY env variable when not set.
_request_key: ContextVar[str] = ContextVar("request_key", default="")


def set_request_api_key(key: str) -> None:
    _request_key.set(key)


def _api_key() -> str:
    key = _request_key.get() or os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        raise RuntimeError(
            "No OpenRouter API key found. Set OPENROUTER_API_KEY in the environment "
            "or provide your key via the settings panel."
        )
    return key


async def fetch_models() -> list[dict]:
    """Return all available OpenRouter models."""
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{BASE_URL}/models",
            headers={**HEADERS, "Authorization": f"Bearer {_api_key()}"},
            timeout=20,
        )
        r.raise_for_status()
        data = r.json()
        models = data.get("data", [])
        return [
            {
                "id": m["id"],
                "name": m.get("name", m["id"]),
                "context_length": m.get("context_length"),
                "pricing": m.get("pricing", {}),
            }
            for m in models
        ]


async def complete(
    messages: list[dict],
    model_id: str,
    max_tokens: int = 100,
    temperature: float = 0.3,
    timeout: float = 45,
) -> dict:
    """Non-streaming completion — used for urgency assessment and structured outputs."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{BASE_URL}/chat/completions",
            headers={**HEADERS, "Authorization": f"Bearer {_api_key()}"},
            json={
                "model": model_id,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            },
            timeout=timeout,
        )
        r.raise_for_status()
        return r.json()


# Preferred model IDs for each role — resolved against available models at runtime.
_SUGGESTION_MODEL_PREF = "anthropic/claude-haiku-4-5"

# Pool of models to distribute across suggested participants for model diversity.
_PARTICIPANT_MODEL_POOL = [
    "anthropic/claude-haiku-4-5",
    "openai/gpt-5-mini",
    "google/gemini-3-flash-preview",
    "x-ai/grok-4-fast",
    "deepseek/deepseek-chat-v3-0324",
]


# Qualifiers stripped before scoring — they add noise without meaning.
_QUALIFIER_TOKENS = {"beta", "preview", "exp", "experimental", "latest", "free"}
# Tokens treated as equivalent (small/cheap model tier).
_SMALL_TIER = {"mini", "fast", "flash", "lite", "haiku", "small"}


def _tokenize_model_id(model_id: str) -> list[str]:
    """Split a model ID (minus provider prefix) into tokens, excluding version-like
    tokens and normalising small-tier synonyms."""
    name = model_id.split("/", 1)[-1]
    tokens = re.split(r"[-_.]", name)
    result: list[str] = []
    for t in tokens:
        if not t or re.fullmatch(r"[\d]+([._-][\d]+)*", t):
            continue
        low = t.lower()
        if low in _QUALIFIER_TOKENS:
            continue
        if low in _SMALL_TIER:
            result.append("_small")
        else:
            result.append(low)
    return result


def _version_key(model_id: str) -> list[int]:
    """Extract version numbers from a model ID for comparison (higher = newer)."""
    return [int(n) for n in re.findall(r"\d+", model_id)]


def find_best_model(
    target_id: str, available: list[dict], *, prefer_newest: bool = False,
) -> dict | None:
    """Find the best matching model in *available* for a given *target_id*.

    When *prefer_newest* is False (default):
        Exact match first, then fuzzy.  Use this when the user explicitly chose
        a model and we only fall back to fuzzy if it's unavailable.

    When *prefer_newest* is True:
        Skip exact match — always pick the highest-versioned fuzzy match.
        Use this for dropdown suggestions where we want the latest model.
    """
    if not available:
        return None

    # 1. Exact match (only in exact-preferred mode)
    if not prefer_newest:
        for m in available:
            if m["id"] == target_id:
                return m

    target_provider = target_id.split("/")[0] if "/" in target_id else ""
    target_tokens = set(_tokenize_model_id(target_id))

    def score(m: dict) -> tuple[float, list[int]]:
        tokens = set(_tokenize_model_id(m["id"]))
        union = tokens | target_tokens
        jaccard = len(tokens & target_tokens) / len(union) if union else 0.0
        return (jaccard, _version_key(m["id"]))

    # 2. Same provider first, then all
    same_provider = [m for m in available if m["id"].split("/")[0] == target_provider]
    pool = same_provider or available
    return max(pool, key=score)


async def suggest_participants(
    topic: str, personas: list[dict], suggestion_model_override: str | None = None
) -> list[dict]:
    """Ask the model to suggest up to 10 participants for a meeting topic."""
    # Resolve models against the live model list once.
    available = await fetch_models()
    pref = suggestion_model_override or _SUGGESTION_MODEL_PREF
    suggestion_model = (find_best_model(pref, available) or {}).get(
        "id", pref
    )
    # Resolve participant model pool — keep only models that are actually available.
    resolved_pool: list[str] = []
    for pref in _PARTICIPANT_MODEL_POOL:
        match = find_best_model(pref, available)
        if match:
            mid = match["id"]
            if mid not in resolved_pool:
                resolved_pool.append(mid)
    if not resolved_pool:
        resolved_pool = [_PARTICIPANT_MODEL_POOL[0]]
    print(f"[suggest] suggestion_model={suggestion_model!r}, participant_pool={resolved_pool!r}")

    persona_list = "\n".join(
        f"- {p['id']}: {p['name']} — {p['description']}" for p in personas
    )
    model_list = "\n".join(f"- {m}" for m in resolved_pool)
    messages = [
        {
            "role": "system",
            "content": (
                "You are a meeting facilitator. Given a discussion topic, suggest up to 10 participants "
                "who would bring diverse, valuable, and contrasting perspectives.\n\n"
                f"Available personas:\n{persona_list}\n\n"
                f"Available AI models (use each model at least once before repeating; spread them evenly):\n{model_list}\n\n"
                "For each participant provide:\n"
                "  name: A realistic human name\n"
                "  persona_id: One of the persona IDs listed above (vary them; avoid repeating the same one more than twice)\n"
                "  model_id: One of the model IDs listed above — pick the model whose strengths best suit "
                "this participant's role and persona. Maximize model diversity across participants.\n"
                "  description: 1–2 sentences of specific background, expertise, or role directly relevant to the topic\n\n"
                "Return ONLY a valid JSON array of objects with keys: name, persona_id, model_id, description. "
                "No markdown fences, no explanation, just the array."
            ),
        },
        {
            "role": "user",
            "content": f"Topic: {topic}",
        },
    ]

    result = await complete(
        messages, suggestion_model,
        max_tokens=4000, temperature=0.9, timeout=90,
    )
    msg = result["choices"][0]["message"]
    raw = (msg.get("content") or "").strip()
    # Some reasoning models put output in reasoning field instead of content
    if not raw and msg.get("reasoning"):
        raw = msg["reasoning"].strip()
    print(f"[suggest] raw response ({len(raw)} chars): {raw[:300]!r}")

    # Strip markdown fences if present
    stripped = re.sub(r"```(?:json)?\s*", "", raw).strip()
    match = re.search(r"\[.*\]", stripped, re.DOTALL)
    if not match:
        print(f"[suggest] no JSON array found in response")
        return []
    try:
        items = json.loads(match.group())
    except json.JSONDecodeError as exc:
        print(f"[suggest] JSON parse error: {exc}")
        return []

    valid_ids = {p["id"] for p in personas}
    suggestions: list[dict] = []
    for item in items[:10]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        persona_id = str(item.get("persona_id", "")).strip()
        description = str(item.get("description", "")).strip()
        if not name or persona_id not in valid_ids:
            continue
        # Use the LLM's model pick if valid, otherwise round-robin fallback
        chosen_model = str(item.get("model_id", "")).strip()
        pool_set = set(resolved_pool)
        if chosen_model not in pool_set:
            chosen_model = resolved_pool[len(suggestions) % len(resolved_pool)]
        suggestions.append({
            "name": name,
            "persona_id": persona_id,
            "model_id": chosen_model,
            "description": description,
        })

    return suggestions


async def complete_with_tools(
    messages: list[dict], model_id: str, tools: list[dict]
) -> dict:
    """Non-streaming completion with tool definitions — used for agentic web access."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{BASE_URL}/chat/completions",
            headers={**HEADERS, "Authorization": f"Bearer {_api_key()}"},
            json={
                "model": model_id,
                "messages": messages,
                "tools": tools,
                "temperature": 0.7,
            },
            timeout=60,
        )
        r.raise_for_status()
        return r.json()


def _detect_repetition(text: str, window: int = 60, threshold: int = 4) -> bool:
    """Return True if the tail of *text* contains a repeating pattern.

    Looks at the last *window* chars and checks if any substring of length
    6–window//threshold repeats at least *threshold* times consecutively.
    This catches degenerate model loops like "textColor?textColor?textColor?…".
    """
    tail = text[-window * threshold :] if len(text) > window * threshold else text
    if len(tail) < window:
        return False
    for pat_len in range(6, max(7, window // threshold)):
        pat = tail[-pat_len:]
        count = 0
        pos = len(tail) - pat_len
        while pos >= 0 and tail[pos:pos + pat_len] == pat:
            count += 1
            pos -= pat_len
        if count >= threshold:
            return True
    return False


async def stream_completion(
    messages: list[dict], model_id: str
) -> AsyncIterator[str]:
    """Streaming completion — yields text chunks."""
    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            f"{BASE_URL}/chat/completions",
            headers={**HEADERS, "Authorization": f"Bearer {_api_key()}"},
            json={
                "model": model_id,
                "messages": messages,
                "stream": True,
                "temperature": 0.7,
            },
            timeout=60,
        ) as response:
            response.raise_for_status()
            accumulated = ""
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        accumulated += delta
                        yield delta
                        if len(accumulated) > 300 and _detect_repetition(accumulated):
                            print(f"[stream] repetition loop detected for {model_id}, aborting")
                            break
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
