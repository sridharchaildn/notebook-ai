# Notebook AI

Desktop-first AI note taker with a local-first Electron UX, a Next.js web app, and FastAPI/LangChain backends.

Licensed under the [MIT License](./LICENSE).

## Architecture

Notebook AI is a monorepo:
- `apps/desktop`: Electron + React + Vite desktop recorder/editor
- `apps/web`: Next.js landing, signup/signin, onboarding, and web settings
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
    Supabase["Supabase"]
    Providers["Provider APIs<br/>OpenAI · OpenRouter · …"]
    Cloud --> Supabase
  end
  Web -->|"signin · onboarding · BYOK"| Cloud
  Desktop -->|"desktop auth exchange · Drive OAuth flows"| Cloud
  Sidecar -->|"streamed transform · transcription"| Providers
```

## Why a local sidecar?

A **sidecar** here is a small **local HTTP service** you run next to the desktop app (not a second cloud). It exists so normal work stays **local-first and low-latency**:

- **Notes:** Create, list, and save markdown through the sidecar so content stays on your filesystem and the UI does not depend on a remote service for every edit.
- **AI and transcription:** Streaming transforms and audio round-trips go to the sidecar on `localhost`, which talks to provider APIs using keys from the sidecar `.env` or keys saved locally by the desktop app on that device.

The **cloud API** is a separate companion: Supabase auth validation, session refresh/logout, web/mobile provider vault storage, storage preferences, desktop auth handoff, and Drive integration metadata. It does **not** store your note markdown or sit in the path for debounced note persistence.

Credential scope is intentionally split:
- Desktop BYOK is stored locally on the device through `services/local-sidecar` and is not synced to the account vault.
- Web and future mobile clients store BYOK only in the cloud API's encrypted account vault.
- Hosted AI routes can use vault credentials server-side, but raw provider secrets do not go back to browser or mobile clients.

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
3. Run services (requires a `.venv` in each service from step 2 so npm uses **Python ≥3.11**, not the system `python3`—e.g. Xcode’s 3.9 will fail on type hints):
   - From repo root: `npm run dev:sidecar` (8787) and `npm run dev:cloud` (8790) in separate terminals, or `npm run dev:services` for both with reload. Scripts call `services/*/ .venv/bin/python` (macOS/Linux).
   - **Windows:** from each service directory run `.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8787` (or `8790` for cloud-api).
   - Or activate a venv and run `uvicorn app.main:app --reload --port 8787` / `--port 8790` (omit `--reload` during long live capture if you prefer).
4. Run web app:
   - `npm run dev:web`
5. Run desktop app:
   - `npm run dev:desktop`

## Setup Guides

- [Supabase, Google Sign-In, and Google Drive Setup](./docs/supabase-google-setup.md)

## Environment

See `.env.example` in:
- `services/local-sidecar`
- `services/cloud-api`
- `apps/desktop`
- `apps/web`

## Versioning And Releases

- `VERSION` is the repo-wide source of truth.
- Run `npm run version:sync` after bumping `VERSION`.
- Generate release notes with `npm run release:notes -- --version <x.y.z>`.
- Build the macOS sidecar package with `npm run release:sidecar:mac`.
- Build the macOS desktop DMG with `npm run release:desktop:mac`.
- See [docs/releases/PROCESS.md](./docs/releases/PROCESS.md) for branch naming and release cadence.

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
  - `POST /providers/byok`
  - `GET /providers/models`
  - `DELETE /providers/{provider}`
- Cloud API:
  - `POST /auth/session/refresh`
  - `POST /auth/logout`
  - `GET /settings/storage`
  - `PUT /settings/storage`
  - `POST /providers/openai/oauth/start`
  - `GET /providers/openai/oauth/callback`
  - `POST /integrations/google-drive/oauth/start`
  - `GET /integrations/google-drive/oauth/callback`
  - `GET /integrations/google-drive/status`
  - `POST /integrations/google-drive/access-token`
  - `POST /providers/byok` (web/mobile encrypted account vault)
  - `GET /providers/status`
  - `GET /providers/credential` (server-side use only)
  - `DELETE /providers/{provider}`
