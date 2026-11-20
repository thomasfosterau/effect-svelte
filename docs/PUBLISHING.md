# Publishing

[Changesets](https://github.com/changesets/changesets) manages versions and changelogs for `@thomasfosterau/effect-svelte` and `@thomasfosterau/effect-sveltekit`; publishing is npm trusted publishing (OIDC) from the protected `release` environment. There is no `NPM_TOKEN`.

## Release flow

1. A PR with a changeset merges into `trunk`.
2. The Release workflow ([release.yml](../.github/workflows/release.yml)) opens or updates the `chore: version packages` PR (`vp run changeset:version`), assigned to the owner.
3. Merging it makes the next run publish, after the `release` environment's approval: `vp run release` (a `vite.config.ts` task; there is no publish script) builds both packages, runs `vp pm publish -r --access public --no-git-checks -- --ignore-scripts` (pnpm publishes each package whose version isn't on npm yet, does the OIDC exchange and rewrites `catalog:` / `workspace:` specifiers), then `changeset git-tag`, which tags each new version and reports the tags to the Changesets action; the action pushes them and creates the GitHub releases. A failed publish stops before tagging; a re-run publishes only what is missing.

`release` is an uncached task, so `vp run` passes it the full environment, OIDC request variables included. Don't force provenance (`--provenance`); pnpm adds it when the repository and package are public. `vp run release:dry-run` builds and lists what would be published, without publishing or tagging.

The release jobs install with `--ignore-scripts` and set `pnpm_config_verify_deps_before_run: "false"`, so no dependency script runs in a job holding `id-token: write`.

## One-time owner setup

1. Settings → Actions → General: allow GitHub Actions to create and approve pull requests.
2. On npmjs.com, for each package: Settings → Trusted Publisher → GitHub Actions, repository `thomasfosterau/effect-svelte`, workflow `release.yml`, environment `release`. A new package's first version must be published by hand once before a trusted publisher can be added: from a clean `trunk`, `vp install --frozen-lockfile`, `vp run release:dry-run`, then `vp run release`, then `git push origin --tags`.
3. Environments → `release`: required reviewers, deployments from `trunk` only.
