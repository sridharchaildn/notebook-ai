# Release Notes

This repo uses fragment-based release notes.

Workflow:

1. Verify `VERSION`.
2. Confirm each merged PR added a fragment in `.changes/`.
3. Run `npm run release:notes -- --version <version>`.
4. Polish wording without changing scope or hiding regressions.

Prefer short user-facing bullets with area tags.
