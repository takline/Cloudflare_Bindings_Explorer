export interface RemoteD1DatabaseInfo {
  id: string;
  name: string;
  createdAt?: string;
}

export interface RemoteD1DatabasesResult {
  databases: RemoteD1DatabaseInfo[];
  page: number;
  hasMore: boolean;
}

export interface RemoteD1QueryResult {
  rows: Array<Record<string, unknown>>;
}

export interface RemoteD1SnapshotResult {
  sqlitePath: string;
  fromCache: boolean;
  tableCount: number;
  rowLimit: number;
  databaseId?: string;
  databaseName?: string;
}

export interface RemoteKvNamespaceInfo {
  id: string;
  title: string;
  supportsUrlEncoding?: boolean;
}

export interface RemoteKvNamespacesResult {
  namespaces: RemoteKvNamespaceInfo[];
  page: number;
  hasMore: boolean;
}

export interface RemoteKvEntryInfo {
  key: string;
  expiration?: number;
  metadata?: string;
}

export interface RemoteKvListResult {
  prefixes: Array<{ prefix: string }>;
  entries: RemoteKvEntryInfo[];
  cursor?: string;
  isTruncated: boolean;
}
