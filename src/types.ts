import * as vscode from "vscode";

export interface S3Config {
  endpointUrl: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  maxPreviewSizeBytes: number;
}

export interface S3Object {
  key: string;
  size?: number;
  lastModified?: Date;
  etag?: string;
  storageClass?: string;
  contentType?: string;
}

export interface S3Bucket {
  name: string;
  creationDate?: Date;
}

export interface S3Prefix {
  prefix: string;
}

export interface ListObjectsResult {
  objects: S3Object[];
  prefixes: S3Prefix[];
  isTruncated: boolean;
  continuationToken?: string;
}

export interface CacheEntry {
  objects: S3Object[];
  prefixes: S3Prefix[];
  lastFetched: number;
  continuationToken?: string;
  isTruncated: boolean;
}

export interface ProgressReporter {
  report(value: { message?: string; increment?: number }): void;
}

export interface BulkOperation {
  type: "delete" | "copy" | "move";
  items: TreeNode[];
  target?: TreeNode;
}

export interface TreeNode {
  readonly type: "bucket" | "prefix" | "object" | "loadMore";
  readonly bucket: string;
  readonly key?: string;
  readonly prefix?: string;
  readonly size?: number;
  readonly lastModified?: Date;
  readonly etag?: string;
  readonly continuationToken?: string;
}

export interface S3ObjectMetadata {
  contentType?: string;
  contentLength?: number;
  lastModified?: Date;
  etag?: string;
  storageClass?: string;
  serverSideEncryption?: string;
  metadata?: Record<string, string>;
}

export interface SearchOptions {
  bucket: string;
  prefix?: string;
  contains?: string;
  maxResults?: number;
}

export interface PresignOptions {
  expiresIn: number; // seconds
}

export interface MultipartUpload {
  uploadId: string;
  bucket: string;
  key: string;
  parts: Array<{
    partNumber: number;
    etag: string;
  }>;
}

export class S3Error extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "S3Error";
  }

  static isAuthError(error: any): boolean {
    return (
      error?.code === "Forbidden" ||
      error?.code === "Unauthorized" ||
      error?.$metadata?.httpStatusCode === 403 ||
      error?.$metadata?.httpStatusCode === 401
    );
  }

  static isRetryable(error: any): boolean {
    return (
      error?.code === "TooManyRequests" ||
      error?.$metadata?.httpStatusCode === 429 ||
      (error?.$metadata?.httpStatusCode >= 500 &&
        error?.$metadata?.httpStatusCode < 600)
    );
  }
}

export interface ExtensionContext {
  subscriptions: vscode.Disposable[];
  workspaceState: vscode.Memento;
  globalState: vscode.Memento;
  extensionPath: string;
}
