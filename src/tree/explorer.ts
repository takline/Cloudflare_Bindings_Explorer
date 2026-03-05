import * as vscode from "vscode";
import { listBuckets, listObjects } from "../s3/listing";
import { CacheEntry, ListObjectsResult, S3Error } from "../types";
import { s3Cache } from "../util/cache";
import { logError } from "../util/output";
import {
  clearRemoteBindingsCache,
  listRemoteD1Databases,
  listRemoteKvEntries,
  listRemoteKvNamespaces,
} from "../remote-bindings/client";
import { RemoteKvEntryInfo } from "../remote-bindings/types";
import {
  BaseTreeNode,
  BucketNode,
  ObjectNode,
  LoadMoreNode,
  createBucketNode,
  createPrefixNode,
  createObjectNode,
  createLoadMoreNode,
  isBucketNode,
  isPrefixNode,
  isObjectNode,
  isLoadMoreNode,
} from "./nodes";
import {
  RemoteD1DatabaseNode,
  RemoteKvEntryNode,
  RemoteExplorerNode,
  RemoteKvLoadMoreNode,
  RemoteKvNamespaceNode,
  RemoteKvPrefixNode,
  RemoteMessageNode,
  RemoteStorageRootNode,
  isRemoteD1DatabaseNode,
  isRemoteKvLoadMoreNode,
  isRemoteKvNamespaceNode,
  isRemoteKvPrefixNode,
  isRemoteStorageRootNode,
} from "./remoteNodes";

type ExplorerTreeNode = BaseTreeNode | RemoteExplorerNode;

type RemoteKvCacheEntry = {
  prefixes: string[];
  entries: RemoteKvEntryInfo[];
  cursor?: string;
  isTruncated: boolean;
  namespaceTitle: string;
};

const REMOTE_D1_HIDDEN_KEY = "cloudflareBindingsExplorer.remoteD1HiddenConnections";

export class S3Explorer
  implements
    vscode.TreeDataProvider<ExplorerTreeNode>,
    vscode.TreeDragAndDropController<ExplorerTreeNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ExplorerTreeNode | undefined | null | void
  >();

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Drag and drop support
  dropMimeTypes = ["application/vnd.code.tree.r2Explorer"];
  dragMimeTypes = ["text/uri-list", "application/vnd.code.tree.r2Explorer"];

  private readonly remoteKvCache = new Map<string, RemoteKvCacheEntry>();

  constructor(private readonly store?: vscode.Memento) {}

  refresh(element?: ExplorerTreeNode): void {
    if (!element) {
      s3Cache.invalidateAll();
      this.remoteKvCache.clear();
      clearRemoteBindingsCache();
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    if (isBucketNode(element)) {
      s3Cache.invalidate(element.bucket);
    } else if (isPrefixNode(element)) {
      s3Cache.invalidate(element.bucket, element.prefix);
    } else if (isRemoteStorageRootNode(element)) {
      if (element.storageType === "kv") {
        this.remoteKvCache.clear();
      } else {
        clearRemoteBindingsCache();
      }
    } else if (isRemoteKvNamespaceNode(element) || isRemoteKvPrefixNode(element)) {
      this.clearRemoteKvNamespaceCache(element.namespaceId);
    } else if (isRemoteKvLoadMoreNode(element)) {
      this.clearRemoteKvNamespaceCache(element.namespaceId);
    }

    this._onDidChangeTreeData.fire(element);
  }

  getTreeItem(element: ExplorerTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ExplorerTreeNode): Promise<ExplorerTreeNode[]> {
    try {
      if (!element) {
        return this.getRootNodes();
      }

      if (isRemoteStorageRootNode(element)) {
        switch (element.storageType) {
          case "d1":
            return await this.getRemoteD1Databases();
          case "kv":
            return await this.getRemoteKvNamespaces();
          case "r2":
            return await this.getBuckets();
          default:
            return [];
        }
      }

      if (isBucketNode(element)) {
        return await this.getBucketContents(element.bucket);
      }

      if (isPrefixNode(element)) {
        return await this.getPrefixContents(element.bucket, element.prefix);
      }

      if (isRemoteKvNamespaceNode(element)) {
        return await this.getRemoteKvEntries({
          namespaceId: element.namespaceId,
          namespaceTitle: element.titleName,
        });
      }

      if (isRemoteKvPrefixNode(element)) {
        return await this.getRemoteKvEntries({
          namespaceId: element.namespaceId,
          namespaceTitle: element.namespaceTitle,
          prefix: element.prefix,
        });
      }

      if (
        isLoadMoreNode(element) ||
        isRemoteKvLoadMoreNode(element) ||
        isObjectNode(element) ||
        isRemoteD1DatabaseNode(element)
      ) {
        return [];
      }

      return [];
    } catch (error) {
      logError("Error getting tree children.", error);
      const message = error instanceof Error ? error.message : String(error);

      if (isRemoteNode(element)) {
        return [new RemoteMessageNode(`Remote bindings error: ${message}`)];
      }

      if (
        error instanceof Error &&
        (error.message.includes("does not exist") ||
          error.message.includes("NoSuchBucket") ||
          error.message.includes("The specified bucket does not exist"))
      ) {
        if (element && (isBucketNode(element) || isPrefixNode(element))) {
          s3Cache.invalidate(element.bucket);
        }

        if (element && isBucketNode(element)) {
          vscode.window
            .showErrorMessage(
              `Bucket "${element.bucket}" no longer exists. Would you like to refresh the bucket list?`,
              "Refresh"
            )
            .then((selection) => {
              if (selection === "Refresh") {
                this.refresh();
              }
            });
          return [];
        }
      }

      if (S3Error.isAuthError(error)) {
        vscode.window
          .showErrorMessage(
            "Authentication failed. Please check your S3 credentials.",
            "Update Credentials"
          )
          .then((selection) => {
            if (selection === "Update Credentials") {
              vscode.commands.executeCommand("r2.configure");
            }
          });
      } else {
        vscode.window.showErrorMessage(`Error loading S3 data: ${message}`);
      }

      return [];
    }
  }

  private getRootNodes(): ExplorerTreeNode[] {
    return [
      new RemoteStorageRootNode("d1"),
      new RemoteStorageRootNode("r2"),
      new RemoteStorageRootNode("kv"),
    ];
  }

  private async getBuckets(): Promise<BucketNode[]> {
    const buckets = await listBuckets();
    return buckets.map((bucket) => createBucketNode(bucket));
  }

  private async getRemoteD1Databases(): Promise<ExplorerTreeNode[]> {
    const hiddenIds = this.getHiddenRemoteD1Ids();
    const databases = (await listRemoteD1Databases()).filter(
      (database) => !hiddenIds.has(database.id)
    );

    if (databases.length === 0) {
      return [
        new RemoteMessageNode(
          "No remote D1 databases found.",
          "Configure Cloudflare Account ID and API token to browse remote D1."
        ),
      ];
    }

    return [
      new RemoteMessageNode("Click a D1 database to open the SQLite visual editor."),
      ...databases.map((database) => new RemoteD1DatabaseNode(database)),
    ];
  }

  private async getRemoteKvNamespaces(): Promise<ExplorerTreeNode[]> {
    const namespaces = await listRemoteKvNamespaces();
    if (namespaces.length === 0) {
      return [
        new RemoteMessageNode(
          "No remote KV namespaces found.",
          "Configure Cloudflare Account ID and API token to browse remote KV."
        ),
      ];
    }

    return namespaces.map((namespace) => new RemoteKvNamespaceNode(namespace));
  }

  private async getBucketContents(
    bucket: string,
    continuationToken?: string
  ): Promise<BaseTreeNode[]> {
    const cached = s3Cache.get(bucket);
    if (cached && !continuationToken) {
      return this.createNodesFromCache(bucket, cached, undefined);
    }

    const result = await listObjects(bucket, undefined, continuationToken);

    if (continuationToken) {
      s3Cache.append(
        bucket,
        result.objects,
        result.prefixes,
        result.isTruncated,
        result.continuationToken
      );
    } else {
      s3Cache.set(
        bucket,
        result.objects,
        result.prefixes,
        result.isTruncated,
        result.continuationToken
      );
    }

    return this.createNodes(bucket, result, undefined);
  }

  private async getPrefixContents(
    bucket: string,
    prefix: string,
    continuationToken?: string
  ): Promise<BaseTreeNode[]> {
    const cached = s3Cache.get(bucket, prefix);
    if (cached && !continuationToken) {
      return this.createNodesFromCache(bucket, cached, prefix);
    }

    const result = await listObjects(bucket, prefix, continuationToken);

    if (continuationToken) {
      s3Cache.append(
        bucket,
        result.objects,
        result.prefixes,
        result.isTruncated,
        result.continuationToken,
        prefix
      );
    } else {
      s3Cache.set(
        bucket,
        result.objects,
        result.prefixes,
        result.isTruncated,
        result.continuationToken,
        prefix
      );
    }

    return this.createNodes(bucket, result, prefix);
  }

  private async getRemoteKvEntries(payload: {
    namespaceId: string;
    namespaceTitle: string;
    prefix?: string;
  }): Promise<ExplorerTreeNode[]> {
    const cacheKey = this.remoteKvCacheKey(payload.namespaceId, payload.prefix);
    const cached = this.remoteKvCache.get(cacheKey);
    if (cached) {
      return this.createRemoteKvNodes(
        payload.namespaceId,
        payload.namespaceTitle,
        payload.prefix,
        cached
      );
    }

    const result = await listRemoteKvEntries({
      namespaceId: payload.namespaceId,
      prefix: payload.prefix,
    });

    const cacheEntry: RemoteKvCacheEntry = {
      prefixes: result.prefixes.map((prefixEntry) => prefixEntry.prefix),
      entries: result.entries,
      cursor: result.cursor,
      isTruncated: result.isTruncated,
      namespaceTitle: payload.namespaceTitle,
    };
    this.remoteKvCache.set(cacheKey, cacheEntry);

    return this.createRemoteKvNodes(
      payload.namespaceId,
      payload.namespaceTitle,
      payload.prefix,
      cacheEntry
    );
  }

  private createNodes(
    bucket: string,
    result: ListObjectsResult,
    prefix?: string
  ): BaseTreeNode[] {
    const nodes: BaseTreeNode[] = [];

    for (const prefixItem of result.prefixes) {
      nodes.push(createPrefixNode(bucket, prefixItem, prefix));
    }

    for (const object of result.objects) {
      nodes.push(createObjectNode(bucket, object, prefix));
    }

    if (result.isTruncated && result.continuationToken) {
      nodes.push(createLoadMoreNode(bucket, result.continuationToken, prefix));
    }

    return nodes;
  }

  private createNodesFromCache(
    bucket: string,
    cached: CacheEntry,
    prefix?: string
  ): BaseTreeNode[] {
    const nodes: BaseTreeNode[] = [];

    for (const prefixItem of cached.prefixes) {
      nodes.push(createPrefixNode(bucket, prefixItem, prefix));
    }

    for (const object of cached.objects) {
      nodes.push(createObjectNode(bucket, object, prefix));
    }

    if (cached.isTruncated && cached.continuationToken) {
      nodes.push(createLoadMoreNode(bucket, cached.continuationToken, prefix));
    }

    return nodes;
  }

  private createRemoteKvNodes(
    namespaceId: string,
    namespaceTitle: string,
    prefix: string | undefined,
    cacheEntry: RemoteKvCacheEntry
  ): ExplorerTreeNode[] {
    const nodes: ExplorerTreeNode[] = [];

    for (const prefixValue of cacheEntry.prefixes) {
      nodes.push(
        new RemoteKvPrefixNode(namespaceId, namespaceTitle, prefixValue, prefix)
      );
    }

    for (const entry of cacheEntry.entries) {
      nodes.push(new RemoteKvEntryNode(namespaceId, namespaceTitle, entry, prefix));
    }

    if (cacheEntry.isTruncated && cacheEntry.cursor) {
      nodes.push(
        new RemoteKvLoadMoreNode(
          namespaceId,
          namespaceTitle,
          cacheEntry.cursor,
          prefix
        )
      );
    }

    if (nodes.length === 0) {
      return [new RemoteMessageNode("No remote KV keys found.")];
    }

    return nodes;
  }

  async loadMore(node: LoadMoreNode): Promise<void> {
    try {
      if (node.prefix) {
        await this.getPrefixContents(node.bucket, node.prefix, node.continuationToken);
      } else {
        await this.getBucketContents(node.bucket, node.continuationToken);
      }

      this._onDidChangeTreeData.fire(undefined);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error loading more items: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }

  async loadMoreRemoteKv(node: RemoteKvLoadMoreNode): Promise<void> {
    try {
      const cacheKey = this.remoteKvCacheKey(node.namespaceId, node.prefix);
      const cached = this.remoteKvCache.get(cacheKey);
      const result = await listRemoteKvEntries({
        namespaceId: node.namespaceId,
        prefix: node.prefix,
        cursor: node.cursor,
      });

      const merged: RemoteKvCacheEntry = {
        namespaceTitle: node.namespaceTitle,
        prefixes: mergeUniqueStrings(
          cached?.prefixes || [],
          result.prefixes.map((item) => item.prefix)
        ),
        entries: mergeUniqueKvEntries(cached?.entries || [], result.entries),
        cursor: result.cursor,
        isTruncated: result.isTruncated,
      };

      this.remoteKvCache.set(cacheKey, merged);
      this._onDidChangeTreeData.fire(undefined);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error loading more KV keys: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }

  async hideRemoteD1Database(databaseId: string): Promise<void> {
    if (!this.store) {
      return;
    }

    const hidden = this.getHiddenRemoteD1Ids();
    hidden.add(databaseId);
    await this.store.update(REMOTE_D1_HIDDEN_KEY, Array.from(hidden));
    this.refresh();
  }

  // Drag and Drop Implementation
  async handleDrag(
    source: readonly ExplorerTreeNode[],
    treeDataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    void token;
    const items = source.filter(isObjectNode);

    if (items.length === 0) {
      return;
    }

    treeDataTransfer.set(
      "application/vnd.code.tree.r2Explorer",
      new vscode.DataTransferItem(items)
    );

    const uris = items
      .map((item) => item.resourceUri?.toString())
      .filter((uri): uri is string => typeof uri === "string" && uri.length > 0);
    treeDataTransfer.set("text/uri-list", new vscode.DataTransferItem(uris.join("\n")));
  }

  async handleDrop(
    target: ExplorerTreeNode | undefined,
    sources: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    void token;
    const fileDropData = sources.get("application/vnd.code.tree.dataTransferKey");
    if (fileDropData) {
      await this.handleExternalFileDrop(target, fileDropData);
      return;
    }

    const internalDropData = sources.get("application/vnd.code.tree.r2Explorer");
    if (internalDropData) {
      await this.handleInternalDrop(target, internalDropData.value as ObjectNode[]);
      return;
    }

    const uriListData = sources.get("text/uri-list");
    if (uriListData) {
      await this.handleUriListDrop(target, String(uriListData.value || ""));
      return;
    }
  }

  private async handleExternalFileDrop(
    target: ExplorerTreeNode | undefined,
    fileData: unknown
  ): Promise<void> {
    void fileData;
    if (!target || (!isBucketNode(target) && !isPrefixNode(target))) {
      vscode.window.showErrorMessage("Can only upload files to buckets or folders");
      return;
    }

    try {
      vscode.window.showInformationMessage(
        "File upload functionality will be implemented in the upload commands"
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Upload failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private async handleInternalDrop(
    target: ExplorerTreeNode | undefined,
    sourceNodes: ObjectNode[]
  ): Promise<void> {
    void sourceNodes;
    if (!target || (!isBucketNode(target) && !isPrefixNode(target))) {
      vscode.window.showErrorMessage(
        "Can only move/copy objects to buckets or folders"
      );
      return;
    }

    const action = await vscode.window.showQuickPick(["Copy", "Move"], {
      placeHolder: "Choose action for selected objects",
    });

    if (!action) {
      return;
    }

    try {
      vscode.window.showInformationMessage(
        `${action} functionality will be implemented in the copy/move commands`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `${action} failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private async handleUriListDrop(
    target: ExplorerTreeNode | undefined,
    uriList: string
  ): Promise<void> {
    const uris = uriList.split("\n").filter((uri) => uri.trim());
    if (uris.length === 0) {
      return;
    }

    if (!target || (!isBucketNode(target) && !isPrefixNode(target))) {
      vscode.window.showErrorMessage("Can only upload to buckets or folders");
      return;
    }

    try {
      vscode.window.showInformationMessage("URI drop functionality will be implemented");
    } catch (error) {
      vscode.window.showErrorMessage(
        `Drop failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  getSelection(): ExplorerTreeNode[] {
    return [];
  }

  async findNode(
    bucket: string,
    key?: string
  ): Promise<BaseTreeNode | undefined> {
    if (!key) {
      const buckets = await this.getBuckets();
      return buckets.find((b) => b.bucket === bucket);
    }

    return undefined;
  }

  private getHiddenRemoteD1Ids(): Set<string> {
    if (!this.store) {
      return new Set();
    }
    const hidden = this.store.get<string[]>(REMOTE_D1_HIDDEN_KEY, []);
    return new Set(hidden.filter((item) => typeof item === "string"));
  }

  private remoteKvCacheKey(namespaceId: string, prefix?: string): string {
    return `${namespaceId}::${prefix || ""}`;
  }

  private clearRemoteKvNamespaceCache(namespaceId: string): void {
    for (const key of this.remoteKvCache.keys()) {
      if (key.startsWith(`${namespaceId}::`)) {
        this.remoteKvCache.delete(key);
      }
    }
  }
}

function isRemoteNode(node?: ExplorerTreeNode): node is RemoteExplorerNode {
  return Boolean(node && (node as { type?: string }).type?.startsWith("remote"));
}

function mergeUniqueStrings(existing: string[], incoming: string[]): string[] {
  const merged = new Set<string>(existing);
  for (const value of incoming) {
    merged.add(value);
  }
  return Array.from(merged).sort((a, b) => a.localeCompare(b));
}

function mergeUniqueKvEntries(
  existing: RemoteKvEntryInfo[],
  incoming: RemoteKvEntryInfo[]
): RemoteKvEntryInfo[] {
  const byKey = new Map<string, RemoteKvEntryInfo>();
  for (const entry of existing) {
    byKey.set(entry.key, entry);
  }
  for (const entry of incoming) {
    byKey.set(entry.key, entry);
  }
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}
