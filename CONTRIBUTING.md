# Contributing

## Secrets

Never commit `.env`, `.env.local`, credentials, or Apple signing material. Start from the `.env.example` files and keep real values on your machine. Pull request CI does not receive production secrets.

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

Pull requests run `.github/workflows/ci.yml`: desktop tests, a web build with placeholder public env values, and pytest for both Python services. Deploy and signed macOS release workflows run only in this repository.

Run the relevant checks before merging:

- `npm run test:desktop`
- `npm run build:desktop`
- `npm run build:web`
- `cd services/local-sidecar && .venv/bin/python -m pytest`
- `cd services/cloud-api && .venv/bin/python -m pytest`
