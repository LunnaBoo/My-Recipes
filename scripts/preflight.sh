#!/usr/bin/env bash
# Refuses to publish secrets. Run manually before committing, and automatically
# before every push via scripts/git-hooks/pre-push.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2

fail=0
note() { printf '  x %s\n' "$1"; fail=1; }

echo "== preflight: secret scan =="

# 1. Files that must never be tracked.
forbidden="$(git ls-files | grep -Ei '(^|/)\.dev\.vars$|(^|/)credentials(\.json|/)|\.jks$|\.keystore$|(^|/)\.env$|(^|/)\.env\.(local|preview|production)$|\.p12$|\.p8$|\.mobileprovision$|\.apk$|\.aab$' || true)"
if [ -n "$forbidden" ]; then
  while IFS= read -r f; do note "forbidden file tracked: $f"; done <<< "$forbidden"
fi

# 2. Private keys and common token formats.
patterns='BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}'
hits="$(git grep -nIE "$patterns" -- . 2>/dev/null || true)"
if [ -n "$hits" ]; then
  while IFS= read -r h; do note "secret-looking string: $h"; done <<< "$hits"
fi

# 3. The live Worker write key, when it exists locally.
if [ -f worker/.dev.vars ]; then
  key="$(sed -n 's/^APP_KEY=//p' worker/.dev.vars | head -1)"
  if [ -n "${key:-}" ]; then
    if git grep -qF "$key" -- . 2>/dev/null; then
      note "live worker APP_KEY found in tracked files"
    fi
    if git log --all -p 2>/dev/null | grep -qF "$key"; then
      note "live worker APP_KEY found in git history"
    fi
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "== preflight: FAILED - do not push =="
  exit 1
fi
echo "== preflight: clean =="
