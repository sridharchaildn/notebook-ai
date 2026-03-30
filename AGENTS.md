# Notebook AI — Architecture Rules

This file defines the repo-wide architecture rules for Notebook AI. App-specific `AGENTS.md` files may add UI/UX guidance, but they must not contradict these ownership boundaries.

## Runtime Ownership

- `services/local-sidecar` is **desktop-only**. It owns local filesystem CRUD, local indexing/search, live capture/transcription hot paths, and local-first sync queues.
- `services/cloud-api` is the **control plane**. It owns auth/session exchange, legal acceptance, provider vault/OAuth, Drive OAuth/token brokerage, and workspace/storage metadata.
- `apps/web` owns the **web product surface** and hosted AI routes. Web AI must use server-side modules, not UI component logic.
- Mobile clients must call hosted APIs only. They do not depend on the Python sidecar.

## Shared Code Rules

- Cross-platform business logic must go into shared packages or `specs/` first.
- `packages/contracts` is the shared TS contract/domain surface.
- `packages/app-core` is for desktop/web shared client logic only.
- `packages/server-ai` is for hosted server-side AI orchestration only.
- `specs/` is the language-neutral source for workflow/storage/provider definitions that multiple runtimes need to agree on.

## Performance Invariants

- Desktop note editing, capture, and interview assist must remain local-first and low-latency.
- Do not route desktop keystroke saves or live capture through `apps/web` or `services/cloud-api`.
- Do not add cloud dependencies to the active desktop recording path.
- Hosted AI routes must stream incrementally and stay thin; long-lived business logic belongs in shared server modules, not route handlers.

## Storage Rules

- Native app-owned note/session storage is structured JSON text, not raw markdown.
- Markdown is import/export and preview-only. It is not the primary in-app editing model.
- Storage serialization format must never leak directly into the primary UI.
- Transcript and interview surfaces must render structured views, not raw markdown or raw JSON.
- `desktop_local_only` workspaces stay desktop-only. Cross-platform access requires Drive-shared workspaces.

## Feature Placement Rules

- Do not place auth, legal, onboarding, or marketing behavior in the local sidecar.
- Do not place provider-specific prompt text directly inside UI components.
- Do not place AI orchestration logic directly inside Next.js route handlers.
- Do not add web/mobile-specific behavior into desktop hot-path modules.

## Required Additions For New AI Workflows

Every new workflow must add:

- shared contract changes where applicable
- shared spec updates where applicable
- tests in the owning runtime
- rendering rules that keep storage format out of the primary UI
