import { withRetry } from "./client";
import { runS3Action } from "./bindings-client";
import {
  S3ObjectMetadata,
  S3Error,
  PresignOptions,
} from "../types";

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB

export async function getObject(
  bucket: string,
  key: string
): Promise<Uint8Array> {
  return withRetry(async () => {
    try {
      const response = await runS3Action<{ tempPath: string }>("getObject", { bucket, key });
      const fs = await import("fs");
      const data = await fs.promises.readFile(response.tempPath);
      await fs.promises.unlink(response.tempPath).catch(() => {});
      return new Uint8Array(data);
    } catch (error: any) {
      // Check for various "not found" error patterns
      if (
        error.code === "NoSuchKey" ||
        error.code === "NotFound" ||
        error.name === "NoSuchKey" ||
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        throw new S3Error(
          `Object '${key}' not found in bucket '${bucket}'`,
          error.code || error.name || "NoSuchKey",
          error.$metadata?.httpStatusCode,
          false
        );
      }

      throw new S3Error(
        `Failed to get object '${key}': ${error.message}`,
        error.code,
        error.$metadata?.httpStatusCode,
        S3Error.isRetryable(error)
      );
    }
  });
}

export async function getObjectAsText(
  bucket: string,
  key: string
): Promise<string> {
  const data = await getObject(bucket, key);
  return new TextDecoder("utf-8").decode(data);
}

export async function putObject(
  bucket: string,
  key: string,
  data: Uint8Array | string,
  contentType?: string,
  metadata?: Record<string, string>
): Promise<void> {
  return withRetry(async () => {
    try {
      const b64data = typeof data === "string" ? Buffer.from(data).toString('base64') : Buffer.from(data).toString('base64');
      await runS3Action("putObject", { bucket, key, b64data, contentType, metadata });
    } catch (error: any) {
      throw new S3Error(
        `Failed to put object '${key}': ${error.message}`,
        error.code,
        error.$metadata?.httpStatusCode,
        S3Error.isRetryable(error)
      );
    }
  });
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  return withRetry(async () => {
    try {
      await runS3Action("deleteObject", { bucket, key });
    } catch (error: any) {
      throw new S3Error(
        `Failed to delete object '${key}': ${error.message}`,
        error.code,
        error.$metadata?.httpStatusCode,
        S3Error.isRetryable(error)
      );
    }
  });
}

export async function deleteObjects(
  bucket: string,
  keys: string[]
): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  return withRetry(async () => {
    try {
      await runS3Action("deleteObjects", { bucket, keys });
    } catch (error: any) {
      throw new S3Error(
        `Failed to delete objects: ${error.message}`,
        error.code,
        error.$metadata?.httpStatusCode,
        S3Error.isRetryable(error)
      );
    }
  });
}

export async function copyObject(
  sourceBucket: string,
  sourceKey: string,
  targetBucket: string,
  targetKey: string
): Promise<void> {
  return withRetry(async () => {
    try {
      await runS3Action("copyObject", { sourceBucket, sourceKey, targetBucket, targetKey });
    } catch (error: any) {
      throw new S3Error(
        `Failed to copy object from '${sourceBucket}/${sourceKey}' to '${targetBucket}/${targetKey}': ${error.message}`,
        error.code,
        error.$metadata?.httpStatusCode,
        S3Error.isRetryable(error)
      );
    }
  });
}

export async function moveObject(
  sourceBucket: string,
  sourceKey: string,
  targetBucket: string,
  targetKey: string
): Promise<void> {
  // Copy then delete
  await copyObject(sourceBucket, sourceKey, targetBucket, targetKey);
  await deleteObject(sourceBucket, sourceKey);
}

export async function getObjectMetadata(
  bucket: string,
  key: string
): Promise<S3ObjectMetadata> {
  return withRetry(async () => {
    try {
      const response = await runS3Action<any>("getObjectMetadata", { bucket, key });
      return {
        contentType: response.contentType,
        contentLength: response.size,
        lastModified: response.lastModified ? new Date(response.lastModified) : undefined,
        etag: response.etag,
        storageClass: response.storageClass,
        serverSideEncryption: undefined,
        metadata: response.metadata,
      };
    } catch (error: any) {
      // Check for various "not found" error patterns
      if (
        error.code === "NoSuchKey" ||
        error.code === "NotFound" ||
        error.name === "NoSuchKey" ||
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        throw new S3Error(
          `Object '${key}' not found in bucket '${bucket}'`,
          error.code || error.name || "NoSuchKey",
          error.$metadata?.httpStatusCode,
          false
        );
      }

      throw new S3Error(
        `Failed to get metadata for object '${key}': ${error.message}`,
        error.code,
        error.$metadata?.httpStatusCode,
        S3Error.isRetryable(error)
      );
    }
  });
}

export async function generatePresignedUrl(
  bucket: string,
  key: string,
  options: PresignOptions
): Promise<string> {
  try {
    const response = await runS3Action<{ url: string }>("generatePresignedUrl", { bucket, key, expiresIn: options.expiresIn });
    return response.url;
  } catch (error: any) {
    throw new S3Error(
      `Failed to generate presigned URL for '${key}': ${error.message}`,
      error.code,
      error.$metadata?.httpStatusCode,
      false
    );
  }
}

export async function uploadFile(
  bucket: string,
  key: string,
  filePath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const fs = await import("fs");
  const stat = await fs.promises.stat(filePath);

  if (stat.size > MULTIPART_THRESHOLD) {
    return uploadFileMultipart(bucket, key, filePath, onProgress);
  } else {
    return uploadFileSimple(bucket, key, filePath, onProgress);
  }
}

async function uploadFileSimple(
  bucket: string,
  key: string,
  filePath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  if (onProgress) onProgress(50);
  await runS3Action("putObject", { bucket, key, filePath, contentType: guessContentType(key) });
}

async function uploadFileMultipart(
  bucket: string,
  key: string,
  filePath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  // The bindings CLI handles the file read/write path for large uploads.
  if (onProgress) onProgress(10);
  await runS3Action("putObject", { bucket, key, filePath, contentType: guessContentType(key) });
  if (onProgress) onProgress(100);
}

export async function downloadFile(
  bucket: string,
  key: string,
  filePath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const fs = await import("fs");

  if (onProgress) {
    onProgress(10);
  }

  const data = await getObject(bucket, key);

  if (onProgress) {
    onProgress(80);
  }

  await fs.promises.writeFile(filePath, data);

  if (onProgress) {
    onProgress(100);
  }
}

export async function createFolder(
  bucket: string,
  prefix: string
): Promise<void> {
  // Create an empty object with a trailing slash to represent a folder
  const folderKey = prefix.endsWith("/") ? prefix : `${prefix}/`;
  await putObject(
    bucket,
    folderKey,
    new Uint8Array(0),
    "application/x-directory"
  );
}

function guessContentType(key: string): string {
  const ext = key.toLowerCase().split(".").pop();

  const contentTypes: Record<string, string> = {
    txt: "text/plain",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    xml: "application/xml",
    pdf: "application/pdf",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    md: "text/markdown",
    ts: "application/typescript",
    tsx: "application/typescript",
    jsx: "application/javascript",
  };

  return contentTypes[ext || ""] || "application/octet-stream";
}
