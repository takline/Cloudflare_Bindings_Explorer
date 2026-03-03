
# Cloudflare Bindings Explorer

<br>
<br>
<p align="center">
  <img src="images/logo/dark.png" alt="Cloudflare Bindings Explorer" width="128">
</p>
<br>
<br>

A VSCode extension to browse and manage Cloudflare bindings (R2, KV, D1), AWS S3, and MinIO storage directly in your editor. This extension combines file explorer functionality with a built-in EML (Email) file viewer.


## Features
- Connect to S3-compatible cloud storage (specifically configured and optimized for Cloudflare R2)
- Explore buckets, folders, and objects in a tree view
- Explore local Wrangler storage (KV, D1, R2) from `.wrangler*` directories
- Visual SQLite editor for local bindings and manually added databases
- Read, upload, delete, rename, and move objects
- Generate Presigned URLs
- Seamlessly open and view `.eml` emails including their attachments and HTML bodies within VS Code
- Built with modern Node and Bun APIs

## Prerequisites
- Bun (required for development scripts and local env seeding)
- Rust toolchain (required to build the bindings CLI used by local SQLite exploration)
- VS Code (for extension development and testing)

## Local Wrangler Explorer
The **Wrangler Local** view scans your workspace for `.wrangler*` directories and exposes:
- KV namespaces and keys (values open as files)
- D1 databases, tables, and rows (rows open as JSON)
- R2 buckets and objects (objects open as files)
- SQLite databases (open in the visual editor)

Add a custom SQLite database with the `Add SQLite Database` action in the Wrangler Local view title bar.

**Requirements:**
- Build the bindings CLI once via `bun run build:cli` (or `bun run compile`).

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
