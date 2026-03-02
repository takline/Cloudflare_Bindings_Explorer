#!/bin/bash
set -e

echo "Packaging extension..."
bun run package

# Find the vsix file (assuming version might change)
VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -n 1)

if [ -z "$VSIX_FILE" ]; then
  echo "Error: .vsix file not found."
  exit 1
fi

echo "Installing $VSIX_FILE..."
code --install-extension "$VSIX_FILE" --force
cursor --install-extension "$VSIX_FILE" --force

echo "Done! Reload VS Code to use the updated extension."
