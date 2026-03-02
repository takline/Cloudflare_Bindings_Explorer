#!/bin/bash
set -e

export OPEN_VSX_PAT="$(op read "op://Tyler/open-vsx/token")"
export VSCE_PAT="$(op read "op://Tyler/Microsoft/publisher pat")"

if [ -z "$VSCE_PAT" ]; then
  echo "Error: VSCE_PAT is not set."
  exit 1
fi

if [ -z "$OPEN_VSX_PAT" ]; then
  echo "Error: OPEN_VSX_PAT is not set."
  exit 1
fi

bun run package
bunx vsce publish --pre-release -p "$VSCE_PAT"
bunx ovsx publish --pre-release -p "$OPEN_VSX_PAT"
