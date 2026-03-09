import type {
  Meeting,
  OpenRouterModel,
  Persona,
  TurnCompleteEvent,
  UrgencyEvent,
  ResponseStartEvent,
  ResponseChunkEvent,
  ResponseEndEvent,
  SummaryChunkEvent,
  ToolUseEvent,
} from "./types";
import { getStoredApiKey } from "./utils/apiKey";

const BASE = "/api";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = getStoredApiKey();
  return key ? { ...extra, "X-Api-Key": key } : { ...extra };
}

export async function fetchPersonas(): Promise<Persona[]> {
  const r = await fetch(`${BASE}/personas`, { headers: authHeaders() });
  if (!r.ok) throw new Error("Failed to load personas");
  return r.json();
}

export async function fetchModels(): Promise<OpenRouterModel[]> {
  const r = await fetch(`${BASE}/models`, { headers: authHeaders() });
  if (!r.ok) throw new Error("Failed to load models");
  return r.json();
}

export async function createMeeting(payload: {
  topic: string;
  speaking_threshold: number;
  human_name?: string;
  participants: { name: string; model_id: string; persona_id: string; description?: string }[];
}): Promise<Meeting> {
  const r = await fetch(`${BASE}/meetings`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("Failed to create meeting");
  return r.json();
}

export interface CandidateSuggestion {
  name: string;
  persona_id: string;
  model_id: string;
  description: string;
}

export async function suggestParticipants(
  topic: string,
  suggestionModel?: string,
): Promise<CandidateSuggestion[]> {
  const payload: Record<string, string> = { topic };
  if (suggestionModel) payload.suggestion_model = suggestionModel;
  const r = await fetch(`${BASE}/suggest-participants`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.detail ?? "Failed to suggest participants");
  }
  return r.json();
}

export async function reopenMeeting(
  meetingId: string,
  speaking_threshold: number
): Promise<Meeting> {
  const r = await fetch(`${BASE}/meetings/${meetingId}/reopen`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ speaking_threshold }),
  });
  if (!r.ok) throw new Error("Failed to reopen meeting");
  return r.json();
}

export type TurnCallbacks = {
  onUrgency: (e: UrgencyEvent) => void;
  onResponseStart: (e: ResponseStartEvent) => void;
  onResponseChunk: (e: ResponseChunkEvent) => void;
  onResponseEnd: (e: ResponseEndEvent) => void;
  onToolUse: (e: ToolUseEvent) => void;
  onTurnComplete: (e: TurnCompleteEvent) => void;
  onError: (err: Error) => void;
};

export async function runTurn(
  meetingId: string,
  humanMessage: string | null,
  callbacks: TurnCallbacks
): Promise<void> {
  const r = await fetch(`${BASE}/meetings/${meetingId}/turn`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ human_message: humanMessage }),
  });
  if (!r.ok) {
    callbacks.onError(new Error(`Turn failed: ${r.status}`));
    return;
  }
  await readSSE(r, {
    urgency: (d) => callbacks.onUrgency(d as UrgencyEvent),
    response_start: (d) => callbacks.onResponseStart(d as ResponseStartEvent),
    response_chunk: (d) => callbacks.onResponseChunk(d as ResponseChunkEvent),
    response_end: (d) => callbacks.onResponseEnd(d as ResponseEndEvent),
    tool_use: (d) => callbacks.onToolUse(d as ToolUseEvent),
    turn_complete: (d) => callbacks.onTurnComplete(d as TurnCompleteEvent),
  });
}

export type SummaryCallbacks = {
  onChunk: (e: SummaryChunkEvent) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
};

export async function requestSummary(
  meetingId: string,
  callbacks: SummaryCallbacks
): Promise<void> {
  const r = await fetch(`${BASE}/meetings/${meetingId}/summary`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!r.ok) {
    callbacks.onError(new Error(`Summary failed: ${r.status}`));
    return;
  }
  await readSSE(r, {
    summary_chunk: (d) => callbacks.onChunk(d as SummaryChunkEvent),
    summary_complete: () => callbacks.onComplete(),
  });
}

async function readSSE(
  response: Response,
  handlers: Record<string, (data: unknown) => void>
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      let eventType = "message";
      let dataLine = "";
      for (const line of event.split("\n")) {
        if (line.startsWith("event:")) eventType = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
      }
      if (dataLine && handlers[eventType]) {
        try {
          handlers[eventType](JSON.parse(dataLine));
        } catch {
          // ignore parse errors
        }
      }
    }
  }
}
