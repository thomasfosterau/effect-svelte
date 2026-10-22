# Publishing & releases

Releases are automated with [Changesets](https://github.com/changesets/changesets) and the **Release** workflow ([release.yml](.github/workflows/release.yml)), and published to npm via [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers) — there is no `NPM_TOKEN`. See [SECURITY.md](./SECURITY.md) for the security rationale. Two packages are published:

- `@thomasfosterau/effect-svelte` (`packages/svelte`)
- `@thomasfosterau/effect-sveltekit` (`packages/sveltekit`)

## The release flow

1. **Add a changeset with your change.** Run `pnpm changeset`, pick the packages and the bump (`patch` / `minor` / `major`) and write a user-facing summary, then commit the generated file alongside your change. Which changes need one is set out in [AGENTS.md](AGENTS.md#branches-and-pull-requests). Preview what is pending with `pnpm changeset status`.
2. **Merge to `trunk`.** The Release workflow runs and, while changesets are pending, opens or updates a **"chore: version packages"** PR on `changeset-release/trunk` that applies the version bumps and rolls the changesets into each package's `CHANGELOG.md`. The version step is `changeset version && vp fmt && pnpm install --lockfile-only`, with `"format": false` in `.changeset/config.json`: Changesets 3 otherwise auto-detects the `oxfmt` binary Vite+ installs and runs it on the new changelogs, but that binary is Vite+'s IDE-only shim and exits 1 outside LSP mode. `vp fmt` formats the changelogs instead, so the version PR passes `vp check`.
3. **Merge the version PR.** With no changesets left, the workflow runs `pnpm run release`: `vp run -r build`, then `pnpm -r --filter './packages/*' publish --access public --no-git-checks --ignore-scripts` (which skips versions already on npm and rewrites the `catalog:` / `workspace:` specifiers into real ranges), then `changeset tag`, whose `New tag:` lines the Changesets action uses to push the tags and create the GitHub releases.

`pnpm run`, not `vp run`, drives both scripts: `vp run` does not forward the `ACTIONS_ID_TOKEN_REQUEST_URL` / `_TOKEN` variables the OIDC exchange needs. Since pnpm 11, `pnpm publish` no longer delegates to the npm CLI: pnpm fetches the GitHub Actions OIDC token itself and exchanges it for a short-lived npm token, so the job never upgrades npm. `--ignore-scripts` keeps any publish lifecycle script out of the job holding `id-token: write`. Provenance is pnpm's call: with no `pnpm_config_provenance` set it attaches provenance only when the OIDC token reports a public repository **and** the registry reports the package as public. Never force it (`--provenance`, `publishConfig.provenance`); an explicit request makes a publish from a private repository fail.

## Maintainer setup (one-time)

1. **Allow Actions to open the version PR.** **Settings → Actions → General → Workflow permissions** → enable **"Allow GitHub Actions to create and approve pull requests"**. Without it the workflow pushes `changeset-release/trunk` but fails at the PR-creation step.
2. **Configure the trusted publisher** on npmjs.com for **each** package → **Settings → Trusted Publisher** → GitHub Actions:
   - Organization or user: `thomasfosterau`
   - Repository: `effect-svelte`
   - Workflow filename: `release.yml`
   - Environment: `release`

   Then remove any classic automation tokens for the package. A trusted publisher can only be added to a package that already exists, so a brand-new package's first version is published by hand once (`vp run -r build && pnpm --filter <name> publish --access public` with a short-lived granular token) before OIDC takes over ([npm/cli#8544](https://github.com/npm/cli/issues/8544)).

3. **Protect the `release` environment.** **Settings → Environments → `release`** → enable **Required reviewers** (yourself) and restrict deployment to `trunk`, so every version-PR update and every publish pauses for manual approval. (If the environment does not exist, GitHub creates it unprotected on the first run.)
4. **Protect `trunk`.** Require pull requests and the passing `ci` check before merge, and disallow direct pushes, so a release can only be triggered by merging the reviewed version PR.

## Manual fallback

If the workflow can't open the PR (setting 1 is still off), the `changeset-release/trunk` branch is still pushed with the correct bump — open the version PR from it by hand. Never run `pnpm run version` or `pnpm run release` locally: versioning and publishing happen only in the Release workflow, which holds the OIDC identity npm trusts.
