# Notebook AI

Desktop-first AI note taker with local markdown storage, Electron UX, and FastAPI/LangChain backends.

## Architecture

- `apps/desktop`: Electron + React + Vite + TypeScript desktop app
- `services/local-sidecar`: Local FastAPI service for markdown notes and AI transform streaming
- `services/cloud-api`: Hosted FastAPI service for Supabase auth exchange, provider connect, and credential vault
- `packages/contracts`: Shared TypeScript contracts for desktop-side API interaction

## Why A Sidecar

- The local sidecar keeps note I/O and transcription/AI roundtrips low-latency on your machine.
- The cloud API only handles account/auth/provider credential vault concerns.
- This split keeps note content local-first while still enabling provider OAuth/BYOK management.

## UX Highlights

- Fast local-first note editing with debounced persistence
- Streaming AI action panel (`summarize`, `rewrite`, `extract_action_items`)
- Rich desktop layout with intentional typography and atmospheric visuals
- Dark and light themes with persisted preference

## Quick Start

1. Install desktop dependencies:
   - `npm install --workspace @notebook-ai/desktop`
2. Create Python envs for each service and install dependencies:
   - `cd services/local-sidecar && python3.11 -m venv .venv && source .venv/bin/activate && pip install -e .'[dev]'`
   - `cd services/cloud-api && python3.11 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'`
3. Run services:
   - Local sidecar (recommended for live interviews): `uvicorn app.main:app --port 8787`
   - Cloud API: `uvicorn app.main:app --port 8790`
   - Dev-only hot reload variants: add `--reload` when you are not running long live capture sessions.
4. Run desktop app:
   - `npm run dev:desktop`

## Environment

See `.env.example` files under each service for required variables.

## API Surface

- Local sidecar:
  - `POST /notes`
  - `GET /notes`
  - `PUT /notes/{id}`
  - `POST /ai/transform/stream` (SSE)
  - `GET /providers/status`
  - `POST /providers/status/cache`
- Cloud API:
  - `POST /auth/session/exchange`
  - `GET /providers/openai/oauth/start`
  - `GET /providers/openai/oauth/callback`
  - `POST /providers/byok`
  - `GET /providers/credential`
  - `DELETE /providers/{provider}`
