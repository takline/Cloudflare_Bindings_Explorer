import * as vscode from "vscode";
import * as bindingsClient from "../bindings/client";
import * as secrets from "../util/secrets";
import {
  RemoteD1DatabaseInfo,
  RemoteD1DatabasesResult,
  RemoteD1QueryResult,
  RemoteD1SnapshotResult,
  RemoteKvListResult,
  RemoteKvNamespaceInfo,
  RemoteKvNamespacesResult,
} from "./types";

const MAX_REMOTE_LIST_PAGES = 5;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_KV_LIMIT = 200;
const DEFAULT_D1_ROW_LIMIT = 500;
const DEFAULT_D1_TABLE_LIMIT = 100;

const d1DatabaseCache = new Map<string, { expiresAt: number; items: RemoteD1DatabaseInfo[] }>();
const kvNamespaceCache = new Map<string, { expiresAt: number; items: RemoteKvNamespaceInfo[] }>();

export type RemoteBindingsConfig = {
  accountId: string;
  apiToken: string;
};

export function clearRemoteBindingsCache(): void {
  d1DatabaseCache.clear();
  kvNamespaceCache.clear();
}

async function getRemoteBindingsConfig(): Promise<RemoteBindingsConfig> {
  const cloudflareConfig = vscode.workspace.getConfiguration("cloudflare");
  const r2Config = vscode.workspace.getConfiguration("r2");
  const endpointUrl = r2Config.get<string>("endpointUrl", "");
  const inferredAccountId = extractAccountIdFromR2Endpoint(endpointUrl || "");
  const accountId = (
    cloudflareConfig.get<string>("accountId", "") ||
    inferredAccountId ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    ""
  ).trim();
  const apiToken = (
    (await secrets.getSecret("cloudflare.apiToken")) ||
    process.env.CLOUDFLARE_API_TOKEN ||
    ""
  ).trim();

  return { accountId, apiToken };
}

function extractAccountIdFromR2Endpoint(endpointUrl: string): string | undefined {
  try {
    const parsed = new URL(endpointUrl);
    if (parsed.protocol !== "https:") {
      return undefined;
    }

    const hostParts = parsed.hostname.split(".");
    if (hostParts.length < 4) {
      return undefined;
    }

    if (hostParts[hostParts.length - 3] !== "r2") {
      return undefined;
    }

    if (hostParts[hostParts.length - 2] !== "cloudflarestorage") {
      return undefined;
    }

    if (hostParts[hostParts.length - 1] !== "com") {
      return undefined;
    }

    return hostParts[0] || undefined;
  } catch {
    return undefined;
  }
}

function ensureRemoteBindingsConfig(
  config: RemoteBindingsConfig
): RemoteBindingsConfig {
  if (!config.accountId) {
    throw new Error(
      "Cloudflare Account ID is required for remote D1/KV browsing. Update connection settings."
    );
  }

  if (!config.apiToken) {
    throw new Error(
      "Cloudflare API token is required for remote D1/KV browsing. Update connection settings."
    );
  }

  return config;
}

function cacheKeyForConfig(config: RemoteBindingsConfig): string {
  return config.accountId;
}

export async function listRemoteD1Databases(): Promise<RemoteD1DatabaseInfo[]> {
  const config = ensureRemoteBindingsConfig(await getRemoteBindingsConfig());
  const cacheKey = cacheKeyForConfig(config);
  const now = Date.now();
  const cached = d1DatabaseCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.items;
  }

  const databases: RemoteD1DatabaseInfo[] = [];
  let page = 1;

  for (let i = 0; i < MAX_REMOTE_LIST_PAGES; i++) {
    const result = (await bindingsClient.runBindingsCli({
      action: "listRemoteD1Databases",
      accountId: config.accountId,
      apiToken: config.apiToken,
      page,
      perPage: DEFAULT_PAGE_SIZE,
    })) as RemoteD1DatabasesResult;

    if (Array.isArray(result?.databases)) {
      databases.push(
        ...result.databases.filter(
          (database): database is RemoteD1DatabaseInfo =>
            typeof database?.id === "string" && typeof database?.name === "string"
        )
      );
    }

    if (!result?.hasMore) {
      break;
    }

    page += 1;
  }

  const deduped = dedupeById(databases);
  d1DatabaseCache.set(cacheKey, {
    items: deduped,
    expiresAt: now + 30_000,
  });
  return deduped;
}

export async function materializeRemoteD1Database(
  payload: { databaseId: string; databaseName?: string; forceRefresh?: boolean }
): Promise<RemoteD1SnapshotResult> {
  const config = ensureRemoteBindingsConfig(await getRemoteBindingsConfig());
  const result = (await bindingsClient.runBindingsCli({
    action: "materializeRemoteD1Database",
    accountId: config.accountId,
    apiToken: config.apiToken,
    databaseId: payload.databaseId,
    databaseName: payload.databaseName || payload.databaseId,
    forceRefresh: Boolean(payload.forceRefresh),
    maxTables: DEFAULT_D1_TABLE_LIMIT,
    maxRowsPerTable: DEFAULT_D1_ROW_LIMIT,
  })) as RemoteD1SnapshotResult;

  if (typeof result?.sqlitePath !== "string" || result.sqlitePath.length === 0) {
    throw new Error("Failed to materialize remote D1 database snapshot.");
  }

  return result;
}

export async function executeRemoteD1Sql(payload: {
  databaseId: string;
  sql: string;
}): Promise<Array<Record<string, unknown>>> {
  const config = ensureRemoteBindingsConfig(await getRemoteBindingsConfig());
  const result = (await bindingsClient.runBindingsCli({
    action: "executeRemoteD1Sql",
    accountId: config.accountId,
    apiToken: config.apiToken,
    databaseId: payload.databaseId,
    sql: payload.sql,
  })) as RemoteD1QueryResult;

  return Array.isArray(result?.rows)
    ? result.rows.filter(
        (row): row is Record<string, unknown> =>
          row !== null && typeof row === "object"
      )
    : [];
}

export async function listRemoteKvNamespaces(): Promise<RemoteKvNamespaceInfo[]> {
  const config = ensureRemoteBindingsConfig(await getRemoteBindingsConfig());
  const cacheKey = cacheKeyForConfig(config);
  const now = Date.now();
  const cached = kvNamespaceCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.items;
  }

  const namespaces: RemoteKvNamespaceInfo[] = [];
  let page = 1;

  for (let i = 0; i < MAX_REMOTE_LIST_PAGES; i++) {
    const result = (await bindingsClient.runBindingsCli({
      action: "listRemoteKvNamespaces",
      accountId: config.accountId,
      apiToken: config.apiToken,
      page,
      perPage: DEFAULT_PAGE_SIZE,
    })) as RemoteKvNamespacesResult;

    if (Array.isArray(result?.namespaces)) {
      namespaces.push(
        ...result.namespaces.filter(
          (namespace): namespace is RemoteKvNamespaceInfo =>
            typeof namespace?.id === "string" &&
            typeof namespace?.title === "string"
        )
      );
    }

    if (!result?.hasMore) {
      break;
    }

    page += 1;
  }

  const deduped = dedupeNamespaces(namespaces);
  kvNamespaceCache.set(cacheKey, {
    items: deduped,
    expiresAt: now + 30_000,
  });
  return deduped;
}

export async function listRemoteKvEntries(payload: {
  namespaceId: string;
  prefix?: string;
  cursor?: string;
  limit?: number;
}): Promise<RemoteKvListResult> {
  const config = ensureRemoteBindingsConfig(await getRemoteBindingsConfig());
  const normalizedLimit = Math.max(10, Math.min(1000, payload.limit || DEFAULT_KV_LIMIT));
  const result = (await bindingsClient.runBindingsCli({
    action: "listRemoteKvEntries",
    accountId: config.accountId,
    apiToken: config.apiToken,
    namespaceId: payload.namespaceId,
    prefix: payload.prefix,
    cursor: payload.cursor,
    limit: normalizedLimit,
  })) as RemoteKvListResult;

  return {
    prefixes: Array.isArray(result?.prefixes)
      ? result.prefixes.filter((entry) => typeof entry?.prefix === "string")
      : [],
    entries: Array.isArray(result?.entries)
      ? result.entries.filter((entry) => typeof entry?.key === "string")
      : [],
    cursor: typeof result?.cursor === "string" ? result.cursor : undefined,
    isTruncated: Boolean(result?.isTruncated),
  };
}

export async function readRemoteKvValue(payload: {
  namespaceId: string;
  key: string;
}): Promise<string> {
  const config = ensureRemoteBindingsConfig(await getRemoteBindingsConfig());
  const result = (await bindingsClient.runBindingsCli({
    action: "readRemoteKvValue",
    accountId: config.accountId,
    apiToken: config.apiToken,
    namespaceId: payload.namespaceId,
    key: payload.key,
  })) as { content?: unknown };

  if (typeof result?.content !== "string") {
    throw new Error("Remote KV value response was invalid.");
  }

  return result.content;
}

function dedupeById(databases: RemoteD1DatabaseInfo[]): RemoteD1DatabaseInfo[] {
  const seen = new Set<string>();
  const deduped: RemoteD1DatabaseInfo[] = [];
  for (const database of databases) {
    if (seen.has(database.id)) {
      continue;
    }
    seen.add(database.id);
    deduped.push(database);
  }
  return deduped.sort((a, b) => a.name.localeCompare(b.name));
}

function dedupeNamespaces(
  namespaces: RemoteKvNamespaceInfo[]
): RemoteKvNamespaceInfo[] {
  const seen = new Set<string>();
  const deduped: RemoteKvNamespaceInfo[] = [];
  for (const namespace of namespaces) {
    if (seen.has(namespace.id)) {
      continue;
    }
    seen.add(namespace.id);
    deduped.push(namespace);
  }
  return deduped.sort((a, b) => a.title.localeCompare(b.title));
}
