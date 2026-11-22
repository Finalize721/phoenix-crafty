#!/usr/bin/env bash
# Read-only Phoenix Crafty environment checks: no network, installs, or mutations.
set -uo pipefail

info() { printf 'INFO: %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*"; }

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root" || exit 1
info "Project directory: $root"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  warn 'Not inside a Git working tree.'
fi

remote="$(git remote get-url origin 2>/dev/null || true)"
if [[ -z "$remote" ]]; then
  warn 'No origin remote. Verify repository manually.'
else
  info "origin: $remote"
  slug="${remote#https://github.com/}"
  slug="${slug#http://github.com/}"
  slug="${slug#git@github.com:}"
  slug="${slug#ssh://git@github.com/}"
  slug="${slug%.git}"
  slug="${slug%/}"
  if [[ "$slug" == 'Finalize721/phoenix-crafty' ]]; then
    info "Verified fork: $slug"
  else
    warn "origin is not verified as Finalize721/phoenix-crafty (parsed: $slug). Do not use implicit gh defaults."
  fi
fi

if command -v gh >/dev/null 2>&1; then
  info "GitHub CLI: $(command -v gh) (always pass explicit -R after verifying origin)"
else
  warn 'gh not on PATH; GitHub CLI checks unavailable.'
fi

if command -v bun >/dev/null 2>&1; then
  info "Bun: $(bun --version 2>/dev/null || printf 'unable to read version') at $(command -v bun)"
else
  warn 'Bun unavailable in this shell; do not claim Bun scripts have passed.'
fi

for tool in vitest tsc biome vite; do
  if [[ -x "node_modules/.bin/$tool" ]]; then
    info "Installed local CLI available: node_modules/.bin/$tool"
  else
    warn "Local CLI missing: node_modules/.bin/$tool"
  fi
done

if [[ -f package.json ]]; then
  manager="$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n 1)"
  info "Declared package manager: ${manager:-not found}"
fi
if [[ -f biome.json ]]; then
  schema="$(sed -n 's/.*"\$schema"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' biome.json | head -n 1)"
  info "Biome schema: ${schema:-not found}"
fi
if [[ -f .github/workflows/pages.yml ]]; then
  info 'Pages workflow: .github/workflows/pages.yml present'
else
  warn 'Pages workflow not found at .github/workflows/pages.yml'
fi
info 'Expected deploy base: /phoenix-crafty/ (verify locally with Vite preview --base=/phoenix-crafty/)'
info 'Preflight finished: read-only checks only; no tests/builds/deployments executed.'
