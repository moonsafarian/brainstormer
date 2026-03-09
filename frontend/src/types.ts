export interface Persona {
  id: string;
  name: string;
  description: string;
  is_built_in: boolean;
}

export interface Participant {
  id: string;
  name: string;
  model_id: string;
  persona: Persona;
  description?: string;
}

// Saved participant template stored in localStorage
export interface SavedParticipant {
  id: string;
  name: string;
  model_id: string;
  persona_id: string;
  description?: string;
}

export interface Contribution {
  participant_id: string;
  urgency: number;
  urgency_reason: string;
  did_speak: boolean;
  content: string | null;
}

export interface Turn {
  id: string;
  number: number;
  human_message: string | null;
  contributions: Contribution[];
}

export interface Meeting {
  id: string;
  topic: string;
  speaking_threshold: number;
  human_name?: string;
  participants: Participant[];
  turns: Turn[];
  summary: string | null;
  status: "active" | "ended";
  created_at: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number | null;
  pricing: { prompt?: string; completion?: string };
}

// ── SSE event payloads ────────────────────────────────────────────────────────

export interface UrgencyEvent {
  participant_id: string;
  urgency: number;
  reason: string;
}

export interface ResponseStartEvent {
  participant_id: string;
  name: string;
  urgency: number;
}

export interface ResponseChunkEvent {
  participant_id: string;
  chunk: string;
}

export interface ResponseEndEvent {
  participant_id: string;
}

export interface TurnCompleteEvent {
  turn_number: number;
  meeting_ended: boolean;
}

export interface SummaryChunkEvent {
  chunk: string;
}

export interface ToolUseEvent {
  participant_id: string;
  tool: "search_web" | "fetch_url";
  input: string;
}
