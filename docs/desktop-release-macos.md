# Notebook AI Desktop Release (macOS) — full runbook

End-to-end guide for shipping the Desktop app as a signed, notarized `.dmg` via GitHub Actions.

**CI workflow:** `.github/workflows/desktop-release.yml`  
**Packaging script:** `scripts/release/package-desktop-macos.sh`  
**Electron config:** `apps/desktop/electron-builder.mjs` (bundle ID `ai.notebook.desktop`)

---

## 1) Prerequisites

1. **Apple Developer Program** (paid) membership.
2. **macOS** with **Keychain Access** (for CSR, cert install, `.p12` export).
3. **GitHub** repo admin access (Actions secrets, optional **Environments** for `production-desktop`).
4. **App Store Connect** access to create **Team** API keys (or use app-specific password fallback; see §6).

---

## 2) Create a Certificate Signing Request (CSR) on your Mac

Apple needs a CSR before it can issue your **Developer ID Application** certificate.

### 2.1 Open the correct Certificate Assistant flow

1. Open **Keychain Access** (Applications → Utilities).
2. Menu bar: **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**

   If you instead see a screen **“What would you like to do?”**, choose:

   - **Request a certificate from an existing CA** → **Continue**

### 2.2 Fill “Certificate Information”

On the form:

| Field | Value |
|--------|--------|
| **User Email Address** | Your Apple ID / developer email |
| **Common Name** | Any clear label, e.g. `Notebook AI Developer ID` |
| **CA Email Address** | **Leave empty** |
| **Request is** | **Saved to disk** |
| **Let me specify key pair information** | **Unchecked** (defaults are fine) |

Click **Continue** and save the file. It ends in **`.certSigningRequest`**.

**Important:** This step only creates a **request** file. You will **not** see a Developer ID certificate in Keychain until after you complete §3–§4.

### 2.3 Flows to avoid (common mistakes)

- **Create a certificate for yourself** → leads to self-signed / email (S/MIME) flows — **wrong** for Developer ID.
- **Create Your Certificate** with **Certificate Type: S/MIME** — **wrong**.
- **View and evaluate certificates** — viewer only, not CSR creation.

---

## 3) Request the Developer ID Application certificate (Apple Developer)

1. Sign in to [Apple Developer](https://developer.apple.com/) → **Certificates, Identifiers & Profiles** → **Certificates**.
2. Click **+** to add a certificate.
3. Choose **Developer ID Application** (not *Apple Development*, *Apple Distribution*, or *Developer ID Installer* for this app flow).
4. When asked for **Developer ID Certificate Intermediary**, select:

   - **G2 Sub-CA (Xcode 11.4.1 or later)** — recommended.

   Use **Previous Sub-CA** only if you have a specific legacy toolchain need.

5. Upload the **`.certSigningRequest`** from §2.
6. **Download** the issued certificate (e.g. `developerId.cer`).

---

## 4) Install the certificate in Keychain (local)

1. **Double-click** the downloaded `.cer` file (or drag it into Keychain Access).
2. Prefer importing into the **login** keychain.

### 4.1 Verify cert + private key

1. In Keychain Access, select **login** → category **My Certificates** (not “Certificates” only).
2. Find **`Developer ID Application: Your Name (TEAMID)`**.
3. Expand the row: you must see a **private key** nested under that certificate.

If there is **no private key**:

- The CSR was not created on this Mac/keychain, or you imported only the public cert without the matching key. Create a new CSR on the machine where you will export `.p12`, or revoke and re-issue following Apple’s process.

---

## 5) Export signing identity as `.p12` for GitHub Actions

CI imports this PKCS#12 bundle on the macOS runner.

1. In **My Certificates**, **right-click the certificate row**  
   `Developer ID Application: …` (not only the private key sub-row).
2. **Export…**
3. File format: **Personal Information Exchange (.p12)**.
4. Choose a path and filename, e.g. `developer-id-application.p12`.
5. Set an **export password** (you will store it as `APPLE_CERTIFICATE_PASSWORD`).

---

## 6) Notarization: App Store Connect API key (recommended)

Notarization needs Apple credentials. **API keys** avoid storing an Apple ID **app-specific password** in GitHub.

### 6.1 Where to create the key

1. Open [App Store Connect](https://appstoreconnect.apple.com/).
2. **Users and Access** → **Integrations** → **App Store Connect API**.

If you only see **“Request Access”**, an **Account Holder** or **Admin** must approve API access for your team. Until then, use §6.4 (password fallback) or wait for access.

### 6.2 Team keys vs individual keys

- Use **Team keys** for CI (shared automation).
- **Individual keys** are per-user; avoid them for GitHub Actions.

### 6.3 Generate the key

1. **Team Keys** tab → **Generate API Key**.
2. **Name:** e.g. `notebook-ai-notary`.
3. **Access:** start with **App Manager**. If notarization fails with permission errors, create another key with **Admin**.

Click **Generate**, then **Download** the `.p8` file once (`AuthKey_<KEY_ID>.p8`). You cannot download it again.

From the same page, copy:

- **Issuer ID** (top of the API keys page)
- **Key ID** for that key

### 6.4 Wrong place: “Register a New Key” under Certificates / Profiles

The Developer portal screen that lists **APNs**, **Sign in with Apple**, etc., is **not** the App Store Connect API key used for typical notarization with `notarytool` / electron-builder. Use **App Store Connect → Integrations → App Store Connect API** instead.

### 6.5 Optional fallback: Apple ID + app-specific password

If API keys are unavailable, set:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD` (generate under [appleid.apple.com](https://appleid.apple.com/) → Sign-In and Security → App-Specific Passwords)
- `APPLE_TEAM_ID` (10-character Team ID)

You can omit the app-specific password when API key secrets (§7) are set and working.

---

## 7) Prepare GitHub Actions secrets

**Repo → Settings → Secrets and variables → Actions.**

Environment **production-desktop** (if you use it): add the same secret **names** there if your workflow `environment:` points to it; otherwise repository secrets are enough.

### 7.1 Signing (required for signed DMG on CI)

| Secret | What to paste |
|--------|----------------|
| `APPLE_CERTIFICATE` | Base64 of the `.p12` file (§5) |
| `APPLE_CERTIFICATE_PASSWORD` | Export password you chose for `.p12` |
| `APPLE_SIGNING_IDENTITY` | **Only** the name part — **no** `Developer ID Application:` prefix |

**Signing identity example**

- Keychain / `security find-identity` shows:  
  `Developer ID Application: Sridhar Chaitanya Gudur (VD23B7H2WJ)`
- Put in **`APPLE_SIGNING_IDENTITY`:**  
  `Sridhar Chaitanya Gudur (VD23B7H2WJ)`

**electron-builder** sets `CSC_NAME` from this value; it **rejects** strings that still start with `Developer ID Application:`.

Encode `.p12`:

```bash
base64 -i "developer-id-application.p12" | pbcopy
```

Paste into `APPLE_CERTIFICATE` (macOS). On Linux:

```bash
base64 -w 0 "developer-id-application.p12"
```

### 7.2 Notarization via API key (recommended)

| Secret | Source |
|--------|--------|
| `APPLE_API_KEY_ID` | Key ID from App Store Connect API key |
| `APPLE_API_ISSUER` | Issuer ID (top of API Keys page) |
| `APPLE_API_KEY_P8_BASE64` | Base64 of `AuthKey_<KEY_ID>.p8` (entire file, one line) |

```bash
base64 -i "AuthKey_ABC123XYZ.p8" | pbcopy
```

Linux:

```bash
base64 -w 0 "AuthKey_ABC123XYZ.p8"
```

### 7.3 Desktop app config (baked in at build time)

The workflow injects these as `VITE_*` for the **packaged** app. Use **production** URLs — **not** `http://127.0.0.1` from local `apps/desktop/.env`.

| Secret | Maps to |
|--------|---------|
| `DESKTOP_CLOUD_API_URL` | `VITE_CLOUD_API_URL` |
| `DESKTOP_SUPABASE_URL` | `VITE_SUPABASE_URL` |
| `DESKTOP_SUPABASE_ANON_KEY` | `VITE_SUPABASE_ANON_KEY` |
| `DESKTOP_AUTH_CALLBACK_URL` | `VITE_DESKTOP_AUTH_CALLBACK_URL` |

Local-only variables (e.g. `VITE_LOCAL_API_URL` in `.env`) are for dev; they are **not** wired in this workflow unless you add them.

### 7.4 Publish to GitHub Releases

The build uses `GH_TOKEN` (`GITHUB_TOKEN`) and electron-builder’s **GitHub** publisher (see `electron-builder.mjs`).

The **desktop-release** workflow sets `permissions: contents: write` so the job can **create releases** and upload the DMG. Without that, GitHub returns **403** (`Resource not accessible by integration`) when creating `v0.1.0` (or your current `package.json` version tag).

If your org forbids elevating the token in workflows, create a **Personal Access Token** (classic: `repo` scope) or fine-grained token with **Contents: Read and write**, store it as e.g. `DESKTOP_RELEASE_GITHUB_TOKEN`, and set `GH_TOKEN: ${{ secrets.DESKTOP_RELEASE_GITHUB_TOKEN }}` in the **Build DMG** step instead of `GITHUB_TOKEN`.

---

## 8) How CI runs (summary)

On a **`v*` tag**, or when you **Run workflow** manually (**Actions** → **desktop-release** → **Run workflow**):

1. `npm ci`, desktop tests, sidecar PyInstaller. The DMG does not bundle ffmpeg; install ffmpeg on the Mac that runs transcription if a recording needs transcoding.
2. Import `.p12` on the runner (if signing secrets are set)
3. Write API `.p8` to a temp path (if notary API secrets are set)
4. `scripts/release/package-desktop-macos.sh` → `npm run package:mac` on workspace `@notebook-ai/desktop` (local **electron** + **electron-builder**)
5. Upload `apps/desktop/release/*.dmg` as artifact; draft GitHub release if publish is enabled

To inspect a packaged app, launch it from Terminal:

```bash
NOTEBOOK_LOCAL_DEBUG=true "/Applications/Notebook AI.app/Contents/MacOS/Notebook AI"
```

Local sidecar health is `curl -s http://127.0.0.1:8787/health`. `Failed to fetch` while saving an API key means the desktop app is talking to a sidecar it did not start. Free port 8787 and launch with `npm run dev:desktop`, as described in [Getting started](./getting-started.md). Drive sync errors name either the cloud API host or `www.googleapis.com`.

After a release is published, point the public download domain at the DMG and set `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` to that URL for the web deploy. The landing page **Download for Mac** button uses that variable.

**Note:** Step `if:` conditions cannot use the `secrets` context in GitHub Actions; this workflow uses **job-level `env` flags** (`APPLE_SIGNING_READY`, `APPLE_NOTARY_API_READY`) instead.

---

## 9) Run and verify a release

1. Push a `v*` tag, or run **Actions** → **desktop-release** → **Run workflow**.
2. Open that workflow run.
3. Confirm **Build DMG** completes (signing + notarization + publish).
4. Download the **artifact** or open the **GitHub Release** draft.
5. On a clean Mac: open the DMG, run the app, confirm Gatekeeper behavior and permissions (mic / screen capture if used).

---

## 10) Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| No cert after saving CSR | Normal until Apple issues `.cer` and you install it (§4). |
| No private key under Developer ID cert | CSR/cert mismatch or wrong machine; re-do CSR + issue on same Mac. |
| `Please remove prefix "Developer ID Application:"` | `APPLE_SIGNING_IDENTITY` must be **without** that prefix (§7.1). |
| `Cannot compute electron version` / electron not found | Use workspace `package:mac` + pinned **electron** in `apps/desktop`; run `npm ci` at repo root (current `package-desktop-macos.sh`). |
| `Unrecognized named-value: 'secrets'` in workflow | Do not use `secrets` inside step `if:`; use env booleans at job level. |
| `notarytool` / notarization auth errors | Wrong `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, or bad base64 `.p8`; or key role too limited (try Admin). |
| No API keys in App Store Connect | Click **Request Access** or ask Account Holder; use §6.5 meanwhile. |
| Publish / release failures | Token permissions, draft vs published release, or repo name in `electron-builder.mjs`. |
| DMG shows default Electron atom icon | Missing or stale `apps/desktop/assets/icon.icns`; run `scripts/release/generate-macos-icon-from-svg.sh` and ensure `mac.icon` in `electron-builder.mjs` points at it. |

---

## 11) App icon (macOS)

The packaged **.app** and **DMG** use `apps/desktop/assets/icon.icns`, generated from the same book artwork as `icon.svg`. `electron-builder` is configured with `mac.icon: assets/icon.icns`.

After editing `apps/desktop/assets/icon.svg`, regenerate on a Mac:

```bash
bash scripts/release/generate-macos-icon-from-svg.sh
```

Commit the updated `icon.icns` so CI builds pick it up.

---

## 12) Operational habits

- Prefer **API key** notarization over app-specific passwords.
- Rotate API keys periodically; revoke old keys after cutover.
- Never commit `.p12`, `.p8`, or base64 secrets to git.
- Tie visible app versions to repo **`VERSION`** and your release process.
