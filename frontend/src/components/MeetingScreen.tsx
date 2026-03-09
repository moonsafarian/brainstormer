import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Meeting,
  Participant,
  UrgencyEvent,
} from "../types";
import { requestSummary, runTurn } from "../api";

const MD_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-gray-100">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic text-gray-300">{children}</em>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="border-l-2 border-gray-600 pl-3 italic text-gray-400 mb-2">{children}</blockquote>,
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    className
      ? <code className="block bg-gray-800 rounded-lg px-3 py-2 mb-2 text-sm font-mono overflow-x-auto">{children}</code>
      : <code className="bg-gray-800 rounded px-1 text-sm font-mono">{children}</code>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-lg font-bold text-gray-100 mb-2 mt-3 first:mt-0">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-base font-bold text-gray-100 mb-1.5 mt-3 first:mt-0">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="font-semibold text-gray-200 mb-1 mt-2 first:mt-0">{children}</h3>,
};

interface LiveContribution {
  participantId: string;
  urgency: number;
  streaming: boolean;
  content: string;
  didSpeak: boolean;
  toolUses: { tool: string; input: string }[];
}

interface LiveTurn {
  number: number;
  humanMessage: string | null;
  contributions: LiveContribution[];
  urgencyMap: Record<string, UrgencyEvent>;
  assessingUrgency: boolean;
}

function participantById(meeting: Meeting, id: string): Participant | undefined {
  return meeting.participants.find((p) => p.id === id);
}

function UrgencyBadge({ score }: { score: number }) {
  const color =
    score >= 7 ? "bg-red-900/60 text-red-300" :
    score >= 4 ? "bg-yellow-900/60 text-yellow-300" :
                 "bg-gray-800/60 text-gray-500";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${color}`}>
      {score}/10
    </span>
  );
}

function ContributionBubble({
  contribution,
  participant,
}: {
  contribution: LiveContribution;
  participant: Participant | undefined;
}) {
  if (!contribution.didSpeak) {
    return (
      <div className="flex items-center gap-2 py-1 opacity-40">
        <span className="text-sm text-gray-500">
          {participant?.name ?? "?"} passed
        </span>
        <UrgencyBadge score={contribution.urgency} />
      </div>
    );
  }

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-base font-semibold text-indigo-300">
          {participant?.name ?? "?"}
        </span>
        <span className="text-sm text-gray-500">{participant?.persona.name}</span>
        <UrgencyBadge score={contribution.urgency} />
        {contribution.streaming && !contribution.toolUses.length && (
          <span className="text-xs text-gray-600 animate-pulse">typing…</span>
        )}
      </div>
      {contribution.toolUses.length > 0 && (
        <div className="mb-2 space-y-1">
          {contribution.toolUses.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
              <span>{t.tool === "search_web" ? "🔍" : "🌐"}</span>
              <span className="truncate italic">{t.input}</span>
              {contribution.streaming && i === contribution.toolUses.length - 1 && (
                <span className="animate-pulse">…</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="bg-gray-900/80 border border-gray-800/50 rounded-xl px-5 py-4 text-base text-gray-200 leading-relaxed">
        {contribution.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {contribution.content}
          </ReactMarkdown>
        ) : (
          <span className="text-gray-600 animate-pulse">▍</span>
        )}
      </div>
    </div>
  );
}

function TurnBlock({
  turn,
  meeting,
  humanName,
}: {
  turn: LiveTurn;
  meeting: Meeting;
  humanName?: string;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-px flex-1 bg-gray-800/60" />
        <span className="text-xs text-gray-600 font-medium uppercase tracking-wider">
          Round {turn.number}
        </span>
        <div className="h-px flex-1 bg-gray-800/60" />
      </div>

      {/* Human message */}
      {turn.humanMessage && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-base font-semibold text-emerald-400">
              {humanName || "You"}
            </span>
          </div>
          <div className="bg-indigo-950/40 border border-indigo-500/20 rounded-xl px-5 py-4 text-base text-indigo-100 leading-relaxed">
            {turn.humanMessage}
          </div>
        </div>
      )}

      {/* Urgency assessment indicator */}
      {turn.assessingUrgency && (
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-4 animate-pulse">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83"/>
          </svg>
          Participants are deciding whether to speak…
        </div>
      )}

      {/* Contributions */}
      {turn.contributions.map((c) => (
        <ContributionBubble
          key={c.participantId}
          contribution={c}
          participant={participantById(meeting, c.participantId)}
        />
      ))}
    </div>
  );
}

function SummaryBlock({
  text,
  streaming,
  onCopy,
  copied,
}: {
  text: string;
  streaming?: boolean;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="my-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-indigo-500/20" />
        <span className="text-xs text-indigo-400 uppercase tracking-wider font-medium">Summary</span>
        {onCopy && text && !streaming && (
          <button
            onClick={onCopy}
            className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded-lg px-2 py-0.5 transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
        <div className="h-px flex-1 bg-indigo-500/20" />
      </div>
      <div className="bg-indigo-950/20 border border-indigo-500/10 rounded-xl px-6 py-5 text-sm text-gray-200 leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
          {text}
        </ReactMarkdown>
        {streaming && <span className="animate-pulse">▍</span>}
      </div>
    </div>
  );
}

function buildTranscriptText(meeting: Meeting, turns: LiveTurn[]): string {
  const lines: string[] = [`Topic: ${meeting.topic}`, ""];
  for (const turn of turns) {
    lines.push(`=== Turn ${turn.number} ===`);
    if (turn.humanMessage) {
      const label = meeting.human_name || "You";
      lines.push(`${label}: ${turn.humanMessage}`);
    }
    for (const c of turn.contributions) {
      if (!c.didSpeak || !c.content) continue;
      const p = meeting.participants.find((x) => x.id === c.participantId);
      const name = p ? `${p.name} (${p.persona.name})` : c.participantId;
      lines.push(`${name}: ${c.content}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/* ── Participant sidebar card ─────────────────────────────────────────────── */

function ParticipantPill({
  participant,
  isSpeaking,
}: {
  participant: Participant;
  isSpeaking: boolean;
}) {
  return (
    <div className={`rounded-lg px-3 py-2 transition-colors ${isSpeaking ? "bg-indigo-950/60 border border-indigo-500/30" : "bg-gray-900/50"}`}>
      <div className="flex items-center gap-2">
        {isSpeaking && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />}
        <span className={`text-sm font-medium truncate ${isSpeaking ? "text-indigo-300" : "text-gray-300"}`}>
          {participant.name}
        </span>
      </div>
      <div className="text-xs text-gray-500 mt-0.5 truncate">{participant.persona.name}</div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */

export default function MeetingScreen({
  meeting,
  onReopen,
  onRestart,
}: {
  meeting: Meeting;
  onReopen: (threshold: number) => Promise<void>;
  onRestart: () => void;
}) {
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [humanInput, setHumanInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [summaryStreaming, setSummaryStreaming] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [isFirstTurn, setIsFirstTurn] = useState(true);
  const [reopenThreshold, setReopenThreshold] = useState(Math.max(1, meeting.speaking_threshold - 1));
  const [summaryDone, setSummaryDone] = useState(false);
  const [pastSummaries, setPastSummaries] = useState<{ afterTurnIndex: number; text: string }[]>([]);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedDiscussion, setCopiedDiscussion] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, summaryText]);

  function newLiveTurn(number: number, humanMessage: string | null): LiveTurn {
    return {
      number,
      humanMessage,
      contributions: [],
      urgencyMap: {},
      assessingUrgency: true,
    };
  }

  async function submitTurn(humanMessage: string | null) {
    if (isRunning) return;
    setIsRunning(true);
    setIsFirstTurn(false);

    const turnNumber = turns.length + 1;
    const liveTurn = newLiveTurn(turnNumber, humanMessage);

    setTurns((prev) => [...prev, liveTurn]);

    const updateTurn = (fn: (t: LiveTurn) => LiveTurn) => {
      setTurns((prev) =>
        prev.map((t, i) => (i === prev.length - 1 ? fn(t) : t))
      );
    };

    await runTurn(meeting.id, humanMessage, {
      onUrgency(e) {
        updateTurn((t) => ({
          ...t,
          urgencyMap: { ...t.urgencyMap, [e.participant_id]: e },
        }));
      },
      onResponseStart(e) {
        setSpeakingId(e.participant_id);
        updateTurn((t) => ({
          ...t,
          assessingUrgency: false,
          contributions: [
            ...t.contributions,
            {
              participantId: e.participant_id,
              urgency: e.urgency,
              streaming: true,
              content: "",
              didSpeak: true,
              toolUses: [],
            },
          ],
        }));
      },
      onToolUse(e) {
        updateTurn((t) => ({
          ...t,
          contributions: t.contributions.map((c) =>
            c.participantId === e.participant_id
              ? { ...c, toolUses: [...c.toolUses, { tool: e.tool, input: e.input }] }
              : c
          ),
        }));
      },
      onResponseChunk(e) {
        updateTurn((t) => ({
          ...t,
          contributions: t.contributions.map((c) =>
            c.participantId === e.participant_id
              ? { ...c, content: c.content + e.chunk }
              : c
          ),
        }));
      },
      onResponseEnd(e) {
        setSpeakingId(null);
        updateTurn((t) => ({
          ...t,
          contributions: t.contributions.map((c) =>
            c.participantId === e.participant_id ? { ...c, streaming: false } : c
          ),
        }));
      },
      onTurnComplete(e) {
        setSpeakingId(null);
        // Add silent participants
        updateTurn((t) => {
          const spokenIds = new Set(t.contributions.map((c) => c.participantId));
          const silent: LiveContribution[] = Object.values(t.urgencyMap)
            .filter((u) => !spokenIds.has(u.participant_id))
            .map((u) => ({
              participantId: u.participant_id,
              urgency: u.urgency,
              streaming: false,
              content: "",
              didSpeak: false,
              toolUses: [],
            }));
          return { ...t, assessingUrgency: false, contributions: [...t.contributions, ...silent] };
        });

        if (e.meeting_ended) {
          setMeetingEnded(true);
          handleEndAndSummarize();
        }
        setIsRunning(false);
      },
      onError(err) {
        console.error(err);
        setSpeakingId(null);
        setIsRunning(false);
      },
    });
  }

  // Use a ref so the onComplete callback reads the final accumulated text
  const summaryRef = useRef("");
  useEffect(() => {
    summaryRef.current = summaryText;
  }, [summaryText]);

  async function handleEndAndSummarize() {
    setMeetingEnded(true);
    setSummaryStreaming(true);
    await requestSummary(meeting.id, {
      onChunk(e) {
        setSummaryText((prev) => prev + e.chunk);
      },
      onComplete() {
        setSummaryStreaming(false);
        setSummaryDone(true);
      },
      onError(err) {
        console.error(err);
        setSummaryStreaming(false);
      },
    });
  }

  async function handleReopenClick() {
    await onReopen(reopenThreshold);
    if (summaryText) {
      setPastSummaries((prev) => [...prev, { afterTurnIndex: turns.length - 1, text: summaryText }]);
      setSummaryText("");
    }
    setMeetingEnded(false);
    setSummaryDone(false);
    setIsFirstTurn(false);
  }

  function handleHumanSubmit(pass: boolean) {
    const msg = pass ? null : humanInput.trim() || null;
    setHumanInput("");
    submitTurn(msg);
  }

  const canInteract = !isRunning && !meetingEnded && !summaryStreaming;

  return (
    <div className="flex h-screen">
      {/* ── Left sidebar: participants ──────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-gray-800/60 bg-gray-950">
        <div className="px-4 pt-5 pb-3 border-b border-gray-800/60">
          <button
            onClick={onRestart}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors mb-3 flex items-center gap-1"
          >
            <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 1L3 5l4 4"/>
            </svg>
            New meeting
          </button>
          <h2 className="text-sm font-semibold text-gray-200 leading-snug line-clamp-3">
            {meeting.topic}
          </h2>
          <div className="text-xs text-gray-600 mt-1">
            Threshold {meeting.speaking_threshold}/10
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          <p className="text-xs text-gray-600 uppercase tracking-wide font-medium px-1 mb-1">
            Participants
          </p>
          {meeting.participants.map((p) => (
            <ParticipantPill
              key={p.id}
              participant={p}
              isSpeaking={speakingId === p.id}
            />
          ))}
        </div>

        {/* Sidebar actions */}
        <div className="px-3 py-3 border-t border-gray-800/60 space-y-2">
          {turns.length > 0 && (
            <button
              onClick={() => copyToClipboard(buildTranscriptText(meeting, turns), setCopiedDiscussion)}
              className="w-full text-xs text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 rounded-lg px-3 py-2 transition-colors text-left"
            >
              {copiedDiscussion ? "Copied!" : "Copy full discussion"}
            </button>
          )}
          {(meetingEnded || turns.length > 0) && !summaryStreaming && !summaryText && (
            <button
              onClick={handleEndAndSummarize}
              disabled={isRunning || summaryStreaming}
              className="w-full text-xs text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 rounded-lg px-3 py-2 disabled:opacity-40 transition-colors text-left"
            >
              End & Summarize
            </button>
          )}
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile header (hidden on lg+) */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-gray-800/60 bg-gray-950/90 backdrop-blur shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-200 truncate">{meeting.topic}</h2>
            <div className="flex gap-2 text-xs text-gray-500">
              <span>Threshold {meeting.speaking_threshold}/10</span>
              <span className="truncate">{meeting.participants.map((p) => p.name).join(", ")}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {turns.length > 0 && (
              <button
                onClick={() => copyToClipboard(buildTranscriptText(meeting, turns), setCopiedDiscussion)}
                className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded-lg px-2.5 py-1.5 transition-colors"
              >
                {copiedDiscussion ? "Copied!" : "Copy"}
              </button>
            )}
            {(meetingEnded || turns.length > 0) && !summaryStreaming && !summaryText && (
              <button
                onClick={handleEndAndSummarize}
                disabled={isRunning || summaryStreaming}
                className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded-lg px-2.5 py-1.5 disabled:opacity-40 transition-colors"
              >
                End
              </button>
            )}
          </div>
        </header>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

            {/* Welcome / first-turn prompt */}
            {isFirstTurn && turns.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center mb-5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-100 mb-2">
                  Your meeting is ready
                </h3>
                <p className="text-gray-400 text-sm max-w-md leading-relaxed mb-2">
                  {meeting.participants.length} participant{meeting.participants.length > 1 ? "s are" : " is"} waiting
                  to discuss <span className="text-gray-200">"{meeting.topic}"</span>.
                </p>
                <p className="text-gray-500 text-sm max-w-md leading-relaxed">
                  Write an opening message below to start the discussion. After you send it,
                  each participant will decide whether they have something to contribute.
                </p>
              </div>
            )}

            {/* Turns + interleaved past summaries */}
            {turns.map((turn, i) => {
              const pastSummary = pastSummaries.find((s) => s.afterTurnIndex === i);
              return (
                <div key={i}>
                  <TurnBlock turn={turn} meeting={meeting} humanName={meeting.human_name ?? undefined} />
                  {pastSummary && (
                    <SummaryBlock text={pastSummary.text} />
                  )}
                </div>
              );
            })}

            {/* Live summary */}
            {(summaryStreaming || summaryText) && (
              <SummaryBlock
                text={summaryText}
                streaming={summaryStreaming}
                onCopy={() => copyToClipboard(summaryText, setCopiedSummary)}
                copied={copiedSummary}
              />
            )}

            {/* Post-summary actions */}
            {summaryDone && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-2 mb-6">
                <button
                  onClick={onRestart}
                  className="text-sm border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-200 rounded-xl px-5 py-2.5 transition-colors"
                >
                  Start a new meeting
                </button>
                <div className="flex items-center gap-3 bg-gray-900/60 border border-gray-800/60 rounded-xl px-4 py-2.5">
                  <span className="text-xs text-gray-500">Reopen with threshold</span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={reopenThreshold}
                    onChange={(e) => setReopenThreshold(Number(e.target.value))}
                    className="w-24 accent-indigo-500"
                  />
                  <span className="text-xs text-gray-300 w-8 text-center">{reopenThreshold}/10</span>
                  <button
                    onClick={handleReopenClick}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Continue discussion
                  </button>
                </div>
              </div>
            )}

            {/* Auto-end notice + reopen (no summary yet) */}
            {meetingEnded && !summaryStreaming && !summaryDone && (
              <div className="mt-4 mb-6 text-center">
                <p className="text-sm text-gray-500 mb-3">
                  The discussion has concluded — no participant had more to add.
                </p>
                <div className="inline-flex items-center gap-3 bg-gray-900/60 border border-gray-800/60 rounded-xl px-4 py-3">
                  <span className="text-xs text-gray-400">Lower threshold to reopen</span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={reopenThreshold}
                    onChange={(e) => setReopenThreshold(Number(e.target.value))}
                    className="w-28 h-2 rounded-full appearance-none cursor-pointer accent-indigo-500"
                    style={{
                      background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${(reopenThreshold - 1) / 9 * 100}%, #374151 ${(reopenThreshold - 1) / 9 * 100}%, #374151 100%)`,
                    }}
                  />
                  <span className="text-xs text-gray-300 w-8 text-center">{reopenThreshold}/10</span>
                  <button
                    onClick={handleReopenClick}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Reopen
                  </button>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* ── Input area ───────────────────────────────────────────────── */}
        {!meetingEnded ? (
          <div className="shrink-0 border-t border-gray-800/60 bg-gray-950/90 backdrop-blur">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
              {/* Status banner */}
              {canInteract && (
                <div className="flex items-center gap-3 mb-3 px-4 py-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/20">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse shrink-0" />
                  <span className="text-sm text-indigo-300 font-medium">Your turn</span>
                  <span className="text-xs text-indigo-500/80">
                    {isFirstTurn
                      ? "Send an opening message to kick off the discussion."
                      : "Participants are waiting for your input. You can also pass."}
                  </span>
                </div>
              )}
              {canInteract && (
                <div className="flex gap-2">
                  <textarea
                    className="flex-1 bg-gray-900/60 border border-gray-700/60 rounded-xl px-4 py-3 text-base text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500/60 resize-none transition-colors"
                    rows={2}
                    placeholder={
                      isFirstTurn
                        ? "Introduce your topic to the group…"
                        : "Add a comment, question, or insight… (leave empty to pass)"
                    }
                    value={humanInput}
                    onChange={(e) => setHumanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleHumanSubmit(false);
                      }
                    }}
                  />
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => handleHumanSubmit(false)}
                      disabled={isFirstTurn && !humanInput.trim()}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl px-5 py-2 transition-colors"
                    >
                      Send
                    </button>
                    {!isFirstTurn && (
                      <button
                        onClick={() => handleHumanSubmit(true)}
                        className="border border-gray-700/60 hover:border-gray-500 text-gray-400 hover:text-gray-200 text-sm rounded-xl px-5 py-2 transition-colors"
                      >
                        Pass
                      </button>
                    )}
                  </div>
                </div>
              )}
              {isRunning && (
                <div className="flex items-center justify-center gap-2 text-sm text-gray-500 animate-pulse py-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83"/>
                  </svg>
                  Participants are responding…
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
