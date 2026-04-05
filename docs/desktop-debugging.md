# Notebook AI Desktop Debugging Runbook

Practical guide for debugging the Electron desktop app in dev, packaged-app, and release-CI scenarios.

For macOS release packaging steps, see [docs/desktop-release-macos.md](/Users/sridhar2901/git-personal/notebook-ai/docs/desktop-release-macos.md).

## 1) Runtime map

Desktop has four distinct pieces:

1. Renderer
   - React UI in `apps/desktop/src`
   - Talks to the local sidecar for local-first data and hot paths
   - Talks to the cloud API for control-plane features

2. Electron main
   - `apps/desktop/electron/main.ts`
   - Starts the bundled sidecar
   - Owns runtime config for the packaged app
   - Stores desktop auth state and refreshes sessions through the cloud API

3. Local sidecar
   - `services/local-sidecar`
   - Desktop-only Python service on `127.0.0.1:8787`
   - Owns local notes, folders, BYOK writes, sync queue, and local capture/transcription hot paths

4. Cloud API
   - `services/cloud-api`
   - Hosted control plane
   - Owns auth/session exchange, OAuth brokerage, secret storage, and Drive integration metadata

Repo ownership rule:
- Root [AGENTS.md](/Users/sridhar2901/git-personal/notebook-ai/AGENTS.md) defines `services/cloud-api` as the control plane and `services/local-sidecar` as desktop-only local runtime.

## 2) What the cloud API is used for

The cloud API is not the desktop data path for normal note editing.

### Used for

- Desktop auth session refresh and logout
  - `/auth/session/refresh`
  - `/auth/logout`
  - See [main.ts](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/electron/main.ts) and [services/cloud-api/app/main.py](/Users/sridhar2901/git-personal/notebook-ai/services/cloud-api/app/main.py)

- Google Drive OAuth and token brokerage
  - `/integrations/google-drive/oauth/start`
  - `/integrations/google-drive/oauth/callback`
  - `/integrations/google-drive/status`
  - `/integrations/google-drive/folder`
  - `/integrations/google-drive/access-token`
  - See [services/cloud-api/app/main.py](/Users/sridhar2901/git-personal/notebook-ai/services/cloud-api/app/main.py)

- OpenAI OAuth credential brokerage
  - `/providers/openai/oauth/start`
  - `/providers/openai/oauth/callback`
  - See [services/cloud-api/app/main.py](/Users/sridhar2901/git-personal/notebook-ai/services/cloud-api/app/main.py)

- Workspace/storage metadata
  - `/settings/storage`
  - `/workspaces/current`
  - See [services/cloud-api/app/main.py](/Users/sridhar2901/git-personal/notebook-ai/services/cloud-api/app/main.py)

- Secure server-side secret storage
  - Encrypted credential storage for OAuth-backed integrations
  - See [services/cloud-api/app/storage.py](/Users/sridhar2901/git-personal/notebook-ai/services/cloud-api/app/storage.py) and [services/cloud-api/app/security.py](/Users/sridhar2901/git-personal/notebook-ai/services/cloud-api/app/security.py)

### Not used for

- Local note CRUD
- Folder CRUD
- Desktop BYOK save/delete
- Editor keystroke saves
- Live capture hot path
- Local transcript and indexing hot path

Those stay in the local sidecar by design. See [AGENTS.md](/Users/sridhar2901/git-personal/notebook-ai/AGENTS.md), [api.ts](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/src/lib/api.ts), and [services/local-sidecar/app/main.py](/Users/sridhar2901/git-personal/notebook-ai/services/local-sidecar/app/main.py).

## 3) Which service owns which desktop requests

### Local sidecar requests

Examples from [api.ts](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/src/lib/api.ts):

- `GET /health`
- `GET /notes`
- `GET /folders`
- `POST /providers/byok`
- `GET /providers/status`
- `GET /storage/preference`
- `GET /storage/local-root`
- `GET /sync/status`
- `POST /sync/run`
- `GET /settings/transcription`
- `GET /settings/markdown`

### Cloud API requests

Examples from [api.ts](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/src/lib/api.ts):

- `GET /integrations/google-drive/status`
- `POST /integrations/google-drive/oauth/start`
- `POST /auth/logout`

Electron main also uses the cloud API directly for session refresh:

- `POST /auth/session/refresh`
  - See [main.ts](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/electron/main.ts)

## 4) Environment variable rules

This is the part that causes most confusion.

### Build-time desktop config

For release packaging, the desktop workflow injects:

- `VITE_CLOUD_API_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DESKTOP_AUTH_CALLBACK_URL`

See [desktop-release.yml](/Users/sridhar2901/git-personal/notebook-ai/.github/workflows/desktop-release.yml).

These values are baked into the desktop bundle during `npm run build:desktop`.

### Runtime override for packaged app

If you launch the packaged app manually from Terminal, you can override the cloud API at runtime with:

- `NOTEBOOK_CLOUD_API_URL`

Example:

```bash
NOTEBOOK_CLOUD_API_URL="https://example-cloud-api" NOTEBOOK_LOCAL_DEBUG=true "/Applications/Notebook AI.app/Contents/MacOS/Notebook AI"
```

Electron main reads that in [main.ts](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/electron/main.ts).

### Sidecar cloud API URL

Do not wire this separately in GitHub Actions for the packaged app.

Electron main passes the resolved cloud URL into the sidecar as:

- `NOTEBOOK_LOCAL_CLOUD_API_URL`

That happens in [main.ts](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/electron/main.ts). The sidecar reads it in [config.py](/Users/sridhar2901/git-personal/notebook-ai/services/local-sidecar/app/config.py).

### Local source-only sidecar env

`services/local-sidecar/.env` only matters when you run the sidecar directly from source.

Example:

```env
NOTEBOOK_LOCAL_CLOUD_API_URL=http://127.0.0.1:8790
```

That file is not the release config source for the packaged app.

## 5) Fastest debug loop

### Packaged app

Run the installed app from Terminal so you can see Electron main and sidecar logs:

```bash
NOTEBOOK_LOCAL_DEBUG=true "/Applications/Notebook AI.app/Contents/MacOS/Notebook AI" 2>&1 | tee /tmp/notebook-ai-desktop.log
```

If testing against a non-default cloud API:

```bash
NOTEBOOK_CLOUD_API_URL="https://your-cloud-api" NOTEBOOK_LOCAL_DEBUG=true "/Applications/Notebook AI.app/Contents/MacOS/Notebook AI" 2>&1 | tee /tmp/notebook-ai-desktop.log
```

### Built but not installed app

```bash
NOTEBOOK_LOCAL_DEBUG=true "/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/release/mac-arm64/Notebook AI.app/Contents/MacOS/Notebook AI" 2>&1 | tee /tmp/notebook-ai-desktop.log
```

### Local sidecar health

```bash
curl -s http://127.0.0.1:8787/health
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

### Cloud API health

```bash
curl -s http://127.0.0.1:8790/health
curl -s https://your-cloud-api/health
```

## 6) What the logs mean

### Desktop main process

Important log lines now include:

- `[cloud-api] Desktop using ...`
  - The exact runtime cloud API URL the packaged app resolved

- `[auth] get-session -> ...`
  - Main-process auth session lookup

- `[cloud-api] Packaged desktop expects a hosted cloud API; skipping local spawn`
  - Normal for packaged builds

### Sidecar startup

Important log lines now include:

- `Local sidecar starting (debug=..., cloud_api_url=...)`
  - Confirms which cloud API URL the sidecar will use

- `Uvicorn running on http://127.0.0.1:8787`
  - Sidecar is up

### Drive sync errors

Drive sync errors now distinguish which remote host failed. You should see errors shaped like:

- `Unable to reach cloud API (host): ...`
- `Unable to reach Google Drive API (www.googleapis.com): ...`

That comes from [drive_sync_service.py](/Users/sridhar2901/git-personal/notebook-ai/services/local-sidecar/app/services/drive_sync_service.py).

## 7) Common failure modes

### A) `Failed to fetch` while saving API key

Usually means the renderer could not reach the local sidecar at all.

Check:

```bash
curl -s http://127.0.0.1:8787/health
```

If the sidecar is down, look for `[sidecar:error]` in the launch terminal.

### B) Google Drive shows connected, but sync fails

Usually one of:

- Renderer and sidecar were pointed at different cloud API URLs
- Packaged app was launched from Finder, so your shell env override was never applied
- DNS/network failure reaching either the cloud API or `www.googleapis.com`

Check:

1. Launch from Terminal with `NOTEBOOK_CLOUD_API_URL=...`
2. Confirm `[cloud-api] Desktop using ...`
3. Confirm sidecar startup logs `cloud_api_url=...`
4. Look at the sync error message for `cloud API` vs `Google Drive API`

### C) App opens, but folders appear late

The gap is usually:

1. App launches
2. Sidecar starts
3. Renderer waits for `/health`
4. Renderer fetches `/notes` and `/folders`

This is expected startup sequencing. The sidebar now shows a loading shell instead of flashing empty state.

### D) Repeated `get-session` logs

If repeated while signed out, it is usually auth polling.

If repeated while signed in, inspect the renderer flow around auth/session refresh and any repeated cloud requests. The main-process log is only the symptom.

## 8) CI and release debugging

### Which env vars belong in GitHub Actions

For release packaging, set the desktop-side secrets in [desktop-release.yml](/Users/sridhar2901/git-personal/notebook-ai/.github/workflows/desktop-release.yml):

- `DESKTOP_CLOUD_API_URL`
- `DESKTOP_SUPABASE_URL`
- `DESKTOP_SUPABASE_ANON_KEY`
- `DESKTOP_AUTH_CALLBACK_URL`

The workflow maps `DESKTOP_CLOUD_API_URL` to `VITE_CLOUD_API_URL`.

That is enough for:

- packaged renderer
- packaged Electron main
- packaged sidecar cloud URL inheritance

### What you do not need in Actions

- You do not need `services/local-sidecar/.env`
- You do not need a separate GitHub Actions env var just for `NOTEBOOK_LOCAL_CLOUD_API_URL`

Electron main supplies that to the sidecar at runtime.

## 9) Good verification checklist

For any packaged desktop bug, verify in this order:

1. App launch log shows `[cloud-api] Desktop using ...`
2. Sidecar launch log shows `cloud_api_url=...`
3. `curl http://127.0.0.1:8787/health` succeeds
4. `curl https://your-cloud-api/health` succeeds
5. Local action path works
   - notes, folders, BYOK
6. Control-plane path works
   - auth refresh, Google Drive connect/status
7. If Drive sync fails, check whether the error names `cloud API` or `Google Drive API`

## 10) Most useful files

- [apps/desktop/electron/main.ts](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/electron/main.ts)
- [apps/desktop/electron/preload.ts](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/electron/preload.ts)
- [apps/desktop/src/lib/api.ts](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/src/lib/api.ts)
- [apps/desktop/src/App.tsx](/Users/sridhar2901/git-personal/notebook-ai/apps/desktop/src/App.tsx)
- [services/local-sidecar/app/main.py](/Users/sridhar2901/git-personal/notebook-ai/services/local-sidecar/app/main.py)
- [services/local-sidecar/app/config.py](/Users/sridhar2901/git-personal/notebook-ai/services/local-sidecar/app/config.py)
- [services/local-sidecar/app/services/drive_sync_service.py](/Users/sridhar2901/git-personal/notebook-ai/services/local-sidecar/app/services/drive_sync_service.py)
- [services/cloud-api/app/main.py](/Users/sridhar2901/git-personal/notebook-ai/services/cloud-api/app/main.py)
- [docs/desktop-release-macos.md](/Users/sridhar2901/git-personal/notebook-ai/docs/desktop-release-macos.md)
