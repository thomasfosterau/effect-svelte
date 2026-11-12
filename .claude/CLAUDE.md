@../AGENTS.md
@../CONTRIBUTING.md
@../README.md

# Claude Code

The three files imported above are the project's guidance: [AGENTS.md](../AGENTS.md) (conventions, pitfalls, gates), [CONTRIBUTING.md](../CONTRIBUTING.md) (setup, commands, hooks, CI) and [README.md](../README.md) (what the packages are). Edit those; this file holds only what is specific to Claude Code. Each package's `CLAUDE.md` likewise imports the `AGENTS.md` beside it.

## Settings and hooks

[settings.json](settings.json) is committed and wires three hooks. `settings.local.json` is yours and is git-ignored.

- **SessionStart** (`startup|resume`, 180 s): [hooks/session-start.sh](hooks/session-start.sh) installs the global Vite+ CLI at the catalog's `vite-plus` pin with the official installer (npm-provenance and SHA-512 checked), links `vp` and `vpx` into `~/.local/bin` for non-interactive shells (the CLI lives under `$VP_HOME` when set, as in the Vite+ container image, else `~/.local/share/vite-plus`), repairs a broken `node` shim, and runs `vp install --frozen-lockfile`. The global `vp` delegates to each checkout's own `vite-plus`, worktrees included. If the installer can't run, `vp` falls back to this checkout's `node_modules` copy.
- **PreToolUse** on `Bash`: [hooks/fallow-gate.sh](hooks/fallow-gate.sh) blocks `git commit` / `git push` when `fallow audit --base origin/trunk` (run through `vp exec fallow`) returns `fail`. It reads the coverage map on disk and never refreshes it, so run `vp run test:coverage` first. A fallow runtime error fails open with a notice.
- **PostToolUse** on `Write|Edit|MultiEdit` (15 s): runs `vp fmt --write` on the source, JSON, CSS or Markdown file you just wrote, so don't hand-format.

## Worktrees

- Worktrees go in `.claude/worktrees/<name>` (git-ignored), one per branch, each branched from `origin/trunk`. Run `pnpm install --frozen-lockfile` in a new one: `node_modules` is per checkout.
- The fallow gate audits only this checkout and its `.claude/worktrees/*`. For a commit in any other tree it runs none of that tree's tooling and skips the audit with a notice.
- `coverage/` is per checkout too: run `vp run test:coverage` in the worktree you commit from.

## Session limits

- A cloud session's network allowlist needs `vite.plus` and `viteplus.dev` for the SessionStart installer; `pnpm audit` needs the npm registry.
- The session hydrates no secrets and none are needed. Nothing here can publish: releases go through the `release` environment ([PUBLISHING.md](../PUBLISHING.md)).
- GitHub writes go to `thomasfosterau/effect-svelte` only.
