#!/usr/bin/env bash
#
# Provision a checkout for NON-INTERACTIVE use.
#
# One file, two callers — the Claude Code SessionStart hook and the
# devcontainer's `postCreateCommand` (which invokes this file directly) — so a
# container shell and an agent session are provisioned identically. (Copied
# from the library standard, effect-jsonapi / effect-drizzle-ext; the
# `gardeneria #NNN` citations below name the issues there that are the
# evidence behind a decision, not tickets in this tracker.)
#
# ## What it does
#
# 1. Installs the dependencies against the lockfile, so `vp check` /
#    `vp test` / `vp pack` can run in a fresh agent session.
# 2. Puts `vp` on PATH. The global Vite+ launcher is not installed in cloud
#    sessions, and `node_modules/.bin` is on nobody's PATH, so it writes a
#    re-exec shim into `~/.local/bin` (a directory already on PATH and
#    writable by the session user). A file survives where an `export` cannot:
#    this script cannot change its caller's environment.
# 3. Repairs a broken bare `node` shim (see below).
# 4. Installs the effect-solutions CLI and clones the Effect v4 reference
#    repository (Effect-TS/effect-smol) that AGENTS.md tells agents to consult.
#
# ## Node, and why this repairs rather than clobbers
#
# `~/.vite-plus/bin/node` is a shim pointing at the `vp` launcher, which
# resolves a Node version and installs it under `~/.vite-plus/js_runtime`.
# When that directory is not writable by the session user and the resolved
# version drifts past the cached one, the shim fails with `Permission denied`
# (gardeneria #1462). This script therefore *tests* `node --version` and only
# replaces the shim when it is already broken, pointing it at a real cached
# binary. A working shim is left alone.
#
# ## Secrets
#
# This hook hydrates NO secrets, and this repository needs none: every gate
# runs offline against the lockfile. Publishing is the release workflow's job
# and uses npm OIDC trusted publishing (docs/RELEASING.md).
#
# ## Contract
#
# Idempotent, and never fatal. Every failure path logs and continues, because
# the SessionStart hook must not block a session and a half-provisioned
# container is more useful than a container that refused to start.
#
# Untrusted-content note: this script reads only fixed, hardcoded paths. It
# takes no input from repo content, issue or PR bodies, or anything an agent
# could have been persuaded to write earlier in a session. Do not add such
# input without revisiting this note — it runs on every session start and
# container create.

set -uo pipefail

log() { printf '[session-start] %s\n' "$1" >&2; }

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LOCAL_BIN="${HOME:-/root}/.local/bin"
EFFECT_REF_DIR="${HOME:-/root}/.local/share/effect-solutions/effect"

mkdir -p "$LOCAL_BIN" 2>/dev/null || log "cannot create $LOCAL_BIN; continuing"

# `vp` gets a re-exec shim rather than a plain symlink. A symlink always
# resolves to $PROJECT_DIR's node_modules/vite-plus, even when invoked with
# cwd inside a `.claude/worktrees/*` checkout — so the CLI process would load
# the primary tree's vitest while the worktree's test modules resolve the
# worktree's own copy, and two physical instances of vitest corrupt its
# suite-collector state (gardeneria #1663). The shim instead walks up from
# $PWD for the nearest project-local vite-plus and re-execs that, falling back
# to the primary checkout's when none is found above cwd.
VP_SHIM_MARKER="# generated-by: .claude/hooks/session-start.sh (vp re-exec shim, gardeneria issue #1663)"
write_vp_shim() {
  dest="$LOCAL_BIN/vp"
  [ -x "$PROJECT_DIR/node_modules/vite-plus/bin/vp" ] || return 0
  # Leave a real, non-generated file alone: something deliberately installed
  # it (e.g. the global Vite+ launcher). A stale symlink or a shim generated
  # earlier is fair game — the embedded fallback path can change.
  if [ -e "$dest" ] && [ ! -L "$dest" ] && ! grep -qF "$VP_SHIM_MARKER" "$dest" 2>/dev/null; then
    return 0
  fi
  cat >"$dest.tmp" <<SHIM
#!/usr/bin/env bash
$VP_SHIM_MARKER
dir="\$PWD"
while [ -n "\$dir" ]; do
  if [ -x "\$dir/node_modules/vite-plus/bin/vp" ]; then
    exec "\$dir/node_modules/vite-plus/bin/vp" "\$@"
  fi
  [ "\$dir" = "/" ] && break
  dir="\$(dirname "\$dir")"
done
exec "$PROJECT_DIR/node_modules/vite-plus/bin/vp" "\$@"
SHIM
  chmod +x "$dest.tmp" 2>/dev/null && mv -f "$dest.tmp" "$dest" 2>/dev/null \
    || { rm -f "$dest.tmp" 2>/dev/null; log "could not write vp shim"; }
}

# ── 1. Bare `node` (gardeneria #1462) ────────────────────────────────────────
# Only repair a shim that is already failing. `command -v node` is not enough:
# the shim exists and resolves, then dies on use, so the version call is the
# real test.
if ! node --version >/dev/null 2>&1; then
  VP_ROOT="${VP_HOME:-${HOME:-/root}/.vite-plus}"
  # Newest cached runtime wins; `sort -V` so 24.9 does not beat 24.18.
  REAL_NODE="$(
    find "$VP_ROOT/js_runtime/node" -maxdepth 3 -type f -name node -perm -u+x 2>/dev/null \
      | sort -V | tail -1
  )"
  if [ -n "$REAL_NODE" ]; then
    log "bare \`node\` is broken; pointing it at $REAL_NODE"
    ln -sfn "$REAL_NODE" "$VP_ROOT/bin/node" 2>/dev/null \
      || ln -sfn "$REAL_NODE" "$LOCAL_BIN/node" 2>/dev/null \
      || log "could not repair node"
  else
    log "bare \`node\` is broken and no cached runtime was found"
  fi
fi

# ── 2. Dependencies ──────────────────────────────────────────────────────────
# Unconditional, not only when node_modules is absent: a prebaked container can
# carry a tree built from an OLDER lockfile, and stale dependencies masquerade
# as trunk breakage. `--frozen-lockfile` is a sub-second no-op when in sync.
if [ -f "$PROJECT_DIR/pnpm-lock.yaml" ]; then
  log "syncing dependencies against the lockfile…"
  (cd "$PROJECT_DIR" && pnpm install --frozen-lockfile >/dev/null 2>&1) \
    || (cd "$PROJECT_DIR" && corepack pnpm install --frozen-lockfile >/dev/null 2>&1) \
    || (cd "$PROJECT_DIR" && npx --yes "pnpm@$(node -p 'require("./package.json").packageManager.split("@")[1]')" install --frozen-lockfile >/dev/null 2>&1) \
    || log "dependency install failed; continuing"
fi

# ── 3. `vp` on PATH ──────────────────────────────────────────────────────────
# node_modules/.bin only exists after the install, so this runs after step 2.
write_vp_shim

# ── 4. effect-solutions + the Effect v4 reference clone ──────────────────────
if ! command -v effect-solutions >/dev/null 2>&1; then
  log "installing the effect-solutions CLI…"
  npm install -g effect-solutions >/dev/null 2>&1 \
    || log "could not install effect-solutions globally (non-fatal)"
fi
if [ ! -d "$EFFECT_REF_DIR" ]; then
  log "cloning the Effect v4 reference repository…"
  mkdir -p "$(dirname "$EFFECT_REF_DIR")"
  git clone --depth 1 https://github.com/Effect-TS/effect-smol.git "$EFFECT_REF_DIR" >/dev/null 2>&1 \
    || log "could not clone the effect-smol reference repository (non-fatal)"
fi

exit 0
