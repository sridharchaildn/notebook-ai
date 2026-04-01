# Release Process

## Cadence

- Merge feature, fix, chore, and security branches into `master`.
- Every merge to `master` deploys hosted surfaces and produces desktop build artifacts.
- Cut a `release/x.y.z` branch only when the repo is ready for a public desktop release.
- Use `hotfix/x.y.z` only for urgent regressions on top of the last shipped release.

## Versioning

1. Update `VERSION`.
2. Run `npm run version:sync`.
3. Add or confirm release-note fragments under `.changes/`.
4. Merge to `master`.
5. Let CI publish build artifacts and deployments.
6. When shipping a desktop release, tag the release commit with `vX.Y.Z`.

`master` builds should expose `X.Y.Z-dev.<run number>` in build metadata.

## Desktop Packaging

- CI builds the Electron renderer and main process.
- CI packages the local sidecar into a standalone binary.
- CI creates a macOS DMG.
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
