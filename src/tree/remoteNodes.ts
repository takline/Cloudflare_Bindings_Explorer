import * as vscode from "vscode";
import { formatLastModified, getObjectDisplayName, getPrefixDisplayName } from "../s3/listing";
import { getFileName, isAudioFile, isImageFile, isTextFile, isVideoFile } from "../util/paths";
import { RemoteD1DatabaseInfo, RemoteKvEntryInfo, RemoteKvNamespaceInfo } from "../remote-bindings/types";

export type RemoteStorageType = "d1" | "r2" | "kv";

export type RemoteExplorerNodeType =
  | "remoteStorageRoot"
  | "remoteD1Database"
  | "remoteKvNamespace"
  | "remoteKvPrefix"
  | "remoteKvEntry"
  | "remoteKvLoadMore"
  | "remoteMessage";

export abstract class RemoteExplorerNode extends vscode.TreeItem {
  abstract readonly type: RemoteExplorerNodeType;
}

export class RemoteStorageRootNode extends RemoteExplorerNode {
  readonly type = "remoteStorageRoot" as const;
  readonly storageType: RemoteStorageType;

  constructor(storageType: RemoteStorageType) {
    const label = storageType.toUpperCase();
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.storageType = storageType;
    this.contextValue = "remoteStorageRoot";
    this.iconPath = new vscode.ThemeIcon(
      storageType === "d1" ? "database" : storageType === "kv" ? "key" : "cloud"
    );
    this.tooltip = `Remote ${label} bindings`;
  }
}

export class RemoteD1DatabaseNode extends RemoteExplorerNode {
  readonly type = "remoteD1Database" as const;
  readonly databaseId: string;
  readonly databaseName: string;

  constructor(database: RemoteD1DatabaseInfo) {
    super(database.name, vscode.TreeItemCollapsibleState.None);
    this.databaseId = database.id;
    this.databaseName = database.name;
    this.contextValue = "remoteD1Database";
    this.iconPath = new vscode.ThemeIcon("database");
    this.description = "Click to open visual editor";
    const created = database.createdAt ? `\nCreated: ${formatLastModified(new Date(database.createdAt))}` : "";
    this.tooltip = `Remote D1: ${database.name}\nID: ${database.id}${created}`;
    this.command = {
      command: "remoteBindings.openD1Database",
      title: "Open Remote D1 Database",
      arguments: [this],
    };
  }
}

export class RemoteKvNamespaceNode extends RemoteExplorerNode {
  readonly type = "remoteKvNamespace" as const;
  readonly namespaceId: string;
  readonly titleName: string;
  readonly namespace: RemoteKvNamespaceInfo;

  constructor(namespace: RemoteKvNamespaceInfo) {
    super(namespace.title, vscode.TreeItemCollapsibleState.Collapsed);
    this.namespaceId = namespace.id;
    this.titleName = namespace.title;
    this.namespace = namespace;
    this.contextValue = "remoteKvNamespace";
    this.iconPath = new vscode.ThemeIcon("key");
    this.tooltip = `Remote KV namespace: ${namespace.title}\nID: ${namespace.id}`;
  }
}

export class RemoteKvPrefixNode extends RemoteExplorerNode {
  readonly type = "remoteKvPrefix" as const;
  readonly namespaceId: string;
  readonly namespaceTitle: string;
  readonly prefix: string;

  constructor(
    namespaceId: string,
    namespaceTitle: string,
    prefix: string,
    parentPrefix?: string
  ) {
    const displayName = getPrefixDisplayName(prefix, parentPrefix);
    super(displayName, vscode.TreeItemCollapsibleState.Collapsed);
    this.namespaceId = namespaceId;
    this.namespaceTitle = namespaceTitle;
    this.prefix = prefix;
    this.contextValue = "remoteKvPrefix";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.tooltip = `Remote KV prefix: ${prefix}`;
  }
}

export class RemoteKvEntryNode extends RemoteExplorerNode {
  readonly type = "remoteKvEntry" as const;
  readonly namespaceId: string;
  readonly namespaceTitle: string;
  readonly entry: RemoteKvEntryInfo;

  constructor(
    namespaceId: string,
    namespaceTitle: string,
    entry: RemoteKvEntryInfo,
    parentPrefix?: string
  ) {
    const label = getObjectDisplayName(entry.key, parentPrefix);
    super(label, vscode.TreeItemCollapsibleState.None);
    this.namespaceId = namespaceId;
    this.namespaceTitle = namespaceTitle;
    this.entry = entry;
    this.contextValue = "remoteKvEntry";
    this.iconPath = getIconForKey(entry.key);
    this.tooltip = buildKvTooltip(namespaceTitle, entry);
    this.description = buildKvDescription(entry);
    this.command = {
      command: "remoteBindings.openKvEntry",
      title: "Open Remote KV Value",
      arguments: [this],
    };
  }
}

export class RemoteKvLoadMoreNode extends RemoteExplorerNode {
  readonly type = "remoteKvLoadMore" as const;
  readonly namespaceId: string;
  readonly namespaceTitle: string;
  readonly prefix?: string;
  readonly cursor: string;

  constructor(
    namespaceId: string,
    namespaceTitle: string,
    cursor: string,
    prefix?: string
  ) {
    super("Load more...", vscode.TreeItemCollapsibleState.None);
    this.namespaceId = namespaceId;
    this.namespaceTitle = namespaceTitle;
    this.cursor = cursor;
    this.prefix = prefix;
    this.contextValue = "remoteKvLoadMore";
    this.iconPath = new vscode.ThemeIcon("ellipsis");
    this.tooltip = "Click to load more KV keys";
    this.command = {
      command: "remoteBindings.loadMoreKv",
      title: "Load More KV Keys",
      arguments: [this],
    };
  }
}

export class RemoteMessageNode extends RemoteExplorerNode {
  readonly type = "remoteMessage" as const;

  constructor(label: string, tooltip?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "remoteMessage";
    this.iconPath = new vscode.ThemeIcon("info");
    if (tooltip) {
      this.tooltip = tooltip;
    }
  }
}

export function isRemoteStorageRootNode(
  node: unknown
): node is RemoteStorageRootNode {
  return (node as { type?: string })?.type === "remoteStorageRoot";
}

export function isRemoteD1DatabaseNode(
  node: unknown
): node is RemoteD1DatabaseNode {
  return (node as { type?: string })?.type === "remoteD1Database";
}

export function isRemoteKvNamespaceNode(
  node: unknown
): node is RemoteKvNamespaceNode {
  return (node as { type?: string })?.type === "remoteKvNamespace";
}

export function isRemoteKvPrefixNode(node: unknown): node is RemoteKvPrefixNode {
  return (node as { type?: string })?.type === "remoteKvPrefix";
}

export function isRemoteKvEntryNode(node: unknown): node is RemoteKvEntryNode {
  return (node as { type?: string })?.type === "remoteKvEntry";
}

export function isRemoteKvLoadMoreNode(
  node: unknown
): node is RemoteKvLoadMoreNode {
  return (node as { type?: string })?.type === "remoteKvLoadMore";
}

function buildKvDescription(entry: RemoteKvEntryInfo): string {
  const parts: string[] = [];
  if (entry.expiration) {
    parts.push(
      `expires ${formatLastModified(
        new Date(entry.expiration < 1_000_000_000_000 ? entry.expiration * 1000 : entry.expiration)
      )}`
    );
  }
  return parts.join(" • ");
}

function buildKvTooltip(namespace: string, entry: RemoteKvEntryInfo): string {
  const lines = [`Namespace: ${namespace}`, `Key: ${entry.key}`];
  if (entry.expiration) {
    const date = new Date(
      entry.expiration < 1_000_000_000_000 ? entry.expiration * 1000 : entry.expiration
    );
    lines.push(`Expiration: ${date.toLocaleString()}`);
  }
  if (entry.metadata) {
    lines.push(`Metadata: ${entry.metadata}`);
  }
  return lines.join("\n");
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

  if (isVideoFile(key)) {
    return new vscode.ThemeIcon("play");
  }

  if (isAudioFile(key)) {
    return new vscode.ThemeIcon("play");
  }

  return new vscode.ThemeIcon("file");
}

