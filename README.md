# Brainstormer

A decision-support tool that simulates a meeting with multiple AI participants. Bring a topic or decision to the table — each AI participant contributes their perspective based on a chosen model and persona. The conversation continues in rounds until the discussion is exhausted, then produces a summary.

## How it works

1. **Create a meeting** — enter a topic, add AI participants (each with a model + persona), set a speaking threshold
2. **Discussion rounds** — each turn, participants assess their urgency to speak (0-10). Those above the threshold respond in urgency order. You can contribute, ask questions, or pass.
3. **Summary** — when the discussion concludes, a structured Markdown summary is generated inline

### Key features

- **Urgency-based turn system** — participants only speak when they have something meaningful to add
- **Multiple AI models** — mix models from OpenRouter's full catalogue (GPT-4o, Claude, Gemini, Llama, etc.)
- **8 built-in personas** — Devil's Advocate, Pragmatist, Visionary, Risk Analyst, Optimist, Critic, Mediator, Domain Expert
- **Auto-pilot mode** — let participants discuss autonomously; jump in whenever you want
- **Web-enabled participants** — optionally give participants web search access
- **Smart participant suggestions** — describe your topic and get AI-suggested participants
- **Meeting liveliness guards** — early-turn urgency floors and revival mechanics prevent premature endings

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

Create a `.env` file in the project root:

```
OPENROUTER_API_KEY=sk-or-...
```

Or enter your API key in the app's settings panel (stored in browser localStorage).

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

## Deploy to Render

Connect the GitHub repo — Render auto-detects `render.yaml`:

- **Build**: installs frontend + backend deps, builds the frontend
- **Start**: runs uvicorn serving both API and static files
- **Single service**, single URL

Set `OPENROUTER_API_KEY` as an environment variable in the Render dashboard (or have users provide their own key via the UI).

## Project structure

```
brainstormer/
├── render.yaml                # Render deployment config
├── backend/
│   ├── main.py                # FastAPI app + static serving
│   ├── meeting_engine.py      # Turn logic, urgency, revival
│   ├── models.py              # Data models + personas
│   ├── openrouter.py          # OpenRouter API client
│   ├── tools.py               # Web search/fetch for agents
│   ├── requirements.txt
│   └── prompts/               # YAML prompt templates
│       ├── urgency.yaml
│       ├── response.yaml
│       ├── revival.yaml
│       └── summary.yaml
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── api.ts
        ├── types.ts
        └── components/
            ├── SetupScreen.tsx
            └── MeetingScreen.tsx
```

## License

MIT
