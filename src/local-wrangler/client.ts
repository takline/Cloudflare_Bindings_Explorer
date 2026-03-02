import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  D1DatabaseInfo,
  D1RowsResult,
  D1TableInfo,
  KvEntryInfo,
  KvListResult,
  KvNamespaceInfo,
  R2BucketInfo,
  R2ListResult,
  WranglerRootsResult,
  WranglerStorageTypesResult,
} from "./types";

const execFileAsync = promisify(execFile);

let transformScriptPath: string | null = null;

export class BunNotFoundError extends Error {
  constructor() {
    super("Bun runtime not found");
    this.name = "BunNotFoundError";
  }
}

export function initLocalWranglerClient(extensionPath: string): void {
  transformScriptPath = path.join(
    extensionPath,
    "scripts",
    "wrangler-local",
    "wrangler-local.ts"
  );
}

async function ensureTransformScript(): Promise<string> {
  if (!transformScriptPath) {
    throw new Error("Local Wrangler client not initialized");
  }

  try {
    await fs.access(transformScriptPath);
  } catch {
    throw new Error(`Wrangler transform script not found at ${transformScriptPath}`);
  }

  return transformScriptPath;
}

async function runTransform<T>(payload: object): Promise<T> {
  const scriptPath = await ensureTransformScript();
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64"
  );

  try {
    const { stdout } = await execFileAsync(
      "bun",
      [scriptPath, `--input=${encoded}`],
      { maxBuffer: 1024 * 1024 * 20 }
    );

    const parsed = JSON.parse(stdout) as { ok: boolean; data?: T; error?: string };
    if (!parsed.ok) {
      throw new Error(parsed.error || "Wrangler transform failed");
    }

    return parsed.data as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new BunNotFoundError();
    }

    if (error?.stdout) {
      try {
        const parsed = JSON.parse(error.stdout) as {
          ok: boolean;
          data?: T;
          error?: string;
        };
        if (!parsed.ok) {
          throw new Error(parsed.error || "Wrangler transform failed");
        }
      } catch {
        // Fall through to throw the original error below.
      }
    }

    throw error;
  }
}

export async function findWranglerRoots(roots: string[]): Promise<string[]> {
  const result = await runTransform<WranglerRootsResult>({
    action: "findRoots",
    roots,
  });
  return result.roots;
}

export async function listStorageTypes(
  wranglerDir: string
): Promise<WranglerStorageTypesResult> {
  return runTransform<WranglerStorageTypesResult>({
    action: "listStorageTypes",
    wranglerDir,
  });
}

export async function listKvNamespaces(
  wranglerDir: string
): Promise<KvNamespaceInfo[]> {
  const result = await runTransform<{ namespaces: KvNamespaceInfo[] }>({
    action: "listKvNamespaces",
    wranglerDir,
  });
  return result.namespaces;
}

export async function listKvEntries(payload: {
  wranglerDir: string;
  sqlitePath: string;
  blobsPath?: string;
  prefix?: string;
}): Promise<KvListResult> {
  return runTransform<KvListResult>({
    action: "listKvEntries",
    ...payload,
  });
}

export async function listR2Buckets(
  wranglerDir: string
): Promise<R2BucketInfo[]> {
  const result = await runTransform<{ buckets: R2BucketInfo[] }>({
    action: "listR2Buckets",
    wranglerDir,
  });
  return result.buckets;
}

export async function listR2Objects(payload: {
  wranglerDir: string;
  bucket: string;
  prefix?: string;
}): Promise<R2ListResult> {
  return runTransform<R2ListResult>({
    action: "listR2Objects",
    ...payload,
  });
}

export async function listD1Databases(
  wranglerDir: string
): Promise<D1DatabaseInfo[]> {
  const result = await runTransform<{ databases: D1DatabaseInfo[] }>({
    action: "listD1Databases",
    wranglerDir,
  });
  return result.databases;
}

export async function listD1Tables(payload: {
  sqlitePath: string;
}): Promise<D1TableInfo[]> {
  const result = await runTransform<{ tables: D1TableInfo[] }>({
    action: "listD1Tables",
    ...payload,
  });
  return result.tables;
}

export async function listD1Rows(payload: {
  sqlitePath: string;
  table: string;
}): Promise<D1RowsResult> {
  return runTransform<D1RowsResult>({
    action: "listD1Rows",
    ...payload,
  });
}
