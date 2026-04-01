# Contributing

## Branch Naming

- `feat/<slug>`
- `fix/<slug>`
- `security/<slug>`
- `chore/<slug>`
- `release/x.y.z`
- `hotfix/x.y.z`

## Release Notes

Add one markdown fragment under `.changes/` for every product-facing PR. Use this format:

```md
---
category: Fixed
area: desktop
pr: 123
---

Short user-facing summary.
```

Allowed categories:

- `Added`
- `Changed`
- `Fixed`
- `Security`

## Versioning

- `VERSION` is the repo source of truth.
- Run `npm run version:sync` after bumping `VERSION`.
- `master` deploys use the base version plus CI build metadata.
- tagged releases use an exact semver from `VERSION`.

## Validation

Run the relevant checks before merging:

- `npm run test:desktop`
- `npm run build:desktop`
- `npm run build:web`
- `cd services/local-sidecar && .venv/bin/python -m pytest`
- `cd services/cloud-api && .venv/bin/python -m pytest`
