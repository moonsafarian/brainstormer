import { useState } from "react";

const DONT_SHOW_KEY = "brainstormer_skip_intro";

export function shouldShowIntro(): boolean {
  if (localStorage.getItem(DONT_SHOW_KEY) === "1") return false;
  if (sessionStorage.getItem("brainstormer_intro_seen") === "1") return false;
  return true;
}

export function markIntroSeen(): void {
  sessionStorage.setItem("brainstormer_intro_seen", "1");
}

interface Props {
  onStart: () => void;
}

const steps = [
  {
    title: "Describe your topic",
    description:
      "Start by describing the problem, idea, or decision you want to explore. You can also specify the language for the discussion. The more context you provide, the richer the conversation will be.",
  },
  {
    title: "Build your panel",
    description:
      "You can ask AI to suggest participants tailored to your topic, each with a unique role, personality, and expertise. You can also create your own from scratch, or mix and match. Save your favourite panels as templates for future sessions.",
  },
  {
    title: "Run the meeting",
    description:
      "The conversation unfolds in turns. At each turn, every participant (and you) can choose to speak or pass. Send messages to steer the discussion, or sit back and let them debate. Each participant reads the full conversation and responds in character, reacting to each other's points. Participants can also search the web for up-to-date information to support their arguments.",
  },
  {
    title: "Get a summary & keep going",
    description:
      "End the meeting to get a structured summary of key ideas, points of agreement, and open questions. Not done yet? Reopen the meeting and pick up right where you left off.",
  },
];

export default function IntroScreen({ onStart }: Props) {
  const [dontShow, setDontShow] = useState(false);

  function handleStart() {
    markIntroSeen();
    if (dontShow) localStorage.setItem(DONT_SHOW_KEY, "1");
    onStart();
  }

  return (
    <div className="min-h-screen bg-th-page flex items-center justify-center p-4">
      <div className="max-w-3xl w-full">
        {/* Header */}
        <div className="text-center mb-4">
          <h1 className="text-3xl font-bold text-th-fg mb-1">
            Welcome to Brainstormer
          </h1>
          <p className="text-th-muted text-sm leading-relaxed">
            Run simulated meetings where multiple AI models debate, challenge,
            and build on each other's ideas.
          </p>
          <p className="text-th-muted text-sm leading-relaxed mt-1">
            Mixing models (e.g. Claude, GPT, Gemini, Llama) means genuinely
            different reasoning styles in the same conversation, not just
            different prompts on the same engine.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-2 mb-4">
          {steps.map((step, i) => (
            <div
              key={i}
              className="flex gap-3 items-start bg-th-card border border-th-border rounded-xl p-3"
            >
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                {i + 1}
              </div>
              <div>
                <h3 className="font-semibold text-th-fg text-sm">
                  {step.title}
                </h3>
                <p className="text-th-muted text-sm mt-0.5">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="text-center space-y-2">
          <button
            onClick={handleStart}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-base font-semibold transition-colors"
          >
            START
          </button>
          <label className="flex items-center justify-center gap-2 text-th-muted text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="rounded border-th-border accent-blue-600"
            />
            Don't show this again
          </label>
        </div>
      </div>
    </div>
  );
}
