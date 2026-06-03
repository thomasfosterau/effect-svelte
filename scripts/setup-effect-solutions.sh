#!/usr/bin/env bash
# Sets up the effect-solutions CLI and the local Effect v4 reference repository.
#
# Referenced by CLAUDE.md and the Claude Code SessionStart hook so that agent
# sessions (including ephemeral cloud containers) always have Effect best
# practices and the v4 source available. Safe to re-run; everything is
# idempotent and failures are non-fatal.

set -u

EFFECT_REF_DIR="${HOME}/.local/share/effect-solutions/effect"

# 1. effect-solutions CLI (docs + patterns for Effect v4)
if ! command -v effect-solutions >/dev/null 2>&1; then
  echo "Installing effect-solutions CLI..."
  npm install -g effect-solutions >/dev/null 2>&1 || {
    echo "warning: could not install effect-solutions globally (non-fatal)"
  }
fi

# 2. Effect v4 source clone (for API reference / grep)
if [ ! -d "${EFFECT_REF_DIR}" ]; then
  echo "Cloning Effect v4 reference repository..."
  mkdir -p "$(dirname "${EFFECT_REF_DIR}")"
  git clone --depth 1 https://github.com/Effect-TS/effect-smol.git "${EFFECT_REF_DIR}" >/dev/null 2>&1 || {
    echo "warning: could not clone effect-smol reference repo (non-fatal)"
  }
fi

exit 0
