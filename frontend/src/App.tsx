import { useState } from "react";
import type { Meeting } from "./types";
import SetupScreen from "./components/SetupScreen";
import MeetingScreen from "./components/MeetingScreen";
import { reopenMeeting } from "./api";

type Screen = "setup" | "meeting";

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  function handleMeetingCreated(m: Meeting) {
    setMeeting(m);
    setScreen("meeting");
  }

  function handleRestart() {
    setMeeting(null);
    setScreen("setup");
  }

  async function handleReopen(newThreshold: number) {
    if (!meeting) return;
    const updated = await reopenMeeting(meeting.id, newThreshold);
    setMeeting(updated);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {screen === "setup" && (
        <SetupScreen onMeetingCreated={handleMeetingCreated} />
      )}
      {screen === "meeting" && meeting && (
        <MeetingScreen
          meeting={meeting}
          onReopen={handleReopen}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}
