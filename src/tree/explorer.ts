import * as vscode from "vscode";
import { listBuckets, listObjects } from "../s3/listing";
import { S3Error } from "../types";
import { s3Cache } from "../util/cache";
import {
  BaseTreeNode,
  BucketNode,
  PrefixNode,
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

export class S3Explorer
  implements
    vscode.TreeDataProvider<BaseTreeNode>,
    vscode.TreeDragAndDropController<BaseTreeNode>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    BaseTreeNode | undefined | null | void
  > = new vscode.EventEmitter<BaseTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    BaseTreeNode | undefined | null | void
  > = this._onDidChangeTreeData.event;

  // Drag and drop support
  dropMimeTypes = ["application/vnd.code.tree.s3xExplorer"];
  dragMimeTypes = ["text/uri-list", "application/vnd.code.tree.s3xExplorer"];

  constructor() {}

  refresh(element?: BaseTreeNode): void {
    if (element) {
      // Invalidate cache for specific element
      if (isBucketNode(element)) {
        s3Cache.invalidate(element.bucket);
      } else if (isPrefixNode(element)) {
        s3Cache.invalidate(element.bucket, element.prefix);
      }
    } else {
      // Clear all cache
      s3Cache.invalidateAll();
    }

    this._onDidChangeTreeData.fire(element);
  }

  getTreeItem(element: BaseTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BaseTreeNode): Promise<BaseTreeNode[]> {
    try {
      if (!element) {
        // Root level - show buckets
        return await this.getBuckets();
      }

      if (isBucketNode(element)) {
        // Show contents of bucket (root level)
        return await this.getBucketContents(element.bucket);
      }

      if (isPrefixNode(element)) {
        // Show contents of prefix
        return await this.getPrefixContents(element.bucket, element.prefix);
      }

      if (isLoadMoreNode(element)) {
        // This shouldn't happen as LoadMore nodes are not expandable
        return [];
      }

      // Objects have no children
      return [];
    } catch (error) {
      console.error("Error getting tree children:", error);

      // Check if this is a "bucket doesn't exist" error
      if (
        error instanceof Error &&
        (error.message.includes("does not exist") ||
          error.message.includes("NoSuchBucket") ||
          error.message.includes("The specified bucket does not exist"))
      ) {
        // Clear cache for this specific bucket if it's a bucket/prefix error
        if (element && (isBucketNode(element) || isPrefixNode(element))) {
          const bucketName = isBucketNode(element)
            ? element.bucket
            : element.bucket;
          console.log(`Clearing cache for non-existent bucket: ${bucketName}`);
          s3Cache.invalidate(bucketName);
        }

        // If this is a bucket node that doesn't exist, suggest refreshing the root
        if (element && isBucketNode(element)) {
          vscode.window
            .showErrorMessage(
              `Bucket "${element.bucket}" no longer exists. Would you like to refresh the bucket list?`,
              "Refresh"
            )
            .then((selection) => {
              if (selection === "Refresh") {
                // Refresh from root to reload bucket list
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
              vscode.commands.executeCommand("s3x.configure");
            }
          });
      } else {
        vscode.window.showErrorMessage(
          `Error loading S3 data: ${
            error instanceof Error ? error.message : error
          }`
        );
      }

      return [];
    }
  }

  private async getBuckets(): Promise<BucketNode[]> {
    const buckets = await listBuckets();
    return buckets.map((bucket) => createBucketNode(bucket));
  }

  private async getBucketContents(
    bucket: string,
    continuationToken?: string
  ): Promise<BaseTreeNode[]> {
    // Check cache first
    const cached = s3Cache.get(bucket);
    if (cached && !continuationToken) {
      return this.createNodesFromCache(bucket, cached, undefined);
    }

    // Fetch from S3
    const result = await listObjects(bucket, undefined, continuationToken);

    if (continuationToken) {
      // Append to cache
      s3Cache.append(
        bucket,
        result.objects,
        result.prefixes,
        result.isTruncated,
        result.continuationToken
      );
    } else {
      // Set new cache
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
    // Check cache first
    const cached = s3Cache.get(bucket, prefix);
    if (cached && !continuationToken) {
      return this.createNodesFromCache(bucket, cached, prefix);
    }

    // Fetch from S3
    const result = await listObjects(bucket, prefix, continuationToken);

    if (continuationToken) {
      // Append to cache
      s3Cache.append(
        bucket,
        result.objects,
        result.prefixes,
        result.isTruncated,
        result.continuationToken,
        prefix
      );
    } else {
      // Set new cache
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

  private createNodes(
    bucket: string,
    result: any,
    prefix?: string
  ): BaseTreeNode[] {
    const nodes: BaseTreeNode[] = [];

    // Add prefix nodes (folders)
    for (const prefixItem of result.prefixes) {
      nodes.push(createPrefixNode(bucket, prefixItem, prefix));
    }

    // Add object nodes (files)
    for (const object of result.objects) {
      nodes.push(createObjectNode(bucket, object, prefix));
    }

    // Add "Load more" node if there are more results
    if (result.isTruncated && result.continuationToken) {
      nodes.push(createLoadMoreNode(bucket, result.continuationToken, prefix));
    }

    return nodes;
  }

  private createNodesFromCache(
    bucket: string,
    cached: any,
    prefix?: string
  ): BaseTreeNode[] {
    const nodes: BaseTreeNode[] = [];

    // Add prefix nodes (folders)
    for (const prefixItem of cached.prefixes) {
      nodes.push(createPrefixNode(bucket, prefixItem, prefix));
    }

    // Add object nodes (files)
    for (const object of cached.objects) {
      nodes.push(createObjectNode(bucket, object, prefix));
    }

    // Add "Load more" node if there are more results
    if (cached.isTruncated && cached.continuationToken) {
      nodes.push(createLoadMoreNode(bucket, cached.continuationToken, prefix));
    }

    return nodes;
  }

  async loadMore(node: LoadMoreNode): Promise<void> {
    try {
      if (node.prefix) {
        await this.getPrefixContents(
          node.bucket,
          node.prefix,
          node.continuationToken
        );
      } else {
        await this.getBucketContents(node.bucket, node.continuationToken);
      }

      // Refresh the parent to show new items
      this._onDidChangeTreeData.fire(undefined);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error loading more items: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }

  // Drag and Drop Implementation
  async handleDrag(
    source: readonly BaseTreeNode[],
    treeDataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const items = source.filter(isObjectNode); // Only allow dragging objects for now

    if (items.length === 0) {
      return;
    }

    // Store the source nodes for internal drag/drop
    treeDataTransfer.set(
      "application/vnd.code.tree.s3xExplorer",
      new vscode.DataTransferItem(items)
    );

    // Also set URI list for external applications
    const uris = items
      .map((item) => item.resourceUri?.toString())
      .filter(Boolean);
    treeDataTransfer.set(
      "text/uri-list",
      new vscode.DataTransferItem(uris.join("\n"))
    );
  }

  async handleDrop(
    target: BaseTreeNode | undefined,
    sources: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Handle external file drops (e.g., from file explorer)
    const fileDropData = sources.get(
      "application/vnd.code.tree.dataTransferKey"
    );
    if (fileDropData) {
      await this.handleExternalFileDrop(target, fileDropData);
      return;
    }

    // Handle internal drag/drop
    const internalDropData = sources.get(
      "application/vnd.code.tree.s3xExplorer"
    );
    if (internalDropData) {
      await this.handleInternalDrop(target, internalDropData.value);
      return;
    }

    // Handle URI list drops
    const uriListData = sources.get("text/uri-list");
    if (uriListData) {
      await this.handleUriListDrop(target, uriListData.value);
      return;
    }
  }

  private async handleExternalFileDrop(
    target: BaseTreeNode | undefined,
    fileData: any
  ): Promise<void> {
    if (!target || (!isBucketNode(target) && !isPrefixNode(target))) {
      vscode.window.showErrorMessage(
        "Can only upload files to buckets or folders"
      );
      return;
    }

    const targetBucket = target.bucket;
    const targetPrefix = isPrefixNode(target) ? target.prefix : "";

    try {
      // TODO: Implement file upload logic
      // This would involve reading the dropped files and uploading them to S3
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
    target: BaseTreeNode | undefined,
    sourceNodes: ObjectNode[]
  ): Promise<void> {
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
      // TODO: Implement copy/move logic using the s3/ops module
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
    target: BaseTreeNode | undefined,
    uriList: string
  ): Promise<void> {
    const uris = uriList.split("\n").filter((uri) => uri.trim());

    if (!target || (!isBucketNode(target) && !isPrefixNode(target))) {
      vscode.window.showErrorMessage("Can only upload to buckets or folders");
      return;
    }

    try {
      // TODO: Handle URI drops (could be local files or other S3 objects)
      vscode.window.showInformationMessage(
        "URI drop functionality will be implemented"
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Drop failed: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  // Public method to get selected nodes (for commands)
  getSelection(): BaseTreeNode[] {
    // This would need to be implemented to track selection
    // For now, return empty array
    return [];
  }

  // Helper method to find a node by its path
  async findNode(
    bucket: string,
    key?: string
  ): Promise<BaseTreeNode | undefined> {
    if (!key) {
      // Looking for bucket
      const buckets = await this.getBuckets();
      return buckets.find((b) => b.bucket === bucket);
    }

    // TODO: Implement path-based node finding
    // This would involve traversing the tree structure
    return undefined;
  }
}
