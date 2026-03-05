
# Cloudflare Bindings Explorer

<br>
<br>
<p align="center">
  <img src="images/logo/dark.png" alt="Cloudflare Bindings Explorer" width="128">
</p>
<br>
<br>

A powerful VS Code extension to browse and manage **Cloudflare bindings** (R2, KV, D1), **AWS S3**, and **MinIO** storage directly from your editor. Say goodbye to switching between the Cloudflare dashboard and your code—explore, query, and manage your data right where you build.

## Key Features

- **Cloudflare R2 & S3-Compatible Storage** 
  - Effortlessly browse buckets, prefixes, and objects.
  - Upload, download, rename, move, and delete files.
  - Generate presigned URLs for quick sharing.
  - S3 configuration is heavily optimized for Cloudflare R2 (`auto` region defaults).

- **Remote Cloudflare Explorer**
  - **D1 Databases**: Explore remote databases, open them in an interactive SQLite visual editor, and view schema/table structures.
  - **KV Namespaces**: Browse keys and prefixes. Easily view string and JSON values.
  - **R2 Buckets**: View alongside your other remote bindings.

- **Local Wrangler Explorer**
  - Scans your workspace for `.wrangler*` and `wrangler*` directories automatically.
  - Instantly exposes local **KV namespaces**, **D1 databases**, and **R2 buckets** spun up by `wrangler dev`.
  - View local SQLite database files (like D1 local state) in a rich visual editor.
  - Easily add external SQLite databases to the local explorer.

- **Integrated EML (Email) Viewer**
  - Double-click any `.eml` file to read it seamlessly within VS Code.
  - View rendered HTML email bodies and download attachments—perfect for testing Cloudflare Email Routing workers.

---

## Installation

1. Open VS Code and navigate to the **Extensions** view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2. Search for **Cloudflare Bindings Explorer**.
3. Click **Install**.
4. Once installed, a new Cloudflare icon will appear in your Activity Bar.

---

## Configuration & Usage

### 1. Connecting to Cloudflare R2 / S3
To explore your R2 buckets, you need to configure your S3 credentials.

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Run **`Cloudflare: Update R2 Endpoint & Credentials`**.
3. Enter your **Account ID**, **R2 Access Key ID**, and **R2 Secret Access Key** when prompted.
   - *Note: You can generate an R2 token from the Cloudflare Dashboard under **R2 -> Manage R2 API Tokens**.*
4. Your credentials are securely stored using your operating system's native keychain (via VS Code's SecretStorage) and are never saved to plain text settings files.

### 2. Exploring Remote D1 and KV Bindings
To view your remote Cloudflare D1 databases and KV namespaces, provide your standard Cloudflare API credentials.

1. Go to your VS Code Settings (`Ctrl+,` or `Cmd+,`).
2. Search for `Cloudflare Bindings Explorer` and set your `cloudflare.accountId`.
3. Open the Command Palette and run **`Cloudflare: Update R2 Endpoint & Credentials`** to provide your **Cloudflare API Token** (requires D1/KV read permissions).
4. Refresh the **Remote Cloudflare** view to see your resources populated.

### 3. Local Wrangler Development
If you use `wrangler dev` to test your workers locally, the **Wrangler Local** view will automatically detect your `.wrangler` state folder within the active workspace.
- **D1**: Click on a database to open a read-only visual snapshot of its state.
- **KV**: Browse local key-value pairs stored during development.
- **R2**: Manage objects stored in local emulator buckets.

---

## Security

Security is our top priority:
- Sensitive credentials (API Tokens, Secret Keys) are strictly stored in VS Code's system keychain vault. 
- They are never written to `settings.json` or any workspace files.
- The secure setup panel masks existing credentials (`********`) to prevent over-the-shoulder exposure.

---

## Contributing & Development

This extension is built with modern Node/Bun APIs and a custom high-performance Rust CLI helper for SQLite operations.

**Prerequisites:**
- [Bun](https://bun.sh/)
- [Rust toolchain](https://rustup.rs/) (cargo)

**Setup:**
```bash
git clone https://github.com/takline/Cloudflare_Bindings_Explorer.git
cd Cloudflare_Bindings_Explorer
bun install
bun run watch
```
Press `F5` in VS Code to launch the Extension Development Host.

**Testing:**
```bash
bun run compile
bun run test
```

## Feedback & Issues

Encountered a bug or have a feature request? Please open an issue on the [GitHub Repository](https://github.com/takline/Cloudflare_Bindings_Explorer).
