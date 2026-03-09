import { useEffect, useMemo, useRef, useState } from "react";
import type { Meeting, OpenRouterModel, Persona, SavedParticipant } from "../types";
import { createMeeting, fetchModels, fetchPersonas, suggestParticipants } from "../api";
import type { CandidateSuggestion } from "../api";
import { findBestModel, resolvePreferredModels } from "../utils/modelMatch";
import { clearStoredApiKey, getStoredApiKey, hasStoredApiKey, setStoredApiKey } from "../utils/apiKey";
import { getStoredSuggestionModel, setStoredSuggestionModel } from "../utils/suggestionModel";
import { getStoredTheme, setStoredTheme } from "../utils/theme";
import type { Theme } from "../utils/theme";
import { getHistory, deleteFromHistory } from "../utils/history";
import type { HistoryEntry } from "../utils/history";

interface ParticipantDraft {
  name: string;
  model_id: string;
  persona_id: string;
  description: string;
}

const EMPTY_PARTICIPANT: ParticipantDraft = {
  name: "",
  model_id: "",
  persona_id: "",
  description: "",
};

const STORAGE_KEY = "brainstormer_saved_participants";

function loadSaved(): SavedParticipant[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveSaved(participants: SavedParticipant[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(participants));
}

// ── Suggested model tiers ─────────────────────────────────────────────────────

const CHEAP_IDS = [
  "openai/gpt-5-mini",
  "anthropic/claude-haiku-4.5",
  "google/gemini-3-flash-preview",
  "x-ai/grok-4-fast",
  "deepseek/deepseek-chat-v3-0324",
  "moonshotai/kimi-k2.5",
  "minimax/minimax-m2.5",
] as const;

const ADVANCED_IDS = [
  "google/gemini-3.1-pro-preview",
  "openai/gpt-5.4",
  "anthropic/claude-sonnet-4.6",
  "x-ai/grok-4",
] as const;

// ── ModelSelect ───────────────────────────────────────────────────────────────

const DROPDOWN_WIDTH = 320;
const DROPDOWN_MAX_HEIGHT = 520;

function ModelSelect({
  value,
  onChange,
  models,
  loading,
}: {
  value: string;
  onChange: (id: string) => void;
  models: OpenRouterModel[];
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = models.find((m) => m.id === value);

  function positionDropdown() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openUpward = spaceBelow < DROPDOWN_MAX_HEIGHT && spaceAbove > spaceBelow;

    let left = rect.right - DROPDOWN_WIDTH;
    if (left < 8) left = 8;
    if (left + DROPDOWN_WIDTH > window.innerWidth - 8) left = window.innerWidth - 8 - DROPDOWN_WIDTH;

    const maxHeight = Math.min(DROPDOWN_MAX_HEIGHT, openUpward ? spaceAbove : spaceBelow);

    setDropdownStyle(
      openUpward
        ? { position: "fixed", bottom: window.innerHeight - rect.top + 4, left, width: DROPDOWN_WIDTH, maxHeight }
        : { position: "fixed", top: rect.bottom + 4, left, width: DROPDOWN_WIDTH, maxHeight }
    );
  }

  function handleOpen() {
    positionDropdown();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !panelRef.current?.contains(e.target as Node)
      ) setOpen(false);
    }
    function onScroll() { positionDropdown(); }
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const suggestedCheap = useMemo(() => resolvePreferredModels(CHEAP_IDS, models), [models]);
  const suggestedAdvanced = useMemo(() => resolvePreferredModels(ADVANCED_IDS, models), [models]);
  const cheapIds = useMemo(() => new Set(suggestedCheap.map((m) => m.id)), [suggestedCheap]);
  const filteredAll = search
    ? models.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.id.toLowerCase().includes(search.toLowerCase())
      )
    : models;

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={loading}
        onClick={() => (open ? setOpen(false) : handleOpen())}
        className={`w-full text-left bg-th-raised border rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors flex items-center justify-between gap-1
          ${open ? "border-indigo-500" : "border-th-line-s"}
          ${loading ? "opacity-50 cursor-not-allowed" : "hover:border-th-fg-muted cursor-pointer"}`}
      >
        <span className={`truncate ${selected ? "text-th-fg" : "text-th-fg-muted"}`}>
          {loading ? "Loading…" : selected ? selected.name : "Select model"}
        </span>
        <svg className="shrink-0 w-3 h-3 text-th-fg-muted" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 1l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          style={dropdownStyle}
          className="z-[9999] bg-th-base border border-th-line-s rounded-xl shadow-2xl overflow-hidden flex flex-col"
        >
          {!search && suggestedCheap.length > 0 && (
            <div className="p-3 border-b border-th-line shrink-0">
              <p className="text-xs text-th-ok-fg font-medium mb-1.5 uppercase tracking-wide">
                Low cost
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestedCheap.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => select(m.id)}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors
                      ${value === m.id
                        ? "bg-emerald-700 border-emerald-600 text-white"
                        : "bg-th-raised border-th-line-s text-th-fg-3 hover:border-emerald-600 hover:text-white"
                      }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!search && suggestedAdvanced.length > 0 && (
            <div className="p-3 border-b border-th-line shrink-0">
              <p className="text-xs text-th-accent-fg-2 font-medium mb-1.5 uppercase tracking-wide">
                Advanced
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestedAdvanced.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => select(m.id)}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors
                      ${value === m.id
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-th-raised border-th-line-s text-th-fg-3 hover:border-indigo-500 hover:text-white"
                      }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-3 pt-2.5 pb-2 border-b border-th-line shrink-0">
              <p className="text-xs text-th-fg-muted font-medium uppercase tracking-wide mb-1.5">
                All models
              </p>
              <input
                autoFocus
                type="text"
                placeholder={`Search ${models.length} models…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-th-raised rounded-lg px-3 py-1.5 text-sm text-th-fg placeholder-th-fg-muted focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {filteredAll.length === 0 ? (
                <p className="text-xs text-th-fg-muted text-center py-4">No models found</p>
              ) : (
                filteredAll.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => select(m.id)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2
                      ${value === m.id ? "bg-indigo-900 text-th-accent-fg-bright" : "text-th-fg-3 hover:bg-th-raised"}`}
                  >
                    <span className="truncate">{m.name}</span>
                    {cheapIds.has(m.id) && (
                      <span className="text-xs text-emerald-500 shrink-0">low cost</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared chevron ────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M1 1l4 4-4 4"/>
    </svg>
  );
}

// ── Shared participant card ────────────────────────────────────────────────────

function ParticipantCard({
  name,
  personaName,
  modelName,
  description,
  isAdded,
  onAdd,
  onSave,
  onDelete,
}: {
  name: string;
  personaName?: string;
  modelName?: string;
  description?: string;
  isAdded?: boolean;
  onAdd: () => void;
  onSave?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="bg-th-base border border-th-line rounded-xl px-3 py-2.5 flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-sm font-medium text-th-fg-2 truncate">{name}</span>
          {personaName && (
            <span className="text-xs text-th-accent-fg-2 shrink-0">{personaName}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              title="Save to your browser for reuse in future meetings"
              className="text-xs text-th-fg-muted hover:text-th-ok-fg transition-colors px-1 py-0.5 rounded"
            >
              Remember
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="Remove from your browser's saved list"
              className="text-xs text-th-fg-muted hover:text-red-400 transition-colors px-1 py-0.5 rounded"
            >
              Forget
            </button>
          )}
          {isAdded ? (
            <span className="text-xs text-th-ok-fg px-1.5 py-0.5">✓ Added</span>
          ) : (
            <button
              type="button"
              onClick={onAdd}
              title="Add to meeting"
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg px-2.5 py-1 transition-colors"
            >
              + Add
            </button>
          )}
        </div>
      </div>
      {description && (
        <p className="text-xs text-th-fg-muted leading-relaxed line-clamp-2">{description}</p>
      )}
      {modelName && (
        <p className="text-xs text-th-fg-faint">{modelName}</p>
      )}
    </div>
  );
}

// ── SuggestedParticipants ─────────────────────────────────────────────────────

function SuggestedParticipants({
  candidates,
  loading,
  error,
  personas,
  models,
  addedNames,
  onAdd,
  onSave,
}: {
  candidates: CandidateSuggestion[];
  loading: boolean;
  error: string;
  personas: Persona[];
  models: OpenRouterModel[];
  addedNames: Set<string>;
  onAdd: (c: CandidateSuggestion) => void;
  onSave: (c: CandidateSuggestion) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (loading) {
    return (
      <div className="mb-4 flex items-center gap-2 text-xs text-th-fg-muted py-1">
        <svg className="w-3.5 h-3.5 shrink-0 animate-spin text-th-accent-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83"/>
        </svg>
        Finding the right people for this topic…
      </div>
    );
  }

  if (error) {
    return <p className="mb-4 text-xs text-red-400">{error}</p>;
  }

  if (candidates.length === 0) return null;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-th-fg-muted font-medium uppercase tracking-wide mb-2 hover:text-th-fg-3 transition-colors"
      >
        <Chevron open={!collapsed} />
        Suggested participants
        <span className="text-th-fg-faint">({candidates.length})</span>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {candidates.map((c, i) => {
            const persona = personas.find((p) => p.id === c.persona_id);
            const model = models.find((m) => m.id === c.model_id);
            return (
              <ParticipantCard
                key={i}
                name={c.name}
                personaName={persona?.name}
                modelName={model?.name}
                description={c.description}
                isAdded={addedNames.has(c.name.trim().toLowerCase())}
                onAdd={() => onAdd(c)}
                onSave={() => onSave(c)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── SavedParticipants ─────────────────────────────────────────────────────────

function SavedParticipants({
  saved,
  personas,
  models,
  addedNames,
  onAdd,
  onDelete,
}: {
  saved: SavedParticipant[];
  personas: Persona[];
  models: OpenRouterModel[];
  addedNames: Set<string>;
  onAdd: (s: SavedParticipant) => void;
  onDelete: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  if (saved.length === 0) return null;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-th-fg-muted font-medium uppercase tracking-wide mb-2 hover:text-th-fg-3 transition-colors"
      >
        <Chevron open={!collapsed} />
        Remembered participants
        <span className="text-th-fg-faint">({saved.length})</span>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {saved.map((s) => {
            const persona = personas.find((p) => p.id === s.persona_id);
            const model = models.find((m) => m.id === s.model_id);
            return (
              <ParticipantCard
                key={s.id}
                name={s.name}
                personaName={persona?.name}
                modelName={model?.name}
                description={s.description}
                isAdded={addedNames.has(s.name.trim().toLowerCase())}
                onAdd={() => onAdd(s)}
                onDelete={() => onDelete(s.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepLabel({ step, label, hint }: { step: number; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="w-7 h-7 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-th-accent-fg-2 shrink-0">
        {step}
      </span>
      <div>
        <h2 className="text-sm font-semibold text-th-fg-2">{label}</h2>
        {hint && <p className="text-xs text-th-fg-muted mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

// ── SetupScreen ───────────────────────────────────────────────────────────────

export default function SetupScreen({
  onMeetingCreated,
  onOpenHistorical,
}: {
  onMeetingCreated: (m: Meeting) => void;
  onOpenHistorical: (entry: HistoryEntry) => void;
}) {
  const [topic, setTopic] = useState("");
  const [humanName, setHumanName] = useState("");
  const [threshold, setThreshold] = useState(5);
  const [participants, setParticipants] = useState<ParticipantDraft[]>([{ ...EMPTY_PARTICIPANT }]);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [error, setError] = useState("");

  const [saved, setSaved] = useState<SavedParticipant[]>(loadSaved);

  const [candidates, setCandidates] = useState<CandidateSuggestion[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidatesError, setCandidatesError] = useState("");

  async function handleFindPeople() {
    if (!topic.trim() || loadingCandidates) return;
    setLoadingCandidates(true);
    setCandidates([]);
    setCandidatesError("");
    try {
      const suggestions = await suggestParticipants(topic.trim(), suggestionModelId || undefined);
      if (suggestions.length === 0) {
        setCandidatesError("No suggestions returned — try rephrasing the topic.");
      } else {
        setCandidates(suggestions.map((s) => ({
          ...s,
          model_id: findBestModel(s.model_id, models)?.id ?? s.model_id,
        })));
      }
    } catch (e) {
      setCandidatesError(`Failed to find participants: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingCandidates(false);
    }
  }

  function addCandidateToMeeting(c: CandidateSuggestion) {
    setParticipants((prev) => {
      if (prev.some((p) => p.name.trim().toLowerCase() === c.name.trim().toLowerCase())) return prev;
      const onlyBlank = prev.length === 1 && !prev[0].name && !prev[0].model_id && !prev[0].persona_id;
      const base = onlyBlank ? [] : prev;
      return [...base, {
        name: c.name,
        model_id: c.model_id,
        persona_id: c.persona_id,
        description: c.description,
      }];
    });
  }

  function saveCandidate(c: CandidateSuggestion) {
    const entry: SavedParticipant = {
      id: crypto.randomUUID(),
      name: c.name,
      model_id: c.model_id,
      persona_id: c.persona_id,
      description: c.description || undefined,
    };
    const updated = [...saved, entry];
    setSaved(updated);
    saveSaved(updated);
  }

  // History modal
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  function openHistory() {
    setHistory(getHistory());
    setHistoryOpen(true);
  }

  function handleDeleteHistory(meetingId: string) {
    deleteFromHistory(meetingId);
    setHistory((prev) => prev.filter((e) => e.meeting.id !== meetingId));
  }

  // Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyActive, setKeyActive] = useState(hasStoredApiKey);
  const [suggestionModelId, setSuggestionModelId] = useState(getStoredSuggestionModel);
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  function openSettings() {
    setKeyInput("");
    setShowKey(false);
    setSettingsOpen(true);
  }

  function handleSaveKey() {
    setStoredApiKey(keyInput);
    setKeyActive(hasStoredApiKey());
    setSettingsOpen(false);
  }

  function handleClearKey() {
    clearStoredApiKey();
    setKeyActive(false);
    setKeyInput("");
  }

  useEffect(() => {
    fetchPersonas().then(setPersonas).catch(console.error);
    fetchModels()
      .then(setModels)
      .catch(console.error)
      .finally(() => setLoadingModels(false));
  }, []);

  function updateParticipant(i: number, key: keyof ParticipantDraft, value: string | boolean) {
    setParticipants((prev) => prev.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));
  }

  function addParticipant() {
    setParticipants((prev) => [...prev, { ...EMPTY_PARTICIPANT }]);
  }

  function removeParticipant(i: number) {
    setParticipants((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      return next.length === 0 ? [{ ...EMPTY_PARTICIPANT }] : next;
    });
  }

  function saveParticipant(i: number) {
    const p = participants[i];
    if (!p.name.trim() || !p.model_id || !p.persona_id) return;
    const entry: SavedParticipant = {
      id: crypto.randomUUID(),
      name: p.name.trim(),
      model_id: p.model_id,
      persona_id: p.persona_id,
      description: p.description.trim() || undefined,
    };
    const updated = [...saved, entry];
    setSaved(updated);
    saveSaved(updated);
  }

  function addSavedToMeeting(s: SavedParticipant) {
    const resolvedModelId = findBestModel(s.model_id, models)?.id ?? s.model_id;
    setParticipants((prev) => {
      if (prev.some((p) => p.name.trim().toLowerCase() === s.name.trim().toLowerCase())) return prev;
      const onlyBlank = prev.length === 1 && !prev[0].name && !prev[0].model_id && !prev[0].persona_id;
      const base = onlyBlank ? [] : prev;
      return [...base, {
        name: s.name,
        model_id: resolvedModelId,
        persona_id: s.persona_id,
        description: s.description ?? "",
      }];
    });
  }

  function deleteSaved(id: string) {
    const updated = saved.filter((s) => s.id !== id);
    setSaved(updated);
    saveSaved(updated);
  }

  async function handleStart() {
    setError("");
    if (!topic.trim()) return setError("Please enter a topic.");
    if (participants.length === 0) return setError("Add at least one participant.");
    for (const p of participants) {
      if (!p.name.trim()) return setError("Every participant needs a name.");
      if (!p.model_id) return setError("Every participant needs a model.");
      if (!p.persona_id) return setError("Every participant needs a persona.");
    }
    setLoading(true);
    try {
      const meeting = await createMeeting({
        topic: topic.trim(),
        speaking_threshold: threshold,
        human_name: humanName.trim() || undefined,
        participants: participants.map((p) => ({
          name: p.name,
          model_id: p.model_id,
          persona_id: p.persona_id,
          description: p.description.trim() || undefined,
        })),
      });
      onMeetingCreated(meeting);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const validParticipants = participants.filter((p) => p.name.trim() && p.model_id && p.persona_id);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-th-line/60 bg-th-page/90 backdrop-blur shrink-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-th-fg">Brainstormer</h1>
            <p className="text-xs text-th-fg-muted mt-0.5">
              Simulate a multi-perspective AI meeting to stress-test your ideas.
            </p>
          </div>
          <div className="flex items-center gap-1">
          <button
            onClick={openHistory}
            title="History"
            className="text-th-fg-muted hover:text-th-fg-2 transition-colors p-2 rounded-lg hover:bg-th-raised/60"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </button>
          <button
            onClick={openSettings}
            title="Settings"
            className="relative text-th-fg-muted hover:text-th-fg-2 transition-colors p-2 rounded-lg hover:bg-th-raised/60"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            {keyActive && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-th-page" />
            )}
          </button>
          </div>
        </div>
      </header>

      {/* Settings modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-th-base border border-th-line-s rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-base font-semibold text-th-fg mb-3">Settings</h3>
            <h4 className="text-sm font-medium text-th-fg-3 mb-1">OpenRouter API Key</h4>
            <p className="text-xs text-th-fg-muted mb-4">
              Your key is stored obfuscated in your browser and sent securely with every request.
              It overrides any server-side default.
            </p>

            {keyActive && !keyInput && (
              <div className="flex items-center gap-2 mb-3 text-xs text-th-ok-fg">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                A custom key is currently active.
                <button
                  onClick={handleClearKey}
                  className="ml-auto text-th-fg-muted hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              </div>
            )}

            <div className="relative mb-4">
              <input
                type={showKey ? "text" : "password"}
                placeholder={keyActive ? "Enter new key to replace…" : "sk-or-…"}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && keyInput.trim()) handleSaveKey(); }}
                className="w-full bg-th-raised border border-th-line-s rounded-lg px-3 py-2.5 pr-10 text-sm text-th-fg placeholder-th-fg-muted focus:outline-none focus:border-indigo-500 font-mono"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-th-fg-muted hover:text-th-fg-3 transition-colors"
                tabIndex={-1}
              >
                {showKey ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>

            {/* Appearance */}
            <div className="mb-4 border-t border-th-line pt-4">
              <h4 className="text-sm font-medium text-th-fg-3 mb-1">Appearance</h4>
              <div className="flex gap-2 mt-2">
                {(["light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setTheme(t); setStoredTheme(t); }}
                    className={`flex-1 text-xs font-medium rounded-lg px-3 py-2 transition-colors capitalize ${
                      theme === t
                        ? "bg-indigo-600 text-white"
                        : "bg-th-raised text-th-fg-muted hover:text-th-fg-2"
                    }`}
                  >
                    {t === "light" ? "☀ Light" : "☾ Dark"}
                  </button>
                ))}
              </div>
            </div>

            {/* Suggestion model */}
            <div className="mb-4 border-t border-th-line pt-4">
              <h4 className="text-sm font-medium text-th-fg-3 mb-1">Suggestion Model</h4>
              <p className="text-xs text-th-fg-muted mb-2">
                The AI model used to generate participant suggestions. Leave as default or pick your own.
              </p>
              <ModelSelect
                value={suggestionModelId}
                onChange={(id) => {
                  setSuggestionModelId(id);
                  setStoredSuggestionModel(id);
                }}
                models={models}
                loading={loadingModels}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSaveKey}
                disabled={!keyInput.trim()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg py-2 transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => setSettingsOpen(false)}
                className="flex-1 bg-th-raised hover:bg-th-line text-th-fg-3 text-sm rounded-lg py-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History modal */}
      {historyOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-th-base border border-th-line-s rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-th-fg">Meeting History</h3>
              <button
                onClick={() => setHistoryOpen(false)}
                className="text-th-fg-muted hover:text-th-fg-3 transition-colors p-1"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-th-fg-muted text-center py-8">No past meetings yet.</p>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                {history.map((entry) => (
                  <div
                    key={entry.meeting.id}
                    className="bg-th-raised border border-th-line rounded-xl px-4 py-3"
                  >
                    <p className="text-sm font-medium text-th-fg-2 line-clamp-2 mb-1">
                      {entry.meeting.topic}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-th-fg-muted mb-2">
                      <span>{entry.meeting.participants.length} participant{entry.meeting.participants.length !== 1 ? "s" : ""}</span>
                      <span>{entry.meeting.turns.length} turn{entry.meeting.turns.length !== 1 ? "s" : ""}</span>
                      <span>{new Date(entry.savedAt).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { onOpenHistorical(entry); setHistoryOpen(false); }}
                        className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg px-3 py-1.5 transition-colors"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => handleDeleteHistory(entry.meeting.id)}
                        className="text-xs text-th-fg-muted hover:text-red-400 transition-colors px-2 py-1.5"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Two-column layout on wide screens */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

            {/* Left column: Topic + settings */}
            <div className="lg:col-span-2">
              {/* Step 1: Topic */}
              <section className="mb-8">
                <StepLabel
                  step={1}
                  label="What do you want to decide?"
                  hint="Describe your question, dilemma, or idea. The more context you give, the better the discussion."
                />
                <textarea
                  className="w-full bg-th-base/60 border border-th-line-s/60 rounded-xl px-4 py-3 text-th-fg placeholder-th-fg-muted focus:outline-none focus:border-indigo-500/60 resize-none transition-colors"
                  rows={4}
                  placeholder="e.g. Should we pivot our product to focus on enterprise customers? We currently have 200 SMB customers with $15K avg ARR but two Fortune 500 companies have expressed interest…"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </section>

              {/* Step 2: Settings */}
              <section className="mb-8">
                <StepLabel
                  step={2}
                  label="Meeting settings"
                  hint="Configure who you are and how freely participants speak."
                />

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-th-fg-4 mb-1.5">
                      Your name <span className="text-th-fg-faint">(so participants can address you)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Alex"
                      value={humanName}
                      onChange={(e) => setHumanName(e.target.value)}
                      className="w-full bg-th-base/60 border border-th-line-s/60 rounded-lg px-4 py-2.5 text-th-fg placeholder-th-fg-muted focus:outline-none focus:border-indigo-500/60 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-th-fg-4 mb-1.5">
                      Speaking threshold:{" "}
                      <span className="text-th-accent-fg-2 font-bold">{threshold}/10</span>
                    </label>
                    <p className="text-xs text-th-fg-faint mb-2">
                      How much a participant needs to say before they speak up. Lower = more talkative, higher = only speak when they really have something to add.
                    </p>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${threshold * 10}%, rgb(var(--th-line-s)) ${threshold * 10}%, rgb(var(--th-line-s)) 100%)`,
                      }}
                    />
                    <div className="flex justify-between text-xs text-th-fg-faint mt-1">
                      <span>Everyone speaks</span>
                      <span>Only when urgent</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Right column: Participants */}
            <div className="lg:col-span-3">
              <section>
                <StepLabel
                  step={3}
                  label="Choose your participants"
                  hint="Each participant uses a different AI model and brings a unique perspective. You can create your own or let AI suggest the right people for your topic."
                />

                <div className="flex items-center gap-2 mb-5">
                  <button
                    type="button"
                    onClick={handleFindPeople}
                    disabled={!topic.trim() || loadingCandidates}
                    className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium rounded-lg px-3 py-1.5 transition-colors flex items-center gap-1.5"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                      <circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    {loadingCandidates ? "Finding…" : "Suggest participants for my topic"}
                  </button>
                  <span className="text-xs text-th-fg-faint">or add manually below</span>
                </div>

                {/* Suggested participants */}
                <SuggestedParticipants
                  candidates={candidates}
                  loading={loadingCandidates}
                  error={candidatesError}
                  personas={personas}
                  models={models}
                  addedNames={new Set(participants.map((p) => p.name.trim().toLowerCase()).filter(Boolean))}
                  onAdd={addCandidateToMeeting}
                  onSave={saveCandidate}
                />

                {/* Remembered participants */}
                <SavedParticipants
                  saved={saved}
                  personas={personas}
                  models={models}
                  addedNames={new Set(participants.map((p) => p.name.trim().toLowerCase()).filter(Boolean))}
                  onAdd={addSavedToMeeting}
                  onDelete={deleteSaved}
                />

                {/* Manual participant forms */}
                <div className="flex items-center justify-between mb-3 mt-2">
                  <p className="text-xs text-th-fg-muted font-medium uppercase tracking-wide">
                    Meeting roster ({validParticipants.length} participant{validParticipants.length !== 1 ? "s" : ""})
                  </p>
                  <button
                    onClick={addParticipant}
                    disabled={participants.length >= 6}
                    className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors"
                  >
                    + Add
                  </button>
                </div>
                <div className="space-y-4">
                  {participants.map((p, i) => (
                    <div key={i} className="bg-th-base/60 border border-th-line/60 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-th-fg-muted font-medium uppercase tracking-wide">
                          Participant {i + 1}
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => saveParticipant(i)}
                            disabled={!p.name.trim() || !p.model_id || !p.persona_id}
                            className="text-xs text-th-fg-muted hover:text-th-ok-fg disabled:opacity-30 transition-colors px-1 py-0.5 rounded"
                            title="Save to your browser for reuse in future meetings"
                          >
                            Remember
                          </button>
                          <button
                            onClick={() => removeParticipant(i)}
                            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg px-2.5 py-1 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                        <input
                          type="text"
                          placeholder="Name *"
                          value={p.name}
                          onChange={(e) => updateParticipant(i, "name", e.target.value)}
                          className="bg-th-raised border border-th-line-s rounded-lg px-3 py-2 text-sm text-th-fg placeholder-th-fg-muted focus:outline-none focus:border-indigo-500"
                        />
                        <select
                          value={p.persona_id}
                          onChange={(e) => updateParticipant(i, "persona_id", e.target.value)}
                          className="bg-th-raised border border-th-line-s rounded-lg px-3 py-2 text-sm text-th-fg focus:outline-none focus:border-indigo-500"
                        >
                          <option value="">Select persona</option>
                          {personas.map((persona) => (
                            <option key={persona.id} value={persona.id}>
                              {persona.name}
                            </option>
                          ))}
                        </select>
                        <ModelSelect
                          value={p.model_id}
                          onChange={(id) => updateParticipant(i, "model_id", id)}
                          models={models}
                          loading={loadingModels}
                        />
                      </div>

                      <input
                        type="text"
                        placeholder="Background or expertise (optional) — e.g. 10 years in B2B SaaS sales"
                        value={p.description}
                        onChange={(e) => updateParticipant(i, "description", e.target.value)}
                        className="w-full bg-th-raised border border-th-line-s rounded-lg px-3 py-2 text-sm text-th-fg-4 placeholder-th-fg-faint focus:outline-none focus:border-indigo-500"
                      />

                      {p.persona_id && (
                        <p className="text-xs text-th-fg-faint mt-2">
                          {personas.find((x) => x.id === p.persona_id)?.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {/* Start button */}
          <div className="mt-8 max-w-md mx-auto">
            {error && <p className="text-red-400 text-sm mb-3 text-center">{error}</p>}
            <button
              onClick={handleStart}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3.5 transition-colors text-base"
            >
              {loading ? "Starting…" : `Start Meeting${validParticipants.length > 0 ? ` with ${validParticipants.length} participant${validParticipants.length > 1 ? "s" : ""}` : ""}`}
            </button>
            {validParticipants.length === 0 && (
              <p className="text-xs text-th-fg-faint text-center mt-2">
                Add at least one participant to start.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
