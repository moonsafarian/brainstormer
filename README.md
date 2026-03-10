# Brainstormer

A decision-support tool that simulates meetings with multiple AI participants. Bring a topic or decision to the table — each AI participant contributes their perspective based on a chosen model and persona. The conversation continues in rounds until the discussion is exhausted, then produces a structured summary.

## How it works

1. **Describe your topic** — enter the problem, idea, or decision you want to explore. You can specify the discussion language.
2. **Build your panel** — get AI-suggested participants tailored to your topic, create your own from scratch, or mix both. Each participant has a model, persona, and optional custom background. Save favourites for reuse.
3. **Run the meeting** — each turn, participants assess their urgency to speak (0–10). Those above the threshold respond in urgency order. You can contribute messages, steer the discussion, or sit back and watch. Participants can search the web for up-to-date information.
4. **Get a summary & keep going** — end the meeting for a structured summary in the discussion language. Not done? Reopen and continue.

### Key features

- **Urgency-based turn system** — participants only speak when they have something meaningful to add
- **Multiple AI models** — mix models from OpenRouter's full catalogue (Claude, GPT, Gemini, Grok, DeepSeek, Llama, etc.)
- **8 built-in personas** — Devil's Advocate, Pragmatist, Visionary, Risk Analyst, Optimist, Critic, Mediator, Domain Expert
- **Web-enabled participants** — participants can search the web and fetch URLs to ground their arguments in real data
- **Smart participant suggestions** — describe your topic and get AI-suggested participants with diverse models and roles
- **Meeting liveliness guards** — early-turn urgency floors, per-participant contribution minimums, and revival mechanics prevent premature endings
- **Meeting history** — previous meetings are saved in the browser and can be reopened or deleted
- **Saved participants** — remember favourite participants across sessions
- **Streaming responses** — SSE-based streaming for turns and summary generation
- **Multilingual** — discussions and summaries adapt to whatever language participants use

## Setup

### Prerequisites

- Python 3.9+
- Node.js 18+
- An [OpenRouter](https://openrouter.ai/) API key

### Install

```bash
# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### Configure

Create a `.env` file in `backend/`:

```
OPENROUTER_API_KEY=sk-or-...
```

Or enter your API key in the app's settings panel (gear icon, top-right). Keys entered in the UI are stored obfuscated in browser localStorage and sent with every request, overriding the server-side default.

### Run (development)

```bash
# Terminal 1 — backend
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` requests to the backend.

### Run (production)

```bash
cd frontend && npm run build && cd ..
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
```

FastAPI serves the built frontend automatically.


## Project structure

```
brainstormer/
├── render.yaml                  # Render deployment config
├── backend/
│   ├── main.py                  # FastAPI app + static serving
│   ├── meeting_engine.py        # Turn logic, urgency, revival
│   ├── models.py                # Data models + personas
│   ├── openrouter.py            # OpenRouter API client + streaming
│   ├── tools.py                 # Web search/fetch (DDG HTML + fallback)
│   ├── requirements.txt
│   └── prompts/                 # YAML prompt templates
│       ├── urgency.yaml
│       ├── response.yaml
│       ├── revival.yaml
│       └── summary.yaml
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── api.ts               # API client + SSE helpers
        ├── types.ts
        ├── index.css            # Tailwind + theme tokens
        ├── components/
        │   ├── IntroScreen.tsx   # First-time welcome screen
        │   ├── SetupScreen.tsx   # Topic, participants, settings
        │   └── MeetingScreen.tsx # Discussion, summary, history
        └── utils/
            ├── apiKey.ts        # Obfuscated key storage
            ├── history.ts       # Meeting history (localStorage)
            ├── modelMatch.ts    # Jaccard model name matching
            ├── suggestionModel.ts
            └── theme.ts         # Light/dark toggle
```

## License

MIT
