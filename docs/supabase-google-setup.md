# Supabase, Google Sign-In, and Google Drive Setup

Verified against official docs on March 27, 2026.

This repo now uses:

- Supabase Auth for web and desktop identity
- Supabase Postgres for cloud-side app metadata
- Google OAuth through Supabase for user sign-in
- A separate Google OAuth client for Drive access in `services/cloud-api`
- Desktop auth opens Supabase in the system browser and returns directly to `notebook-ai://auth/callback`

## Where To Set Redirect URLs In Supabase

Set them in the Supabase Dashboard:

1. Open your project in Supabase.
2. Go to `Authentication`.
3. Open `URL Configuration`.
4. Set:
   - `Site URL`
   - `Redirect URLs`

For this app, local development should include:

- `Site URL`: `http://127.0.0.1:3000`
- `Redirect URLs`:
  - `http://127.0.0.1:3000/auth/callback`
  - `notebook-ai://auth/callback`

If you also use `localhost`, add that too:

- `http://localhost:3000/auth/callback`

The web app sends Supabase auth back to `/auth/callback` from [apps/web/lib/supabase.ts](../apps/web/lib/supabase.ts). The desktop app sends Supabase auth back to `notebook-ai://auth/callback` from [apps/desktop/src/lib/supabaseAuth.ts](../apps/desktop/src/lib/supabaseAuth.ts).

## Step 1: Run The Supabase SQL

Run [services/cloud-api/supabase_schema.sql](../services/cloud-api/supabase_schema.sql) in the Supabase SQL editor.

That creates the cloud tables used by:

- web/mobile provider credential storage
- storage preferences

## Step 2: Configure Supabase Auth For This App

### Web app env

Create `apps/web/.env.local` with:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
NEXT_PUBLIC_CLOUD_API_URL=http://127.0.0.1:8790
```

### Desktop app env

Create `apps/desktop/.env` with:

```bash
VITE_LOCAL_API_URL=http://127.0.0.1:8787
VITE_CLOUD_API_URL=http://127.0.0.1:8790
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DESKTOP_AUTH_CALLBACK_URL=notebook-ai://auth/callback
```

The desktop app uses those values in [apps/desktop/src/lib/supabaseAuth.ts](../apps/desktop/src/lib/supabaseAuth.ts) to start Google OAuth or email magic-link sign-in directly against Supabase.

### Cloud API env

Create `services/cloud-api/.env` from [services/cloud-api/.env.example](../services/cloud-api/.env.example).

Minimum required values:

```bash
NOTEBOOK_CLOUD_CREDENTIAL_SECRET=CHANGE_ME
NOTEBOOK_CLOUD_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NOTEBOOK_CLOUD_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY=YOUR_SB_SECRET_KEY
NOTEBOOK_CLOUD_SUPABASE_JWKS_URL=https://YOUR_PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json
```

Generate `NOTEBOOK_CLOUD_CREDENTIAL_SECRET` with something like:

```bash
openssl rand -base64 32
```

Notes:

- Prefer `NOTEBOOK_CLOUD_SUPABASE_JWKS_URL`.
- Only use `NOTEBOOK_CLOUD_SUPABASE_JWT_SECRET` if your Supabase project is still on symmetric or legacy JWT signing.
- The cloud API needs a server-side Supabase secret key because it writes app tables through Supabase PostgREST.

## Step 3: Configure Google Sign-In For Supabase

This is the Google OAuth setup used by both:

- the web app sign-in and sign-up flows
- the desktop app system-browser sign-in flow

### 3.1 Create or pick a Google Cloud project

1. Open Google Cloud Console.
2. Create a project or select an existing one.

### 3.2 Configure the Google Auth platform consent screen

1. Go to `Google Auth platform` -> `Branding`.
2. If prompted, click `Get Started`.
3. Fill in:
   - app name
   - support email
   - contact email
4. Choose your audience:
   - `Internal` if only your Workspace users should log in
   - `External` for normal consumer Google accounts
5. If using `External`, add yourself and any teammates as test users in `Audience`.

### 3.3 Create the OAuth client for Supabase sign-in

1. Go to `APIs & Services` -> `Credentials`.
2. Click `Create Credentials` -> `OAuth client ID`.
3. Choose `Web application`.
4. Under `Authorized JavaScript origins`, add:
   - `http://127.0.0.1:3000`
   - your production web origin later, for example `https://app.example.com`
5. Under `Authorized redirect URIs`, add your Supabase callback URL:
   - hosted Supabase: copy the `Callback URL` shown in Supabase Dashboard -> `Authentication` -> `Sign In / Providers` -> `Google`
   - local Supabase CLI: `http://127.0.0.1:54321/auth/v1/callback`
6. Click `Create`.
7. Copy the client ID and client secret.

### 3.4 Add the Google OAuth credentials to Supabase

1. In Supabase, go to `Authentication` -> `Sign In / Providers`.
2. Open `Google`.
3. Paste the Google client ID and client secret.
4. Enable the provider.
5. Save.

### 3.5 Confirm the app redirect URLs match Supabase

The web app uses:

- Google OAuth sign-in via Supabase
- `redirectTo = http://127.0.0.1:3000/auth/callback?...`

The desktop app uses:

- Google OAuth sign-in via Supabase
- `redirectTo = notebook-ai://auth/callback`

That redirect target comes from:

- [apps/web/app/auth/signin/page.tsx](../apps/web/app/auth/signin/page.tsx)
- [apps/web/app/auth/signup/page.tsx](../apps/web/app/auth/signup/page.tsx)
- [apps/web/lib/supabase.ts](../apps/web/lib/supabase.ts)
- [apps/desktop/src/lib/supabaseAuth.ts](../apps/desktop/src/lib/supabaseAuth.ts)

## Step 4: Configure Google Drive OAuth For `services/cloud-api`

This is separate from Supabase sign-in.

It is used when a signed-in user connects Drive from Notebook AI settings.

### 4.1 Enable Google Drive API

1. In Google Cloud Console, open `APIs & Services`.
2. Open `Library`.
3. Enable `Google Drive API`.

### 4.2 Configure consent screen access for Drive

If you already completed the Google Auth platform setup above, reuse the same project.

Then:

1. Open `Google Auth platform` -> `Data Access`.
2. Add the Drive scope used by this app:
   - `https://www.googleapis.com/auth/drive.file`
3. Save.

`drive.file` matches the default scope in [services/cloud-api/app/config.py](../services/cloud-api/app/config.py) and is the preferred narrow Drive scope.

### 4.3 Create the OAuth client for Drive

1. Go to `APIs & Services` -> `Credentials`.
2. Click `Create Credentials` -> `OAuth client ID`.
3. Choose `Web application`.
4. Under `Authorized redirect URIs`, add:
   - local: `http://127.0.0.1:8790/integrations/google-drive/oauth/callback`
   - production later: `https://YOUR_CLOUD_API_DOMAIN/integrations/google-drive/oauth/callback`
5. Click `Create`.
6. Copy the client ID and client secret.

You do not need browser JavaScript origins for this Drive flow unless you also reuse the same OAuth client from browser JavaScript. The current Notebook AI Drive flow is handled by the cloud API callback.

### 4.4 Set the Drive env vars

Add these to `services/cloud-api/.env`:

```bash
NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_TOKEN_URL=https://oauth2.googleapis.com/token
NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_ID=YOUR_GOOGLE_DRIVE_CLIENT_ID
NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_SECRET=YOUR_GOOGLE_DRIVE_CLIENT_SECRET
NOTEBOOK_CLOUD_GOOGLE_DRIVE_REDIRECT_URI=http://127.0.0.1:8790/integrations/google-drive/oauth/callback
NOTEBOOK_CLOUD_GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive.file
NOTEBOOK_CLOUD_GOOGLE_DRIVE_DEFAULT_FOLDER_NAME=notebook-ai
```

You can keep this default as-is:

```bash
NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL=https://accounts.google.com/o/oauth2/v2/auth
```

## Step 5: Where Each Cloud Env Var Comes From

### Supabase values

| Env var | Where to get it |
| --- | --- |
| `NOTEBOOK_CLOUD_SUPABASE_URL` | Supabase project URL |
| `NOTEBOOK_CLOUD_SUPABASE_ANON_KEY` | Supabase Dashboard -> API keys / connect modal |
| `NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY` | Supabase Dashboard -> `Settings` -> `API Keys` -> create or copy a server-side secret key (`sb_secret_...`) |
| `NOTEBOOK_CLOUD_SUPABASE_JWKS_URL` | Build it as `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `NOTEBOOK_CLOUD_SUPABASE_JWT_SECRET` | Only if needed for legacy or symmetric JWT signing |

### App-owned values

| Env var | How to choose it |
| --- | --- |
| `NOTEBOOK_CLOUD_CREDENTIAL_SECRET` | Generate a random secret and keep it private |
| `NOTEBOOK_CLOUD_PRIVACY_POLICY_VERSION` | Your own version string |
| `NOTEBOOK_CLOUD_PRIVACY_POLICY_URL` | Your own hosted policy URL |
| `NOTEBOOK_CLOUD_USER_AGREEMENT_VERSION` | Your own version string |
| `NOTEBOOK_CLOUD_USER_AGREEMENT_URL` | Your own hosted agreement URL |

### Google Drive values

| Env var | Where to get it |
| --- | --- |
| `NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_ID` | Google Cloud Console -> Credentials -> OAuth client |
| `NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_SECRET` | Google Cloud Console -> Credentials -> OAuth client |
| `NOTEBOOK_CLOUD_GOOGLE_DRIVE_REDIRECT_URI` | Must exactly match the redirect URI registered in the Google OAuth client |
| `NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_TOKEN_URL` | Use `https://oauth2.googleapis.com/token` |
| `NOTEBOOK_CLOUD_GOOGLE_DRIVE_SCOPE` | Use `https://www.googleapis.com/auth/drive.file` |

### Optional OpenAI OAuth values

Only needed if you plan to use OpenAI OAuth connection in the cloud API.

| Env var | Where to get it |
| --- | --- |
| `NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_ID` | From your OpenAI OAuth app configuration |
| `NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_SECRET` | From your OpenAI OAuth app configuration |
| `NOTEBOOK_CLOUD_OPENAI_OAUTH_TOKEN_URL` | From OpenAI OAuth docs/app config |
| `NOTEBOOK_CLOUD_OPENAI_OAUTH_REDIRECT_URI` | Must match your registered OpenAI redirect URI |

If you are not using OpenAI OAuth yet, leave those blank.

## Step 6: Restart Everything

After setting env vars:

1. Restart `services/cloud-api`
2. Restart `apps/web`
3. Restart the desktop app

## Official References

- Supabase redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase Google login: https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase auth configuration overview: https://supabase.com/docs/guides/auth/general-configuration
- Google OAuth consent screen: https://developers.google.com/workspace/guides/configure-oauth-consent
- Google Drive API quickstart: https://developers.google.com/workspace/drive/api/quickstart/nodejs
- Google Drive scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Google OAuth web server flow: https://developers.google.com/identity/protocols/oauth2/web-server
