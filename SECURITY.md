# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately via GitHub's [**Report a vulnerability**](https://github.com/thomasfosterau/effect-svelte/security/advisories/new) button (Security → Advisories), **not** through public issues.

You can expect an initial response within a few days. Please include a description, reproduction steps, and the affected package and version.

## Supply-chain hardening

`@thomasfosterau/effect-svelte` and `@thomasfosterau/effect-sveltekit` are published with a hardened, automated pipeline designed to resist supply-chain attacks (e.g. self-propagating npm worms that steal credentials and publish trojanized versions):

- **No long-lived npm token.** Releases use npm [**OIDC Trusted Publishing**](https://docs.npmjs.com/trusted-publishers): GitHub Actions proves its identity to npm with a short-lived, workflow-bound OIDC token. There is no `NPM_TOKEN` secret to steal from CI.
- **Provenance.** Every version the release workflow publishes from the public repository carries [npm provenance](https://docs.npmjs.com/generating-provenance-statements), linking the artifact to the exact source commit and workflow.
- **Install scripts disabled in the release job.** The release workflow installs with `pnpm install --frozen-lockfile --ignore-scripts` and turns off pnpm 11's `verify-deps-before-run` for that job, so a later `pnpm run` cannot silently re-install with scripts; the publish runs as `pnpm publish --ignore-scripts`. pnpm (pinned by `packageManager`) performs the OIDC exchange itself, so no unpinned tooling is installed there. CI runs the workspace's own `prepare` (the Vite+ git hooks) but only ever holds read permissions.
- **Pinned actions.** All GitHub Actions are pinned to full commit SHAs, so a hijacked tag cannot inject workflow code.
- **Least privilege.** Workflows default to `permissions: {}`; each job opts into only the scopes it needs. CI checks out with `persist-credentials: false`.
- **Manual approval gate.** Publishing runs in a protected `release` environment that requires manual approval.
- **Locked dependencies with a cooling-off period.** Installs use `pnpm install --frozen-lockfile` against the committed `pnpm-lock.yaml`; `minimumReleaseAge` holds newly published third-party versions for 8 hours before pnpm will install them; CI runs `pnpm audit --audit-level high`; Dependabot proposes updates for review after a one-day cooldown (whole days only, so never sooner than pnpm would install them).
- **No runtime dependencies beyond the family.** `effect`, `svelte`, `@sveltejs/kit`, `vite` and `@effect/platform-node` are peers the consuming app owns; `effect-sveltekit`'s own dependencies are `@thomasfosterau/effect-svelte`, `@standard-schema/spec` (types) and `magic-string` (the Vite plugin).

## Release pipeline

The publishing pipeline and its one-time maintainer setup are documented in [PUBLISHING.md](./PUBLISHING.md).
