# Release Notes

Generate release notes from `.changes/` fragments.

Steps:

1. Read `VERSION`.
2. Run `npm run release:notes -- --version <version>`.
3. Review the generated file in `docs/releases/`.
4. If fragments are missing, add concise user-facing entries before regenerating.

Output rules:

- Keep categories in this order: `Security`, `Added`, `Changed`, `Fixed`.
- Use one short bullet per shipped change.
- Describe user-visible outcomes, not implementation trivia.
