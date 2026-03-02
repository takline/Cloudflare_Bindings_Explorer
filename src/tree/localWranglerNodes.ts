import * as vscode from "vscode";
import { formatFileSize, formatLastModified, getObjectDisplayName, getPrefixDisplayName } from "../s3/listing";
import { getFileName, isAudioFile, isImageFile, isTextFile, isVideoFile } from "../util/paths";
import type { D1TableInfo, KvEntryInfo, KvNamespaceInfo, R2ObjectInfo } from "../local-wrangler/types";

export type LocalWranglerNodeType =
  | "wranglerRoot"
  | "storageType"
  | "kvNamespace"
  | "kvPrefix"
  | "kvEntry"
  | "r2Bucket"
  | "r2Prefix"
  | "r2Object"
  | "d1Database"
  | "d1Table"
  | "d1Row"
  | "message";

export abstract class LocalWranglerNode extends vscode.TreeItem {
  abstract readonly type: LocalWranglerNodeType;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }
}

export class WranglerRootNode extends LocalWranglerNode {
  readonly type = "wranglerRoot" as const;
  readonly wranglerPath: string;

  constructor(label: string, wranglerPath: string) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.wranglerPath = wranglerPath;
    this.contextValue = "wranglerRoot";
    this.iconPath = new vscode.ThemeIcon("root-folder");
    this.tooltip = wranglerPath;
  }
}

export class WranglerStorageTypeNode extends LocalWranglerNode {
  readonly type = "storageType" as const;
  readonly wranglerPath: string;
  readonly storageType: "kv" | "d1" | "r2";

  constructor(wranglerPath: string, storageType: "kv" | "d1" | "r2") {
    const label = storageType.toUpperCase();
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.wranglerPath = wranglerPath;
    this.storageType = storageType;
    this.contextValue = "wranglerStorageType";

    const iconName =
      storageType === "kv"
        ? "key"
        : storageType === "d1"
        ? "database"
        : "cloud";
    this.iconPath = new vscode.ThemeIcon(iconName);
    this.tooltip = `Wrangler ${label} storage`;
  }
}

export class WranglerKvNamespaceNode extends LocalWranglerNode {
  readonly type = "kvNamespace" as const;
  readonly wranglerPath: string;
  readonly namespace: KvNamespaceInfo;

  constructor(wranglerPath: string, namespace: KvNamespaceInfo) {
    const label = namespace.binding
      ? `${namespace.binding} (${namespace.id})`
      : namespace.id;
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.wranglerPath = wranglerPath;
    this.namespace = namespace;
    this.contextValue = "wranglerKvNamespace";
    this.iconPath = new vscode.ThemeIcon("key");
    this.tooltip = namespace.sqlitePath
      ? `KV Namespace: ${namespace.id}\n${namespace.sqlitePath}`
      : `KV Namespace: ${namespace.id}`;
  }
}

export class WranglerKvPrefixNode extends LocalWranglerNode {
  readonly type = "kvPrefix" as const;
  readonly wranglerPath: string;
  readonly namespace: KvNamespaceInfo;
  readonly prefix: string;

  constructor(
    wranglerPath: string,
    namespace: KvNamespaceInfo,
    prefix: string,
    parentPrefix?: string
  ) {
    const displayName = getPrefixDisplayName(prefix, parentPrefix);
    super(displayName, vscode.TreeItemCollapsibleState.Collapsed);
    this.wranglerPath = wranglerPath;
    this.namespace = namespace;
    this.prefix = prefix;
    this.contextValue = "wranglerKvPrefix";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.tooltip = `KV Prefix: ${prefix}`;
  }
}

export class WranglerKvEntryNode extends LocalWranglerNode {
  readonly type = "kvEntry" as const;
  readonly wranglerPath: string;
  readonly namespace: KvNamespaceInfo;
  readonly entry: KvEntryInfo;

  constructor(
    wranglerPath: string,
    namespace: KvNamespaceInfo,
    entry: KvEntryInfo,
    parentPrefix?: string
  ) {
    const label = getObjectDisplayName(entry.key, parentPrefix);
    super(label, vscode.TreeItemCollapsibleState.None);
    this.wranglerPath = wranglerPath;
    this.namespace = namespace;
    this.entry = entry;
    this.contextValue = "wranglerKvEntry";
    this.iconPath = getIconForKey(entry.key);
    this.tooltip = buildKvTooltip(entry);
    this.description = buildKvDescription(entry);

    if (entry.blobPath) {
      this.command = {
        command: "wranglerLocal.openItem",
        title: "Open KV Value",
        arguments: [this],
      };
    }
  }
}

export class WranglerR2BucketNode extends LocalWranglerNode {
  readonly type = "r2Bucket" as const;
  readonly wranglerPath: string;
  readonly bucket: string;

  constructor(wranglerPath: string, bucket: string) {
    super(bucket, vscode.TreeItemCollapsibleState.Collapsed);
    this.wranglerPath = wranglerPath;
    this.bucket = bucket;
    this.contextValue = "wranglerR2Bucket";
    this.iconPath = new vscode.ThemeIcon("database");
    this.tooltip = `R2 Bucket: ${bucket}`;
  }
}

export class WranglerR2PrefixNode extends LocalWranglerNode {
  readonly type = "r2Prefix" as const;
  readonly wranglerPath: string;
  readonly bucket: string;
  readonly prefix: string;

  constructor(
    wranglerPath: string,
    bucket: string,
    prefix: string,
    parentPrefix?: string
  ) {
    const displayName = getPrefixDisplayName(prefix, parentPrefix);
    super(displayName, vscode.TreeItemCollapsibleState.Collapsed);
    this.wranglerPath = wranglerPath;
    this.bucket = bucket;
    this.prefix = prefix;
    this.contextValue = "wranglerR2Prefix";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.tooltip = `R2 Prefix: ${prefix}`;
  }
}

export class WranglerR2ObjectNode extends LocalWranglerNode {
  readonly type = "r2Object" as const;
  readonly wranglerPath: string;
  readonly bucket: string;
  readonly object: R2ObjectInfo;

  constructor(
    wranglerPath: string,
    bucket: string,
    object: R2ObjectInfo,
    parentPrefix?: string
  ) {
    const label = getObjectDisplayName(object.key, parentPrefix);
    super(label, vscode.TreeItemCollapsibleState.None);
    this.wranglerPath = wranglerPath;
    this.bucket = bucket;
    this.object = object;
    this.contextValue = "wranglerR2Object";
    this.iconPath = getIconForKey(object.key);
    this.tooltip = buildR2Tooltip(object);
    this.description = buildR2Description(object);
    this.command = {
      command: "wranglerLocal.openItem",
      title: "Open R2 Object",
      arguments: [this],
    };
  }
}

export class WranglerD1DatabaseNode extends LocalWranglerNode {
  readonly type = "d1Database" as const;
  readonly wranglerPath: string;
  readonly sqlitePath: string;
  readonly displayName: string;

  constructor(wranglerPath: string, sqlitePath: string, displayName: string) {
    super(displayName, vscode.TreeItemCollapsibleState.Collapsed);
    this.wranglerPath = wranglerPath;
    this.sqlitePath = sqlitePath;
    this.displayName = displayName;
    this.contextValue = "wranglerD1Database";
    this.iconPath = new vscode.ThemeIcon("database");
    this.tooltip = sqlitePath;
  }
}

export class WranglerD1TableNode extends LocalWranglerNode {
  readonly type = "d1Table" as const;
  readonly wranglerPath: string;
  readonly sqlitePath: string;
  readonly table: D1TableInfo;

  constructor(
    wranglerPath: string,
    sqlitePath: string,
    table: D1TableInfo
  ) {
    super(table.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.wranglerPath = wranglerPath;
    this.sqlitePath = sqlitePath;
    this.table = table;
    this.contextValue = "wranglerD1Table";
    this.iconPath = new vscode.ThemeIcon("list-unordered");
    this.description = `${table.rowCount} rows`;
    this.tooltip = `D1 Table: ${table.name}`;
  }
}

export class WranglerD1RowNode extends LocalWranglerNode {
  readonly type = "d1Row" as const;
  readonly wranglerPath: string;
  readonly sqlitePath: string;
  readonly tableName: string;
  readonly row: Record<string, unknown>;

  constructor(
    wranglerPath: string,
    sqlitePath: string,
    tableName: string,
    row: Record<string, unknown>,
    index: number
  ) {
    const label = buildRowLabel(row, index);
    super(label, vscode.TreeItemCollapsibleState.None);
    this.wranglerPath = wranglerPath;
    this.sqlitePath = sqlitePath;
    this.tableName = tableName;
    this.row = row;
    this.contextValue = "wranglerD1Row";
    this.iconPath = new vscode.ThemeIcon("symbol-field");
    this.description = buildRowDescription(row);
    this.tooltip = `D1 Row: ${tableName}`;
    this.command = {
      command: "wranglerLocal.openItem",
      title: "Open D1 Row",
      arguments: [this],
    };
  }
}

export class MessageNode extends LocalWranglerNode {
  readonly type = "message" as const;

  constructor(label: string, tooltip?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "wranglerMessage";
    this.iconPath = new vscode.ThemeIcon("info");
    if (tooltip) {
      this.tooltip = tooltip;
    }
  }
}

export function isWranglerRootNode(node: LocalWranglerNode): node is WranglerRootNode {
  return node.type === "wranglerRoot";
}

export function isWranglerStorageTypeNode(
  node: LocalWranglerNode
): node is WranglerStorageTypeNode {
  return node.type === "storageType";
}

export function isWranglerKvNamespaceNode(
  node: LocalWranglerNode
): node is WranglerKvNamespaceNode {
  return node.type === "kvNamespace";
}

export function isWranglerKvPrefixNode(
  node: LocalWranglerNode
): node is WranglerKvPrefixNode {
  return node.type === "kvPrefix";
}

export function isWranglerKvEntryNode(
  node: LocalWranglerNode
): node is WranglerKvEntryNode {
  return node.type === "kvEntry";
}

export function isWranglerR2BucketNode(
  node: LocalWranglerNode
): node is WranglerR2BucketNode {
  return node.type === "r2Bucket";
}

export function isWranglerR2PrefixNode(
  node: LocalWranglerNode
): node is WranglerR2PrefixNode {
  return node.type === "r2Prefix";
}

export function isWranglerR2ObjectNode(
  node: LocalWranglerNode
): node is WranglerR2ObjectNode {
  return node.type === "r2Object";
}

export function isWranglerD1DatabaseNode(
  node: LocalWranglerNode
): node is WranglerD1DatabaseNode {
  return node.type === "d1Database";
}

export function isWranglerD1TableNode(
  node: LocalWranglerNode
): node is WranglerD1TableNode {
  return node.type === "d1Table";
}

export function isWranglerD1RowNode(
  node: LocalWranglerNode
): node is WranglerD1RowNode {
  return node.type === "d1Row";
}

function buildKvDescription(entry: KvEntryInfo): string {
  const parts: string[] = [];
  if (entry.size !== undefined) {
    parts.push(formatFileSize(entry.size));
  }
  if (entry.expiration) {
    const date = normalizeEpoch(entry.expiration);
    parts.push(`expires ${formatLastModified(date)}`);
  }
  return parts.join(" • ");
}

function buildKvTooltip(entry: KvEntryInfo): string {
  const lines = [`Key: ${entry.key}`];
  if (entry.blobId) {
    lines.push(`Blob: ${entry.blobId}`);
  }
  if (entry.expiration) {
    lines.push(`Expiration: ${normalizeEpoch(entry.expiration).toLocaleString()}`);
  }
  if (entry.size !== undefined) {
    lines.push(`Size: ${formatFileSize(entry.size)}`);
  }
  return lines.join("\n");
}

function buildR2Description(object: R2ObjectInfo): string {
  const parts = [formatFileSize(object.size)];
  if (object.uploaded) {
    parts.push(formatLastModified(normalizeEpoch(object.uploaded)));
  }
  return parts.join(" • ");
}

function buildR2Tooltip(object: R2ObjectInfo): string {
  const lines = [
    `Key: ${object.key}`,
    `Size: ${formatFileSize(object.size)}`,
    `ETag: ${object.etag}`,
  ];
  if (object.uploaded) {
    lines.push(`Uploaded: ${normalizeEpoch(object.uploaded).toLocaleString()}`);
  }
  return lines.join("\n");
}

function buildRowLabel(row: Record<string, unknown>, index: number): string {
  if (typeof row.rowid === "number") {
    return `rowid ${row.rowid}`;
  }
  return `Row ${index + 1}`;
}

function buildRowDescription(row: Record<string, unknown>): string {
  const previewKeys = Object.keys(row).filter((key) => key !== "rowid");
  const preview = previewKeys
    .slice(0, 2)
    .map((key) => `${key}: ${String(row[key])}`)
    .join(" • ");
  return preview;
}

function normalizeEpoch(value: number): Date {
  const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(timestamp);
}

function getIconForKey(key: string): vscode.ThemeIcon {
  const fileName = getFileName(key);

  if (isTextFile(key)) {
    if (fileName.toLowerCase().includes("readme")) {
      return new vscode.ThemeIcon("book");
    }
    if (key.endsWith(".json")) {
      return new vscode.ThemeIcon("json");
    }
    if (key.endsWith(".md")) {
      return new vscode.ThemeIcon("markdown");
    }
    if (key.match(/\.(js|ts|jsx|tsx)$/)) {
      return new vscode.ThemeIcon("javascript");
    }
    if (key.match(/\.(html|htm)$/)) {
      return new vscode.ThemeIcon("html");
    }
    if (key.endsWith(".css")) {
      return new vscode.ThemeIcon("css");
    }
    return new vscode.ThemeIcon("file-text");
  }

  if (isImageFile(key)) {
    return new vscode.ThemeIcon("file-media");
  }

  if (key.match(/\.(zip|tar|gz|bz2|7z|rar)$/)) {
    return new vscode.ThemeIcon("file-zip");
  }

  if (key.match(/\.(pdf)$/)) {
    return new vscode.ThemeIcon("file-pdf");
  }

  if (isVideoFile(key)) {
    return new vscode.ThemeIcon("play");
  }

  if (isAudioFile(key)) {
    return new vscode.ThemeIcon("play");
  }

  return new vscode.ThemeIcon("file");
}
