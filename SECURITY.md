# Security Policy

## Reporting a vulnerability

Report security vulnerabilities privately through a GitHub security advisory (Security → Advisories → **Report a vulnerability**), not through public issues. Include a description, reproduction steps and the affected package and version; expect an initial response within a few days.

## Supply-chain hardening

Both packages are published by an automated pipeline designed to resist supply-chain attacks (for example, npm worms that steal publish credentials and push trojanized versions):

- **No long-lived npm token.** Publishing is npm trusted publishing (OIDC) from the protected `release` environment; there is no `NPM_TOKEN`. GitHub Actions proves the workflow's identity to npm with a short-lived, workflow-bound token. The publish step is `changeset publish`, which runs `pnpm publish` per changed package; on pnpm 10 that hands the upload to the npm CLI, so the job installs npm 11 (trusted publishing needs npm >= 11.5).
- **Provenance.** Nothing requests provenance. npm attaches a provenance statement by itself only when the source repository and the package are both public; this repository is private, so releases carry none today. Never set `NPM_CONFIG_PROVENANCE` or pass `--provenance`: an explicit request makes the publish fail from a private repository.
- **Pinned actions.** Every GitHub Action is pinned to a full commit SHA, so a moved tag cannot inject workflow code.
- **Least privilege.** Workflows default to `permissions: {}` and each job opts into only the scopes it needs; CI checks out with `persist-credentials: false`.
- **Manual approval gate.** The release job runs in the protected `release` environment, which requires manual approval.
- **Locked dependencies.** Installs use `pnpm install --frozen-lockfile` against the committed `pnpm-lock.yaml`. `allowBuilds` in `pnpm-workspace.yaml` lists the only dependencies whose install scripts may run, and `minimumReleaseAge` holds a newly published version for a day before pnpm installs it (first-party `@thomasfosterau/*` excepted). Dependabot proposes updates for review with the same cooldown.

## Release pipeline

The pipeline and its one-time owner setup (trusted publisher per package, the protected `release` environment) are documented in [docs/RELEASING.md](docs/RELEASING.md).
