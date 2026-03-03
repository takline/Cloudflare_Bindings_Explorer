import { runBindingsCli } from "../opendal/client";
import {
  D1DatabaseInfo,
  D1RowsResult,
  D1TableInfo,
  KvListResult,
  KvNamespaceInfo,
  R2BucketInfo,
  R2ListResult,
  WranglerStorageTypesResult,
} from "./types";

export class LocalWranglerRuntimeNotFoundError extends Error {
  constructor() {
    super("Bindings CLI runtime not found");
    this.name = "LocalWranglerRuntimeNotFoundError";
  }
}

export function initLocalWranglerClient(_extensionPath: string): void {
  // CLI is initialized in extension.ts via initOpenDalClient.
}

function mapCliError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Bindings CLI not initialized") ||
    message.includes("ENOENT")
  ) {
    throw new LocalWranglerRuntimeNotFoundError();
  }

  throw error instanceof Error ? error : new Error(message);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export async function findWranglerRoots(roots: string[]): Promise<string[]> {
  try {
    const result = await runBindingsCli({ action: "findRoots", roots });
    return readStringArray((result as { roots?: unknown }).roots);
  } catch (error) {
    mapCliError(error);
  }
}

export async function listStorageTypes(
  wranglerDir: string
): Promise<WranglerStorageTypesResult> {
  try {
    const result = await runBindingsCli({
      action: "listStorageTypes",
      wranglerDir,
    });

    return {
      statePath:
        typeof result?.statePath === "string"
          ? result.statePath
          : wranglerDir,
      types: readStringArray(result?.types).filter(
        (type): type is "kv" | "d1" | "r2" =>
          type === "kv" || type === "d1" || type === "r2"
      ),
    };
  } catch (error) {
    mapCliError(error);
  }
}

export async function listKvNamespaces(
  wranglerDir: string
): Promise<KvNamespaceInfo[]> {
  try {
    const result = await runBindingsCli({
      action: "listKvNamespaces",
      wranglerDir,
    });

    if (!Array.isArray(result?.namespaces)) {
      return [];
    }

    return result.namespaces as KvNamespaceInfo[];
  } catch (error) {
    mapCliError(error);
  }
}

export async function listKvEntries(payload: {
  wranglerDir: string;
  sqlitePath: string;
  blobsPath?: string;
  prefix?: string;
}): Promise<KvListResult> {
  try {
    const result = await runBindingsCli({
      action: "listKvEntries",
      wranglerDir: payload.wranglerDir,
      sqlitePath: payload.sqlitePath,
      blobsPath: payload.blobsPath,
      prefix: payload.prefix,
    });

    return {
      prefixes: Array.isArray(result?.prefixes)
        ? (result.prefixes as Array<{ prefix: string }>).filter(
            (item) => typeof item?.prefix === "string"
          )
        : [],
      entries: Array.isArray(result?.entries)
        ? (result.entries as KvListResult["entries"])
        : [],
    };
  } catch (error) {
    mapCliError(error);
  }
}

export async function listR2Buckets(
  wranglerDir: string
): Promise<R2BucketInfo[]> {
  try {
    const result = await runBindingsCli({ action: "listR2Buckets", wranglerDir });
    if (!Array.isArray(result?.buckets)) {
      return [];
    }

    return result.buckets as R2BucketInfo[];
  } catch (error) {
    mapCliError(error);
  }
}

export async function listR2Objects(payload: {
  wranglerDir: string;
  bucket: string;
  prefix?: string;
}): Promise<R2ListResult> {
  try {
    const result = await runBindingsCli({
      action: "listR2Objects",
      wranglerDir: payload.wranglerDir,
      bucket: payload.bucket,
      prefix: payload.prefix,
    });

    return {
      prefixes: Array.isArray(result?.prefixes)
        ? (result.prefixes as Array<{ prefix: string }>).filter(
            (item) => typeof item?.prefix === "string"
          )
        : [],
      objects: Array.isArray(result?.objects)
        ? (result.objects as R2ListResult["objects"])
        : [],
    };
  } catch (error) {
    mapCliError(error);
  }
}

export async function listD1Databases(
  wranglerDir: string
): Promise<D1DatabaseInfo[]> {
  try {
    const result = await runBindingsCli({ action: "listD1Databases", wranglerDir });
    if (!Array.isArray(result?.databases)) {
      return [];
    }

    return result.databases as D1DatabaseInfo[];
  } catch (error) {
    mapCliError(error);
  }
}

export async function listD1Tables(payload: {
  sqlitePath: string;
}): Promise<D1TableInfo[]> {
  try {
    const result = await runBindingsCli({
      action: "listD1Tables",
      sqlitePath: payload.sqlitePath,
    });

    if (!Array.isArray(result?.tables)) {
      return [];
    }

    return result.tables as D1TableInfo[];
  } catch (error) {
    mapCliError(error);
  }
}

export async function listD1Rows(payload: {
  sqlitePath: string;
  table: string;
}): Promise<D1RowsResult> {
  try {
    const result = await runBindingsCli({
      action: "listD1Rows",
      sqlitePath: payload.sqlitePath,
      table: payload.table,
    });

    return {
      rows: Array.isArray(result?.rows)
        ? (result.rows as Array<Record<string, unknown>>)
        : [],
    };
  } catch (error) {
    mapCliError(error);
  }
}
