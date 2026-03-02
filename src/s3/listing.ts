import {
  ListBucketsCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { getS3Client, withRetry } from "./client";
import {
  S3Bucket,
  S3Object,
  S3Prefix,
  ListObjectsResult,
  S3Error,
} from "../types";

const MAX_KEYS_PER_REQUEST = 1000;

export async function listBuckets(): Promise<S3Bucket[]> {
  return withRetry(async () => {
    const client = getS3Client();
    const command = new ListBucketsCommand({});

    try {
      const response = await client.send(command);

      return (response.Buckets || []).map((bucket) => ({
        name: bucket.Name!,
        creationDate: bucket.CreationDate,
      }));
    } catch (error: any) {
      throw new S3Error(
        `Failed to list buckets: ${error.message}`,
        error.code,
        error.$metadata?.httpStatusCode,
        S3Error.isRetryable(error)
      );
    }
  });
}

export async function listObjects(
  bucket: string,
  prefix?: string,
  continuationToken?: string,
  maxKeys: number = MAX_KEYS_PER_REQUEST
): Promise<ListObjectsResult> {
  return withRetry(async () => {
    const client = getS3Client();

    const input: ListObjectsV2CommandInput = {
      Bucket: bucket,
      MaxKeys: maxKeys,
      Delimiter: "/", // This groups objects by "folders" (prefixes)
      ContinuationToken: continuationToken,
    };

    if (prefix) {
      input.Prefix = prefix;
    }

    try {
      const response: ListObjectsV2CommandOutput = await client.send(
        new ListObjectsV2Command(input)
      );

      // Parse objects
      const objects: S3Object[] = (response.Contents || [])
        .filter((obj) => obj.Key !== prefix) // Exclude the prefix itself if it exists as an object
        .map((obj) => ({
          key: obj.Key!,
          size: obj.Size,
          lastModified: obj.LastModified,
          etag: obj.ETag,
          storageClass: obj.StorageClass,
        }));

      // Parse prefixes (folders)
      const prefixes: S3Prefix[] = (response.CommonPrefixes || []).map(
        (cp) => ({
          prefix: cp.Prefix!,
        })
      );

      return {
        objects,
        prefixes,
        isTruncated: response.IsTruncated || false,
        continuationToken: response.NextContinuationToken,
      };
    } catch (error: any) {
      if (error.code === "NoSuchBucket") {
        throw new S3Error(
          `Bucket '${bucket}' does not exist`,
          error.code,
          error.$metadata?.httpStatusCode,
          false
        );
      }

      throw new S3Error(
        `Failed to list objects in bucket '${bucket}': ${error.message}`,
        error.code,
        error.$metadata?.httpStatusCode,
        S3Error.isRetryable(error)
      );
    }
  });
}

export async function listAllObjects(
  bucket: string,
  prefix?: string,
  maxObjects?: number
): Promise<S3Object[]> {
  const allObjects: S3Object[] = [];
  let continuationToken: string | undefined;
  let totalFetched = 0;

  do {
    const batchSize = maxObjects
      ? Math.min(MAX_KEYS_PER_REQUEST, maxObjects - totalFetched)
      : MAX_KEYS_PER_REQUEST;

    const result = await listObjects(
      bucket,
      prefix,
      continuationToken,
      batchSize
    );

    allObjects.push(...result.objects);
    totalFetched += result.objects.length;
    continuationToken = result.continuationToken;

    // Stop if we've reached the max objects limit
    if (maxObjects && totalFetched >= maxObjects) {
      break;
    }
  } while (continuationToken);

  return allObjects;
}

export async function searchObjects(
  bucket: string,
  searchPrefix?: string,
  contains?: string,
  maxResults: number = 1000
): Promise<S3Object[]> {
  let allObjects: S3Object[];

  if (searchPrefix) {
    // Use server-side prefix filtering
    allObjects = await listAllObjects(bucket, searchPrefix, maxResults);
  } else {
    // Get all objects in bucket (up to maxResults)
    allObjects = await listAllObjects(bucket, undefined, maxResults);
  }

  // Apply client-side "contains" filter if specified
  if (contains) {
    const lowerContains = contains.toLowerCase();
    allObjects = allObjects.filter((obj) =>
      obj.key.toLowerCase().includes(lowerContains)
    );
  }

  return allObjects;
}

export function getObjectDisplayName(key: string, prefix?: string): string {
  if (prefix && key.startsWith(prefix)) {
    return key.substring(prefix.length);
  }
  return key;
}

export function getPrefixDisplayName(
  prefix: string,
  parentPrefix?: string
): string {
  if (parentPrefix && prefix.startsWith(parentPrefix)) {
    const relativePath = prefix.substring(parentPrefix.length);
    // Remove trailing slash for display
    return relativePath.endsWith("/")
      ? relativePath.slice(0, -1)
      : relativePath;
  }

  // Remove trailing slash for display
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

export function isValidBucketName(name: string): boolean {
  // Basic S3 bucket name validation
  if (name.length < 3 || name.length > 63) {
    return false;
  }

  // Must start and end with lowercase letter or number
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name)) {
    return false;
  }

  // Can only contain lowercase letters, numbers, hyphens, and periods
  if (!/^[a-z0-9.-]+$/.test(name)) {
    return false;
  }

  // Must not contain consecutive periods or period-hyphen combinations
  if (/\.{2,}|(\.-)|(-\.)/.test(name)) {
    return false;
  }

  // Must not look like an IP address
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
    return false;
  }

  return true;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatLastModified(date?: Date): string {
  if (!date) {
    return "";
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "Today";
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
}
