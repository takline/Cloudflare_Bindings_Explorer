#!/bin/bash
set -e

echo "Cleaning up..."
bun run clean
rm -rf node_modules

echo "Installing dependencies..."
bun install

echo "Packaging extension..."
bun run package

# Find the vsix file (assuming version might change)
VSIX_FILE=$(ls *.vsix | head -n 1)

if [ -z "$VSIX_FILE" ]; then
  echo "Error: .vsix file not found."
  exit 1
fi

echo "Done! $VSIX_FILE built."
