# Releasing

Releases are automated with [Changesets](https://github.com/changesets/changesets)
and the **Release** GitHub workflow (`.github/workflows/release.yml`). Two
packages are published from this monorepo:

- `@thomasfosterau/effect-svelte` (`packages/svelte`)
- `@thomasfosterau/effect-sveltekit` (`packages/sveltekit`)

The private example apps under `examples/` are listed in
`.changeset/config.json`'s `ignore`, so they are never versioned or published.

## One-time repository setup (required)

The Release workflow needs two settings that live in GitHub, **not** in the
repo — a release cannot complete until both are in place:

1. **Allow the Action to open the release PR.**
   _Settings → Actions → General → Workflow permissions →_ enable
   **"Allow GitHub Actions to create and approve pull requests."**
   Without this, the workflow runs `changeset version` and pushes the
   `changeset-release/main` branch successfully, but fails at the final step
   with `GitHub Actions is not permitted to create or approve pull requests`,
   so no "Version Packages" PR is opened.

2. **Add an npm token.**
   _Settings → Secrets and variables → Actions →_ add a secret named
   **`NPM_TOKEN`** — an npm **automation** (or granular) token with publish
   access to the `@thomasfosterau` scope. The workflow's publish step
   (`changeset publish`) fails without it.

## How a release happens

1. **Land changesets.** Every change that should appear in the changelog ships
   with a changeset — a markdown file in `.changeset/` created by
   `vp run changeset` (pick the affected package(s) and a bump type). Preview
   what is pending with `vp run changeset status`.

2. **Version Packages PR (automatic).** On every push to `main`, the Release
   workflow runs `vp run version` (`changeset version`): it consumes the pending
   changesets, bumps the affected `package.json` versions, and writes each
   package's `CHANGELOG.md` on the `changeset-release/main` branch, then opens
   (or updates) a **"Version Packages"** PR. Review it like any other PR.

3. **Publish (automatic on merge).** Merging the "Version Packages" PR triggers
   the workflow's publish step, `vp run release`
   (`vp run -r build && changeset publish`), which builds every package and
   publishes the ones whose versions changed to npm.

## Manual fallback

If the workflow can't open the PR (e.g. setting #1 above is still off), the
`changeset-release/main` branch is still pushed with the correct version bump —
open the "Version Packages" PR from that branch by hand. You can also run the
version step locally:

```bash
vp run version          # apply pending changesets -> bumps + CHANGELOGs
git switch -c version-packages
git commit -am "Version Packages"
# open a PR; merging it triggers publish (or run `vp run release` locally)
```

## Cheat sheet

```bash
vp run changeset          # author a changeset
vp run changeset status   # preview pending releases
vp run version            # apply changesets locally (bumps + CHANGELOGs)
vp run release            # build all packages + changeset publish
```
