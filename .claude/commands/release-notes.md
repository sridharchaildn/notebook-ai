# Release Notes

Use the repo-owned release-note flow instead of inventing notes from git history alone.

1. Read `VERSION`.
2. Aggregate `.changes/*.md`.
3. Run `npm run release:notes -- --version <version>`.
4. Edit only for clarity and duplication removal.

Do not omit security changes. Keep the final notes grouped by `Security`, `Added`, `Changed`, `Fixed`.
