#!/usr/bin/env sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/.venv-tools"

python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip diff-cover

echo ""
echo "Installed diff-cover to: $VENV/bin/diff-cover"
echo "Add to your .env (if not already set):"
echo "DIFF_COVER_BIN=.venv-tools/bin/diff-cover"
