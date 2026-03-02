export type WranglerStorageType = "kv" | "d1" | "r2";

export interface WranglerRootsResult {
  roots: string[];
}

export interface WranglerStorageTypesResult {
  statePath: string;
  types: WranglerStorageType[];
}

export interface KvNamespaceInfo {
  id: string;
  binding?: string;
  blobsPath?: string;
  sqlitePath?: string;
}

export interface KvEntryInfo {
  key: string;
  blobId?: string;
  expiration?: number;
  metadata?: string;
  blobPath?: string;
  size?: number;
}

export interface KvListResult {
  prefixes: Array<{ prefix: string }>;
  entries: KvEntryInfo[];
}

export interface R2BucketInfo {
  name: string;
  blobsPath?: string;
}

export interface R2ObjectInfo {
  key: string;
  blobId: string;
  size: number;
  etag: string;
  uploaded: number;
  blobPath: string;
}

export interface R2ListResult {
  prefixes: Array<{ prefix: string }>;
  objects: R2ObjectInfo[];
}

export interface D1DatabaseInfo {
  sqlitePath: string;
  displayName: string;
}

export interface D1TableInfo {
  name: string;
  rowCount: number;
}

export interface D1RowsResult {
  rows: Array<Record<string, unknown>>;
}
