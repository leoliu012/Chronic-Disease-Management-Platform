#!/usr/bin/env bash
set -euo pipefail
ROOT=${1:-$PWD}
if [ -d "$ROOT/apps/api/apps/web" ]; then
  rm -rf "$ROOT/apps/api/apps"
  echo "Removed misapplied nested web directory under apps/api."
else
  echo "No misapplied nested web directory found."
fi
