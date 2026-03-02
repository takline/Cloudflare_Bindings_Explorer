import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

type WranglerStorageType = "kv" | "d1" | "r2";

type InputPayload =
  | { action: "findRoots"; roots: string[] }
  | { action: "listStorageTypes"; wranglerDir: string }
  | { action: "listKvNamespaces"; wranglerDir: string }
  | { action: "listKvEntries"; wranglerDir: string; sqlitePath: string; blobsPath?: string; prefix?: string }
  | { action: "listR2Buckets"; wranglerDir: string }
  | { action: "listR2Objects"; wranglerDir: string; bucket: string; prefix?: string }
  | { action: "listD1Databases"; wranglerDir: string }
  | { action: "listD1Tables"; sqlitePath: string }
  | { action: "listD1Rows"; sqlitePath: string; table: string };

type JsonResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".turbo",
  ".next",
  ".cache",
  "dist",
  "out",
  "build",
  ".vscode",
]);

function resolveStatePath(wranglerDir: string): string {
  return path.join(wranglerDir, "state", "v3");
}

function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function listSubdirs(dir: string): string[] {
  return safeReaddir(dir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function listSqliteFiles(dir: string): string[] {
  return safeReaddir(dir)
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => path.join(dir, entry.name));
}

function stripJsonComments(content: string): string {
  const withoutBlock = content.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlock.replace(/^\s*\/\/.*$/gm, "");
}

function findWranglerConfig(wranglerDir: string): Record<string, unknown> | null {
  let current = path.dirname(wranglerDir);
  while (true) {
    const jsonc = path.join(current, "wrangler.jsonc");
    const json = path.join(current, "wrangler.json");
    if (fs.existsSync(jsonc)) {
      const content = fs.readFileSync(jsonc, "utf8");
      return JSON.parse(stripJsonComments(content)) as Record<string, unknown>;
    }
    if (fs.existsSync(json)) {
      const content = fs.readFileSync(json, "utf8");
      return JSON.parse(content) as Record<string, unknown>;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

function buildPrefixListing<T extends { key: string }>(
  items: T[],
  prefix?: string
): { prefixes: string[]; objects: T[] } {
  const prefixes = new Set<string>();
  const objects: T[] = [];
  const basePrefix = prefix ?? "";

  for (const item of items) {
    if (basePrefix && !item.key.startsWith(basePrefix)) {
      continue;
    }

    const rest = basePrefix ? item.key.slice(basePrefix.length) : item.key;
    const slashIndex = rest.indexOf("/");

    if (slashIndex >= 0) {
      const prefixValue = basePrefix + rest.slice(0, slashIndex + 1);
      prefixes.add(prefixValue);
      continue;
    }

    objects.push(item);
  }

  return {
    prefixes: Array.from(prefixes).sort((a, b) => a.localeCompare(b)),
    objects: objects.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function sqliteHasBlob(sqlitePath: string, blobId: string): boolean {
  try {
    const db = new Database(sqlitePath);
    const row = db
      .query("SELECT 1 AS ok FROM _mf_entries WHERE blob_id = ? LIMIT 1")
      .get(blobId) as { ok?: number } | null;
    db.close();
    return Boolean(row && row.ok === 1);
  } catch {
    return false;
  }
}

function readFirstBlobId(blobsPath?: string): string | null {
  if (!blobsPath) {
    return null;
  }

  const entries = safeReaddir(blobsPath).filter((entry) => entry.isFile());
  if (entries.length === 0) {
    return null;
  }

  return entries[0]?.name ?? null;
}

function resolveBlobPath(blobId: string, blobRoots: string[]): string | null {
  for (const root of blobRoots) {
    const candidate = path.join(root, blobId);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function listWranglerRoots(roots: string[]): string[] {
  const found = new Set<string>();

  const walk = (dir: string) => {
    for (const entry of safeReaddir(dir)) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.name.startsWith(".wrangler")) {
        found.add(path.join(dir, entry.name));
        continue;
      }

      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }

      walk(path.join(dir, entry.name));
    }
  };

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    walk(root);
  }

  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

function listStorageTypes(wranglerDir: string): {
  statePath: string;
  types: WranglerStorageType[];
} {
  const statePath = resolveStatePath(wranglerDir);
  const types: WranglerStorageType[] = [];

  if (fs.existsSync(path.join(statePath, "kv"))) {
    types.push("kv");
  }
  if (fs.existsSync(path.join(statePath, "d1"))) {
    types.push("d1");
  }
  if (fs.existsSync(path.join(statePath, "r2"))) {
    types.push("r2");
  }

  return { statePath, types };
}

function listKvNamespaces(wranglerDir: string) {
  const statePath = resolveStatePath(wranglerDir);
  const kvRoot = path.join(statePath, "kv");
  if (!fs.existsSync(kvRoot)) {
    return { namespaces: [] };
  }

  const config = findWranglerConfig(wranglerDir) ?? {};
  const kvNamespaces = Array.isArray((config as any).kv_namespaces)
    ? ((config as any).kv_namespaces as Array<{ id?: string; binding?: string }>)
    : [];
  const bindingById = new Map<string, string>();
  for (const ns of kvNamespaces) {
    if (ns.id && ns.binding) {
      bindingById.set(ns.id, ns.binding);
    }
  }

  const namespaceDirs = listSubdirs(kvRoot).filter(
    (name) => name !== "miniflare-KVNamespaceObject"
  );
  const sqliteDir = path.join(kvRoot, "miniflare-KVNamespaceObject");
  const sqliteFiles = listSqliteFiles(sqliteDir);

  const namespaces = namespaceDirs.map((id) => {
    const blobsPath = path.join(kvRoot, id, "blobs");
    return {
      id,
      binding: bindingById.get(id),
      blobsPath,
      sqlitePath: undefined as string | undefined,
    };
  });

  for (const namespace of namespaces) {
    const sampleBlob = readFirstBlobId(namespace.blobsPath);
    if (!sampleBlob) {
      continue;
    }

    for (const sqliteFile of sqliteFiles) {
      if (sqliteHasBlob(sqliteFile, sampleBlob)) {
        namespace.sqlitePath = sqliteFile;
        break;
      }
    }
  }

  if (sqliteFiles.length === 1 && namespaces.length === 1) {
    namespaces[0].sqlitePath = namespaces[0].sqlitePath ?? sqliteFiles[0];
  }

  const mappedSqlites = new Set(
    namespaces.map((ns) => ns.sqlitePath).filter(Boolean) as string[]
  );

  for (const sqliteFile of sqliteFiles) {
    if (!mappedSqlites.has(sqliteFile)) {
      namespaces.push({
        id: path.basename(sqliteFile, ".sqlite"),
        binding: undefined,
        blobsPath: undefined,
        sqlitePath: sqliteFile,
      });
    }
  }

  return { namespaces };
}

function listKvEntries(payload: {
  wranglerDir: string;
  sqlitePath: string;
  blobsPath?: string;
  prefix?: string;
}) {
  const sqlitePath = path.resolve(payload.sqlitePath);
  const db = new Database(sqlitePath);
  const rows = db
    .query(
      "SELECT key, blob_id as blobId, expiration, metadata FROM _mf_entries"
    )
    .all() as Array<{
    key: string;
    blobId: string;
    expiration: number | null;
    metadata: string | null;
  }>;
  db.close();

  const kvRoot = path.join(resolveStatePath(payload.wranglerDir), "kv");
  const candidateBlobRoots = payload.blobsPath
    ? [payload.blobsPath]
    : listSubdirs(kvRoot)
        .filter((name) => name !== "miniflare-KVNamespaceObject")
        .map((name) => path.join(kvRoot, name, "blobs"));

  const entriesWithPaths = rows.map((row) => {
    const blobPath = resolveBlobPath(row.blobId, candidateBlobRoots);
    const size = blobPath && fs.existsSync(blobPath)
      ? fs.statSync(blobPath).size
      : undefined;
    return {
      key: row.key,
      blobId: row.blobId,
      expiration: row.expiration ?? undefined,
      metadata: row.metadata ?? undefined,
      blobPath: blobPath ?? undefined,
      size,
    };
  });

  const { prefixes, objects } = buildPrefixListing(entriesWithPaths, payload.prefix);

  return {
    prefixes: prefixes.map((prefix) => ({ prefix })),
    entries: objects,
  };
}

function listR2Buckets(wranglerDir: string) {
  const statePath = resolveStatePath(wranglerDir);
  const r2Root = path.join(statePath, "r2");
  if (!fs.existsSync(r2Root)) {
    return { buckets: [] };
  }

  const buckets = listSubdirs(r2Root).filter(
    (name) => name !== "miniflare-R2BucketObject"
  );

  return {
    buckets: buckets.map((name) => ({
      name,
      blobsPath: path.join(r2Root, name, "blobs"),
    })),
  };
}

function listR2Objects(payload: {
  wranglerDir: string;
  bucket: string;
  prefix?: string;
}) {
  const statePath = resolveStatePath(payload.wranglerDir);
  const sqliteDir = path.join(statePath, "r2", "miniflare-R2BucketObject");
  const sqliteFiles = listSqliteFiles(sqliteDir);

  if (sqliteFiles.length === 0) {
    return { prefixes: [], objects: [] };
  }

  const blobsPath = path.join(statePath, "r2", payload.bucket, "blobs");
  const blobRoots = [blobsPath];

  const db = new Database(sqliteFiles[0]);
  const rows = db
    .query(
      "SELECT key, blob_id as blobId, size, etag, uploaded FROM _mf_objects"
    )
    .all() as Array<{
    key: string;
    blobId: string;
    size: number;
    etag: string;
    uploaded: number;
  }>;
  db.close();

  const objects = rows
    .map((row) => {
      const blobPath = resolveBlobPath(row.blobId, blobRoots);
      if (!blobPath) {
        return null;
      }

      return {
        key: row.key,
        blobId: row.blobId,
        size: row.size,
        etag: row.etag,
        uploaded: row.uploaded,
        blobPath,
      };
    })
    .filter(Boolean) as Array<{
    key: string;
    blobId: string;
    size: number;
    etag: string;
    uploaded: number;
    blobPath: string;
  }>;

  const { prefixes, objects: filteredObjects } = buildPrefixListing(
    objects,
    payload.prefix
  );

  return {
    prefixes: prefixes.map((prefix) => ({ prefix })),
    objects: filteredObjects,
  };
}

function listD1Databases(wranglerDir: string) {
  const statePath = resolveStatePath(wranglerDir);
  const d1Dir = path.join(statePath, "d1", "miniflare-D1DatabaseObject");
  if (!fs.existsSync(d1Dir)) {
    return { databases: [] };
  }

  const sqliteFiles = listSqliteFiles(d1Dir);
  const config = findWranglerConfig(wranglerDir) ?? {};
  const d1Databases = Array.isArray((config as any).d1_databases)
    ? ((config as any).d1_databases as Array<{
        database_name?: string;
        binding?: string;
      }>)
    : [];

  const singleConfig = d1Databases.length === 1 ? d1Databases[0] : null;

  return {
    databases: sqliteFiles.map((sqlitePath) => ({
      sqlitePath,
      displayName:
        singleConfig?.database_name ||
        singleConfig?.binding ||
        path.basename(sqlitePath, ".sqlite"),
    })),
  };
}

function listD1Tables(payload: { sqlitePath: string }) {
  const sqlitePath = path.resolve(payload.sqlitePath);
  const db = new Database(sqlitePath);
  const tables = db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_cf_METADATA'"
    )
    .all() as Array<{ name: string }>;

  const tableSummaries = tables.map((table) => {
    const safeName = table.name.replace(/\"/g, '\"\"');
    const countRow = db
      .query(`SELECT COUNT(*) as count FROM \"${safeName}\"`)
      .get() as { count?: number } | null;
    return {
      name: table.name,
      rowCount: countRow?.count ?? 0,
    };
  });

  db.close();

  return { tables: tableSummaries };
}

function listD1Rows(payload: { sqlitePath: string; table: string }) {
  const tableName = payload.table;
  if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
    throw new Error(`Unsupported table name: ${tableName}`);
  }

  const sqlitePath = path.resolve(payload.sqlitePath);
  const db = new Database(sqlitePath);
  const rows = db
    .query(`SELECT rowid, * FROM \"${tableName}\"`)
    .all() as Array<Record<string, unknown>>;
  db.close();

  return { rows };
}

function parseInput(): InputPayload {
  const arg = process.argv.find((value) => value.startsWith("--input="));
  if (!arg) {
    throw new Error("Missing --input argument");
  }

  const encoded = arg.replace("--input=", "");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  return JSON.parse(decoded) as InputPayload;
}

function respond(result: JsonResult) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function main() {
  try {
    const input = parseInput();

    switch (input.action) {
      case "findRoots":
        respond({ ok: true, data: { roots: listWranglerRoots(input.roots) } });
        return;
      case "listStorageTypes":
        respond({
          ok: true,
          data: listStorageTypes(input.wranglerDir),
        });
        return;
      case "listKvNamespaces":
        respond({ ok: true, data: listKvNamespaces(input.wranglerDir) });
        return;
      case "listKvEntries":
        respond({ ok: true, data: listKvEntries(input) });
        return;
      case "listR2Buckets":
        respond({ ok: true, data: listR2Buckets(input.wranglerDir) });
        return;
      case "listR2Objects":
        respond({ ok: true, data: listR2Objects(input) });
        return;
      case "listD1Databases":
        respond({ ok: true, data: listD1Databases(input.wranglerDir) });
        return;
      case "listD1Tables":
        respond({ ok: true, data: listD1Tables(input) });
        return;
      case "listD1Rows":
        respond({ ok: true, data: listD1Rows(input) });
        return;
      default:
        respond({ ok: false, error: `Unknown action: ${input.action}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respond({ ok: false, error: message });
  }
}

main();
