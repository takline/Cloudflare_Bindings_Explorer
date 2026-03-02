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

echo "Packaging extension..."
bun run package

echo "Publishing to VS Code Marketplace..."
bunx vsce publish -p "$VSCE_PAT" --no-dependencies

echo "Publishing to Open VSX Registry..."
bunx ovsx publish -p "$OPEN_VSX_PAT" --no-dependencies
