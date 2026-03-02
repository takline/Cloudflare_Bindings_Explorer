import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommandInput,
  PutObjectCommandInput,
  DeleteObjectsCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as vscode from "vscode";
import { getS3Client, withRetry, getConfig } from "./client";
import {
  S3ObjectMetadata,
  S3Error,
  MultipartUpload,
  PresignOptions,
} from "../types";

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const PART_SIZE = 10 * 1024 * 1024; // 10MB

export async function getObject(
  bucket: string,
  key: string
): Promise<Uint8Array> {
  return withRetry(async () => {
    const client = getS3Client();
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });

    try {
      const response = await client.send(command);

      if (!response.Body) {
        throw new S3Error(`Object '${key}' has no content`);
      }

      // Convert stream to Uint8Array using transformToByteArray method
      const byteArray = await response.Body.transformToByteArray();
      return new Uint8Array(byteArray);
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
    const client = getS3Client();

    const body =
      typeof data === "string" ? new TextEncoder().encode(data) : data;

    const input: PutObjectCommandInput = {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || guessContentType(key),
      Metadata: metadata,
    };

    try {
      await client.send(new PutObjectCommand(input));
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
    const client = getS3Client();
    const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });

    try {
      await client.send(command);
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
    const client = getS3Client();

    const input: DeleteObjectsCommandInput = {
      Bucket: bucket,
      Delete: {
        Objects: keys.map((key) => ({ Key: key })),
      },
    };

    try {
      const response = await client.send(new DeleteObjectsCommand(input));

      // Check for errors in the response
      if (response.Errors && response.Errors.length > 0) {
        const errorMessages = response.Errors.map(
          (err) => `${err.Key}: ${err.Message}`
        ).join(", ");
        throw new S3Error(`Some objects failed to delete: ${errorMessages}`);
      }
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
    const client = getS3Client();

    const command = new CopyObjectCommand({
      CopySource: `${sourceBucket}/${sourceKey}`,
      Bucket: targetBucket,
      Key: targetKey,
    });

    try {
      await client.send(command);
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
    const client = getS3Client();
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });

    try {
      const response = await client.send(command);

      return {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        etag: response.ETag,
        storageClass: response.StorageClass,
        serverSideEncryption: response.ServerSideEncryption,
        metadata: response.Metadata,
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
    const client = getS3Client();
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });

    return await getSignedUrl(client, command, {
      expiresIn: options.expiresIn,
    });
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
  const fs = await import("fs");
  const data = await fs.promises.readFile(filePath);

  if (onProgress) {
    onProgress(50);
  }

  await putObject(bucket, key, data, guessContentType(key));

  if (onProgress) {
    onProgress(100);
  }
}

async function uploadFileMultipart(
  bucket: string,
  key: string,
  filePath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const fs = await import("fs");
  const client = getS3Client();
  const stat = await fs.promises.stat(filePath);

  let uploadId: string;
  const parts: Array<{ PartNumber: number; ETag: string }> = [];

  try {
    // Initiate multipart upload
    const createResponse = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: guessContentType(key),
      })
    );

    uploadId = createResponse.UploadId!;

    // Upload parts
    const fileHandle = await fs.promises.open(filePath, "r");
    const totalParts = Math.ceil(stat.size / PART_SIZE);

    try {
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * PART_SIZE;
        const end = Math.min(start + PART_SIZE, stat.size);
        const buffer = Buffer.alloc(end - start);

        await fileHandle.read(buffer, 0, buffer.length, start);

        const uploadPartResponse = await client.send(
          new UploadPartCommand({
            Bucket: bucket,
            Key: key,
            PartNumber: partNumber,
            UploadId: uploadId,
            Body: buffer,
          })
        );

        parts.push({
          PartNumber: partNumber,
          ETag: uploadPartResponse.ETag!,
        });

        if (onProgress) {
          onProgress(Math.round((partNumber / totalParts) * 100));
        }
      }
    } finally {
      await fileHandle.close();
    }

    // Complete multipart upload
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      })
    );
  } catch (error: any) {
    // Abort multipart upload on error
    if (uploadId!) {
      try {
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
          })
        );
      } catch (abortError) {
        // Log but don't throw abort errors
        console.warn("Failed to abort multipart upload:", abortError);
      }
    }

    throw new S3Error(
      `Failed to upload file '${filePath}': ${error.message}`,
      error.code,
      error.$metadata?.httpStatusCode,
      S3Error.isRetryable(error)
    );
  }
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
