import { useState, useEffect } from "react";
import type { Meeting } from "./types";
import SetupScreen from "./components/SetupScreen";
import MeetingScreen from "./components/MeetingScreen";
import { reopenMeeting, onApiKeyError } from "./api";
import type { HistoryEntry } from "./utils/history";

type Screen = "setup" | "meeting";

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [historicalSummary, setHistoricalSummary] = useState<string | null>(null);
  const [showKeyError, setShowKeyError] = useState(false);

  useEffect(() => onApiKeyError(() => setShowKeyError(true)), []);

  function handleMeetingCreated(m: Meeting) {
    setMeeting(m);
    setHistoricalSummary(null);
    setScreen("meeting");
  }

  function handleOpenHistorical(entry: HistoryEntry) {
    setMeeting(entry.meeting);
    setHistoricalSummary(entry.summary ?? null);
    setScreen("meeting");
  }

  function handleRestart() {
    setMeeting(null);
    setHistoricalSummary(null);
    setScreen("setup");
  }

  async function handleReopen(newThreshold: number) {
    if (!meeting) return;
    const updated = await reopenMeeting(meeting.id, newThreshold);
    setMeeting(updated);
  }

  return (
    <div className="min-h-screen bg-th-page text-th-fg">
      {screen === "setup" && (
        <SetupScreen
          onMeetingCreated={handleMeetingCreated}
          onOpenHistorical={handleOpenHistorical}
        />
      )}
      {screen === "meeting" && meeting && (
        <MeetingScreen
          meeting={meeting}
          onReopen={handleReopen}
          onRestart={handleRestart}
          historicalSummary={historicalSummary}
        />
      )}

      {showKeyError && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4">
          <div className="bg-th-card border border-th-border rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-th-fg mb-3">Invalid OpenRouter API Key</h2>
            <p className="text-th-muted text-sm mb-4">
              Your OpenRouter API key is missing or invalid. To use Brainstormer you need a valid key.
            </p>
            <ol className="text-th-muted text-sm mb-5 list-decimal list-inside space-y-2">
              <li>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Create a new API key on OpenRouter
                </a>
              </li>
              <li>Enter it in the Settings panel (gear icon, top-right)</li>
            </ol>
            <button
              onClick={() => setShowKeyError(false)}
              className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
