# R2-Explorer

A Visual Studio Code extension to browse and manage Cloudflare R2, AWS S3, and MinIO storage directly in your editor. This extension combines file explorer functionality with a built-in EML (Email) file viewer.

## Features
- Connect to S3-compatible cloud storage (specifically configured and optimized for Cloudflare R2)
- Explore buckets, folders, and objects in a tree view
- Explore local Wrangler storage (KV, D1, R2) from `.wrangler*` directories
- Read, upload, delete, rename, and move objects
- Generate Presigned URLs
- Seamlessly open and view `.eml` emails including their attachments and HTML bodies within VS Code
- Built with modern Node and Bun APIs

## Prerequisites
- Bun (required for local Wrangler explorer and seed scripts)
- VS Code (for extension development and testing)

## Local Wrangler Explorer
The **Wrangler Local** view scans your workspace for `.wrangler*` directories and exposes:
- KV namespaces and keys (values open as files)
- D1 databases, tables, and rows (rows open as JSON)
- R2 buckets and objects (objects open as files)

**Requirements:**
- Bun must be installed and available on `PATH` for local Wrangler exploration.

To seed the sample local environment used in this repo:
```bash
cd scripts/local-wrangler-env
bun ./populate-wrangler.ts
```

## Development
```bash
bun install
bun run watch
```

In VS Code, press `F5` to launch the Extension Development Host.

One-off build + checks:
```bash
bun run compile
bun run lint
bun run typecheck
bun run test
```

Fast unit test:
```bash
bun run test:unit
```

Package a VSIX locally:
```bash
bun run package
```

## Publishing
Publishing uses `vsce` and `ovsx`.

- VS Code Marketplace: `VSCE_PAT`
- Open VSX: `OPEN_VSX_PAT`

Scripts:
```bash
./scripts/publish.sh
./scripts/prerelease-publish.sh
```

## CI and Releases
GitHub Actions workflows run CI on every push/PR, build a VSIX artifact, and publish on version tags (`v*`).
