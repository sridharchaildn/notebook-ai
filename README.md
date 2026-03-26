# Notebook AI

Desktop-first AI note taker with local markdown storage, Electron UX, a new Next.js web app, and FastAPI/LangChain backends.

## Architecture

Notebook AI is a monorepo:
- `apps/desktop`: Electron + React + Vite desktop recorder/editor
- `apps/web`: Next.js landing, signup, legal acceptance, onboarding, and web settings
- `services/local-sidecar`: local FastAPI note/transcript API
- `services/cloud-api`: hosted FastAPI auth/provider/settings API
- `packages/contracts`: shared TypeScript API contracts
- `packages/theme`: shared design tokens (light/dark)
- `packages/ui`: shared React primitives

```mermaid
flowchart TB
  subgraph machine["Your machine"]
    Desktop["Desktop app<br/>Electron · React · Vite"]
    Web["Web app<br/>Next.js"]
    Sidecar["Local sidecar<br/>FastAPI · LangChain"]
    Notes[("Markdown notes<br/>on disk")]
    Desktop -->|"localhost"| Sidecar
    Sidecar --> Notes
    Desktop -->|"open sign-in in browser"| Web
  end
  subgraph network["Network"]
    Cloud["Cloud API<br/>FastAPI"]
    Vault[("Credential vault<br/>SQLite")]
    Supabase["Supabase"]
    Providers["Provider APIs<br/>OpenAI · OpenRouter · …"]
    Cloud --- Vault
    Cloud --> Supabase
  end
  Web -->|"signup · legal accept · onboarding"| Cloud
  Desktop -->|"desktop auth exchange · BYOK · OAuth flows"| Cloud
  Sidecar -->|"API keys when not in sidecar .env"| Cloud
  Sidecar -->|"streamed transform · transcription"| Providers
```

## Why a local sidecar?

A **sidecar** here is a small **local HTTP service** you run next to the desktop app (not a second cloud). It exists so normal work stays **local-first and low-latency**:

- **Notes:** Create, list, and save markdown through the sidecar so content stays on your filesystem and the UI does not depend on a remote service for every edit.
- **AI and transcription:** Streaming transforms and audio round-trips go to the sidecar on `localhost`, which talks to provider APIs using keys from your env or from the cloud vault—so you get responsive streaming without routing note bodies or every model call through hosted infrastructure.

The **cloud API** is a separate companion: session exchange, legal acceptance, provider OAuth/BYOK, storage preferences, desktop auth handoff, and Drive integration metadata. It does **not** store your note markdown or sit in the path for debounced note persistence.

## UX Highlights

- Fast local-first note editing with debounced persistence
- Streaming AI action panel (`summarize`, `rewrite`, `extract_action_items`)
- Unified web + desktop visual system with shared tokens/components
- Dark and light themes with persisted preference

## Quick Start

1. Install workspace dependencies:
   - `npm install`
2. Create Python envs for each service and install dependencies:
   - `cd services/local-sidecar && python3.11 -m venv .venv && source .venv/bin/activate && pip install -e .'[dev]'`
   - `cd services/cloud-api && python3.11 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'`
3. Run services:
   - Local sidecar (recommended for live interviews): `uvicorn app.main:app --port 8787`
   - Cloud API: `uvicorn app.main:app --port 8790`
   - Dev-only hot reload variants: add `--reload` when you are not running long live capture sessions.
4. Run web app:
   - `npm run dev:web`
5. Run desktop app:
   - `npm run dev:desktop`

## Environment

See `.env.example` in:
- `services/local-sidecar`
- `services/cloud-api`
- `apps/desktop`
- `apps/web`

## API Surface

- Local sidecar:
  - `POST /notes`
  - `GET /notes`
  - `PUT /notes/{id}`
  - `PATCH /notes/{id}/move`
  - `DELETE /notes/{id}`
  - `GET /folders`
  - `POST /folders`
  - `PATCH /folders/{id}`
  - `DELETE /folders/{id}`
  - `GET /storage/local-root`
  - `PUT /storage/local-root`
  - `GET /storage/preference`
  - `PUT /storage/preference`
  - `GET /sync/status`
  - `POST /sync/run`
  - `POST /ai/transform/stream` (SSE)
  - `GET /providers/status`
  - `POST /providers/status/cache`
- Cloud API:
  - `POST /auth/session/exchange`
  - `POST /auth/desktop/exchange/init`
  - `POST /auth/desktop/exchange/complete`
  - `GET /legal/current`
  - `POST /legal/accept`
  - `GET /settings/storage`
  - `PUT /settings/storage`
  - `GET /providers/openai/oauth/start`
  - `GET /providers/openai/oauth/callback`
  - `GET /integrations/google-drive/oauth/start`
  - `GET /integrations/google-drive/oauth/callback`
  - `GET /integrations/google-drive/status`
  - `POST /integrations/google-drive/access-token`
  - `POST /providers/byok`
  - `GET /providers/credential`
  - `DELETE /providers/{provider}`
