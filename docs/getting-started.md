# Getting started

Run Notebook AI on your machine, then point the public Mac download at the domain you attach.

## What you need

- Node.js 20.10 or newer
- Python 3.11
- npm
- Optional: `ffmpeg` on your `PATH` for audio transcoding. Releases do not bundle ffmpeg. See [NOTICE](../NOTICE).

An OpenAI API key is required for model lists, summaries, and transcription. Create one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). The key starts with `sk-`. OpenRouter is optional.

Sign-in, Google Drive mirror, and the web account vault are optional. Notes and a locally saved API key work without an account.

## Install

From the repo root:

```bash
npm install
cd services/local-sidecar && python3.11 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'
cd ../cloud-api && python3.11 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'
cd ../..
```

On Windows, create each virtualenv with `python -m venv .venv` and install with `.venv\Scripts\python.exe -m pip install -e ".[dev]"`.

Copy the env examples and leave secrets empty:

```bash
cp services/local-sidecar/.env.example services/local-sidecar/.env
cp services/cloud-api/.env.example services/cloud-api/.env
cp apps/desktop/.env.example apps/desktop/.env
cp apps/web/.env.example apps/web/.env.local
```

Do not commit those copied files.

## Run the desktop app

The desktop app starts the local sidecar on `127.0.0.1:8787` and gives that process a desktop token. Save keys and notes through that sidecar.

Free port 8787 before launching. If another Python process is already listening there, the desktop app reuses it without the desktop token. Saving an API key then fails in the UI with `Failed to fetch`.

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
# stop that process if one is listed, then:
npm run dev:desktop
```

On the splash screen, choose **Continue without an account**. Open Settings, AI Connection, and save an OpenAI key that starts with `sk-`. The audio and Copilot model lists load after OpenAI accepts the key.

`npm run dev:sidecar` is for working on the sidecar by itself. Do not leave it running on 8787 while `npm run dev:desktop` is open.

## Optional account, Drive, and web

Google sign-in, magic link, Drive mirror, and the web vault need the cloud API and Supabase. Follow [Supabase, Google Sign-In, and Google Drive Setup](./supabase-google-setup.md), then start the cloud API in a second terminal:

```bash
npm run dev:cloud
```

That listens on `127.0.0.1:8790`. Put the Supabase URL and anon key in `apps/desktop/.env` and `apps/web/.env.local` using the placeholders in the example files. Restart the desktop app after changing `apps/desktop/.env`.

The web app is account-based. It has no local note store.

```bash
npm run dev:web
```

Open `http://127.0.0.1:3000`.

## Checks

```bash
npm run test:desktop
npm run build:web
cd services/local-sidecar && .venv/bin/python -m pytest
cd ../cloud-api && .venv/bin/python -m pytest
```

Pull requests run the same checks in `.github/workflows/ci.yml` without production secrets.

## Download the Mac app

People install the signed Mac DMG from the domain you attach. The DMG itself is built by the desktop release workflow when you push a `v*` tag, or when you run that workflow by hand. See [macOS desktop release](./desktop-release-macos.md) and [release process](./releases/PROCESS.md).

After the domain is live:

1. Publish a release so the DMG exists on GitHub Releases.
2. Point the domain at that DMG. A stable path such as `https://your-domain/download` can redirect to the latest `Notebook-AI-*.dmg` asset.
3. Set `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` to that public URL for the web deploy. The landing page **Download for Mac** button uses it. Until the variable is set, the button opens the GitHub latest-release page.

Local API keys stay on the machine that installs the DMG. The download site only distributes the app.
