import { runBindingsCli } from "../bindings/client";
import { getConfig } from "./client";
import { logError, logInfo } from "../util/output";
import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";

interface CliListEntry {
  path: string;
  is_dir: boolean;
}

interface CliListResult {
  entries: CliListEntry[];
}

interface BucketLike {
  name: string;
}

interface ObjectLike {
  key: string;
}

interface PrefixLike {
  prefix: string;
}

function normalizeEntryPath(path: string | undefined): string {
  if (!path) {
    return "";
  }

  return path.replace(/^\/+/, "").trim();
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

export function mapListEntriesToBuckets(result: CliListResult): BucketLike[] {
  const uniqueBucketNames = new Set<string>();

  for (const entry of result.entries || []) {
    const normalizedPath = normalizeEntryPath(entry.path);
    if (!normalizedPath) {
      continue;
    }

    const bucketName = normalizedPath.replace(/\/+$/, "").split("/")[0];
    if (bucketName) {
      uniqueBucketNames.add(bucketName);
    }
  }

  return Array.from(uniqueBucketNames)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name }));
}

export function mapListEntriesToListObjectsResult(result: CliListResult): {
  objects: ObjectLike[];
  prefixes: PrefixLike[];
  isTruncated: boolean;
} {
  const objects: ObjectLike[] = [];
  const prefixes: PrefixLike[] = [];
  const seenObjects = new Set<string>();
  const seenPrefixes = new Set<string>();

  for (const entry of result.entries || []) {
    const normalizedPath = normalizeEntryPath(entry.path);
    if (!normalizedPath) {
      continue;
    }

    if (entry.is_dir) {
      const prefix = ensureTrailingSlash(normalizedPath);
      if (!seenPrefixes.has(prefix)) {
        seenPrefixes.add(prefix);
        prefixes.push({ prefix });
      }
      continue;
    }

    if (!seenObjects.has(normalizedPath)) {
      seenObjects.add(normalizedPath);
      objects.push({ key: normalizedPath });
    }
  }

  return {
    objects,
    prefixes,
    isTruncated: false,
  };
}

export async function runS3Action<T>(
  actionName: string,
  params: any = {}
): Promise<T> {
  logInfo(`Running S3 action: ${actionName}`);
  const credentials = await getConfig();

  const action: any = {
    service: "s3",
    config: {
      endpoint: credentials.endpointUrl,
      access_key_id: credentials.accessKeyId,
      secret_access_key: credentials.secretAccessKey,
    },
  };

  if (credentials.region) {
    action.config.region = credentials.region;
  }
  if (params.bucket) {
    action.config.bucket = params.bucket;
  }

  if (actionName === "getObject") {
    action.action = "read";
    action.path = params.key;
    const result = await runBindingsCli(action);

    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");

    const tempPath = path.join(os.tmpdir(), `r2-${Date.now()}-${Math.random()}`);
    await fs.promises.writeFile(tempPath, result.content, "utf8");
    return { tempPath } as T;
  }

  if (actionName === "putObject") {
    action.action = "write";
    action.path = params.key;

    if (params.filePath) {
      const fs = await import("fs");
      const data = await fs.promises.readFile(params.filePath);
      action.content = data.toString("utf8");
    } else {
      action.content = Buffer.from(params.b64data, "base64").toString("utf8");
    }

    await runBindingsCli(action);
    return {} as T;
  }

  if (actionName === "deleteObject") {
    action.action = "delete";
    action.path = params.key;
    await runBindingsCli(action);
    return {} as T;
  }

  if (actionName === "deleteObjects") {
    for (const key of params.keys) {
      action.action = "delete";
      action.path = key;
      await runBindingsCli(action);
    }
    return {} as T;
  }

  if (actionName === "listObjects") {
    action.action = "list";
    action.path = params.prefix || "/";
    const result = (await runBindingsCli(action)) as CliListResult;
    return mapListEntriesToListObjectsResult(result) as T;
  }

  if (actionName === "listBuckets") {
    return (await listBucketsWithSdk(credentials)) as T;
  }

  if (actionName === "testConnection") {
    await listBucketsWithSdk(credentials);
    return {} as T;
  }

  if (actionName === "getObjectMetadata") {
    return { size: 0, contentType: "application/octet-stream" } as T;
  }

  const unsupportedMessage = `Action ${actionName} is not supported by the bindings client`;
  logError(unsupportedMessage);
  throw new Error(unsupportedMessage);
}

async function listBucketsWithSdk(credentials: {
  endpointUrl: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}): Promise<{ buckets: BucketLike[] }> {
  const client = new S3Client({
    region: credentials.region || "auto",
    endpoint: credentials.endpointUrl,
    forcePathStyle: credentials.forcePathStyle ?? true,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });

  const result = await client.send(new ListBucketsCommand({}));
  const buckets = (result.Buckets || [])
    .filter((bucket) => typeof bucket?.Name === "string" && bucket.Name.length > 0)
    .map((bucket) => ({
      name: String(bucket.Name),
      creationDate: bucket.CreationDate
        ? bucket.CreationDate.toISOString()
        : undefined,
    }));

  return { buckets };
}
