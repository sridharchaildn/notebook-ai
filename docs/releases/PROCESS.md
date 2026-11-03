# Release Process

## Cadence

- Merge feature, fix, chore, and security branches into `master`.
- Every merge to `master` can deploy the hosted web app and cloud API.
- Desktop DMGs are built from `v*` tags and from a manual workflow run. A merge to `master` does not publish a DMG.
- Cut a `release/x.y.z` branch only when the repo is ready for a public desktop release.
- Use `hotfix/x.y.z` only for urgent regressions on top of the last shipped release.

## Versioning

1. Update `VERSION`.
2. Run `npm run version:sync`.
3. Add or confirm release-note fragments under `.changes/`.
4. Merge to `master`.
5. Let CI deploy the hosted web app and cloud API.
6. When shipping a desktop release, tag the release commit with `vX.Y.Z`. That tag starts the macOS DMG workflow.

`master` builds should expose `X.Y.Z-dev.<run number>` in build metadata.

## Desktop Packaging

- CI builds the Electron renderer and main process.
- CI packages the local sidecar into a standalone binary.
- CI creates a macOS DMG.
- The DMG does not bundle ffmpeg. Transcription that needs transcoding uses `ffmpeg` on the machine `PATH`.
- If Apple credentials are present, CI signs and notarizes the DMG.

Required secrets for signed macOS releases:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`

## Release Notes

- PRs add fragments in `.changes/`.
- Run `npm run release:notes -- --version X.Y.Z` to generate consolidated notes.
- Commit the generated notes into `docs/releases/` or attach them to the GitHub release.
