import { useState } from "react";
import type { Meeting } from "./types";
import SetupScreen from "./components/SetupScreen";
import MeetingScreen from "./components/MeetingScreen";
import { reopenMeeting } from "./api";
import type { HistoryEntry } from "./utils/history";

type Screen = "setup" | "meeting";

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [historicalSummary, setHistoricalSummary] = useState<string | null>(null);

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
    </div>
  );
}
