import * as vscode from "vscode";
import { TreeNode, S3Bucket, S3Object, S3Prefix } from "../types";
import {
  formatFileSize,
  formatLastModified,
  getObjectDisplayName,
  getPrefixDisplayName,
} from "../s3/listing";
import {
  createS3xUri,
  getFileName,
  isTextFile,
  isImageFile,
  isVideoFile,
  isAudioFile,
} from "../util/paths";

export abstract class BaseTreeNode extends vscode.TreeItem implements TreeNode {
  abstract readonly type: "bucket" | "prefix" | "object" | "loadMore";
  abstract readonly bucket: string;

  constructor(
    label: string,
    collapsibleState?: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }
}

export class BucketNode extends BaseTreeNode {
  readonly type = "bucket" as const;
  readonly bucket: string;

  constructor(bucket: S3Bucket) {
    super(bucket.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.bucket = bucket.name;
    this.contextValue = "bucket";
    this.iconPath = new vscode.ThemeIcon("database");
    this.tooltip = `Bucket: ${bucket.name}`;

    if (bucket.creationDate) {
      this.description = `Created ${formatLastModified(bucket.creationDate)}`;
    }
  }
}

export class PrefixNode extends BaseTreeNode {
  readonly type = "prefix" as const;
  readonly bucket: string;
  readonly prefix: string;

  constructor(bucket: string, prefix: S3Prefix, parentPrefix?: string) {
    const displayName = getPrefixDisplayName(prefix.prefix, parentPrefix);
    super(displayName, vscode.TreeItemCollapsibleState.Collapsed);

    this.bucket = bucket;
    this.prefix = prefix.prefix;
    this.contextValue = "prefix";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.tooltip = `Folder: ${prefix.prefix}`;
  }
}

export class ObjectNode extends BaseTreeNode {
  readonly type = "object" as const;
  readonly bucket: string;
  readonly key: string;
  readonly size?: number;
  readonly lastModified?: Date;
  readonly etag?: string;

  constructor(bucket: string, object: S3Object, prefix?: string) {
    const displayName = getObjectDisplayName(object.key, prefix);
    super(displayName, vscode.TreeItemCollapsibleState.None);

    this.bucket = bucket;
    this.key = object.key;
    this.size = object.size;
    this.lastModified = object.lastModified;
    this.etag = object.etag;

    this.contextValue = "object";
    this.iconPath = this.getIconForObject(object.key);
    this.resourceUri = vscode.Uri.parse(createS3xUri(bucket, object.key));

    // Set up command to open the object when clicked
    this.command = {
      command: "s3x.openFile",
      title: "Open",
      arguments: [this],
    };

    // Create tooltip with metadata
    this.tooltip = this.createTooltip(object);

    // Set description with size and date
    this.description = this.createDescription(object);
  }

  private getIconForObject(key: string): vscode.ThemeIcon {
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

    if (key.match(/\.(mp4|avi|mov|wmv|flv|webm)$/)) {
      return new vscode.ThemeIcon("play");
    }

    if (key.match(/\.(mp3|wav|flac|aac|ogg)$/)) {
      return new vscode.ThemeIcon("play");
    }

    return new vscode.ThemeIcon("file");
  }

  private createTooltip(object: S3Object): string {
    const parts = [
      `Key: ${object.key}`,
      `Size: ${formatFileSize(object.size)}`,
    ];

    if (object.lastModified) {
      parts.push(`Modified: ${object.lastModified.toLocaleString()}`);
    }

    if (object.etag) {
      parts.push(`ETag: ${object.etag.replace(/"/g, "")}`);
    }

    if (object.storageClass) {
      parts.push(`Storage Class: ${object.storageClass}`);
    }

    return parts.join("\n");
  }

  private createDescription(object: S3Object): string {
    const parts: string[] = [];

    if (object.size !== undefined) {
      parts.push(formatFileSize(object.size));
    }

    if (object.lastModified) {
      parts.push(formatLastModified(object.lastModified));
    }

    return parts.join(" • ");
  }
}

export class LoadMoreNode extends BaseTreeNode {
  readonly type = "loadMore" as const;
  readonly bucket: string;
  readonly prefix?: string;
  readonly continuationToken: string;

  constructor(bucket: string, continuationToken: string, prefix?: string) {
    super("Load more...", vscode.TreeItemCollapsibleState.None);

    this.bucket = bucket;
    this.prefix = prefix;
    this.continuationToken = continuationToken;

    this.contextValue = "loadMore";
    this.iconPath = new vscode.ThemeIcon("ellipsis");
    this.tooltip = "Click to load more objects";

    // Set up command to load more items
    this.command = {
      command: "s3x.loadMore",
      title: "Load More",
      arguments: [this],
    };
  }
}

// Type guards for tree nodes
export function isBucketNode(node: any): node is BucketNode {
  return node && node.type === "bucket";
}

export function isPrefixNode(node: any): node is PrefixNode {
  return node && node.type === "prefix";
}

export function isObjectNode(node: any): node is ObjectNode {
  return node && node.type === "object";
}

export function isLoadMoreNode(node: any): node is LoadMoreNode {
  return node && node.type === "loadMore";
}

// Helper functions to create nodes
export function createBucketNode(bucket: S3Bucket): BucketNode {
  return new BucketNode(bucket);
}

export function createPrefixNode(
  bucket: string,
  prefix: S3Prefix,
  parentPrefix?: string
): PrefixNode {
  return new PrefixNode(bucket, prefix, parentPrefix);
}

export function createObjectNode(
  bucket: string,
  object: S3Object,
  prefix?: string
): ObjectNode {
  return new ObjectNode(bucket, object, prefix);
}

export function createLoadMoreNode(
  bucket: string,
  continuationToken: string,
  prefix?: string
): LoadMoreNode {
  return new LoadMoreNode(bucket, continuationToken, prefix);
}

// Utility to convert tree nodes to simple TreeNode interface
export function toTreeNode(node: BaseTreeNode): TreeNode {
  const base: TreeNode = {
    type: node.type,
    bucket: node.bucket,
  };

  if (isPrefixNode(node)) {
    return { ...base, prefix: node.prefix };
  }

  if (isObjectNode(node)) {
    return {
      ...base,
      key: node.key,
      size: node.size,
      lastModified: node.lastModified,
      etag: node.etag,
    };
  }

  if (isLoadMoreNode(node)) {
    return {
      ...base,
      prefix: node.prefix,
      continuationToken: node.continuationToken,
    };
  }

  return base;
}
