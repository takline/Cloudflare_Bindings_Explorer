import { S3Client } from "bun";
import { AwsClient } from "aws4fetch";

async function readStdin(): Promise<string> {
  let chunks = "";
  for await (const chunk of Bun.stdin.stream()) {
    chunks += new TextDecoder().decode(chunk);
  }
  return chunks;
}

function respond(data: any) {
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
}

function respondError(error: any) {
  process.stdout.write(JSON.stringify({ 
    ok: false, 
    error: error.message || String(error),
    code: error.code || error.name,
    httpStatusCode: error.$metadata?.httpStatusCode || error.status
  }) + "\n");
}

async function main() {
  try {
    const input = await readStdin();
    const payload = JSON.parse(input);

    const { action, credentials, ...params } = payload;
    
    // Default bucket for operations
    const bucket = params.bucket || "dummy-bucket";

    const s3 = new S3Client({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      endpoint: credentials.endpointUrl,
      region: credentials.region || "us-east-1",
      bucket: bucket
    });

    switch (action) {
      case "listBuckets": {
        const aws = new AwsClient({
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          service: "s3",
          region: credentials.region || "us-east-1",
        });
        const url = new URL(credentials.endpointUrl);
        const res = await aws.fetch(url.toString(), { method: "GET" });
        if (!res.ok) {
          throw new Error(`HTTP Error ${res.status}: ${await res.text()}`);
        }
        const text = await res.text();
        
        const buckets = [];
        const regex = /<Bucket><Name>(.*?)<\/Name><CreationDate>(.*?)<\/CreationDate><\/Bucket>/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          buckets.push({
            name: match[1],
            creationDate: new Date(match[2])
          });
        }
        
        respond({ buckets });
        break;
      }
      case "testConnection": {
        const aws = new AwsClient({
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          service: "s3",
          region: credentials.region || "us-east-1",
        });
        const url = new URL(credentials.endpointUrl);
        const res = await aws.fetch(url.toString(), { method: "GET" });
        if (!res.ok) {
          if (res.status === 403 || res.status === 401) {
            throw Object.assign(new Error("Authentication failed"), { code: "AuthError", $metadata: { httpStatusCode: res.status }});
          }
          throw new Error(`HTTP Error ${res.status}: ${await res.text()}`);
        }
        respond({ success: true });
        break;
      }
      case "listObjects": {
        const res = await S3Client.list({
          prefix: params.prefix,
          delimiter: params.delimiter,
          startAfter: params.continuationToken,
          maxKeys: params.maxKeys,
        }, {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          endpoint: credentials.endpointUrl,
          region: credentials.region || "us-east-1",
          bucket: params.bucket
        });
        
        respond({
          objects: (res.contents || []).map((obj: any) => ({
            key: obj.key,
            size: obj.size,
            lastModified: new Date(obj.lastModified),
            etag: obj.etag,
            storageClass: obj.storageClass || "STANDARD"
          })),
          prefixes: (res.commonPrefixes || []).map((p: any) => ({ prefix: p.prefix })),
          isTruncated: res.isTruncated,
          continuationToken: res.isTruncated ? (res.contents?.[res.contents.length - 1]?.key) : undefined
        });
        break;
      }
      case "getObject": {
        const file = s3.file(params.key);
        const tempPath = require('path').join(require('os').tmpdir(), `cbe-${Date.now()}-${Math.random().toString(36).substring(2)}.tmp`);
        const bytes = await file.arrayBuffer();
        await Bun.write(tempPath, bytes);
        respond({ tempPath });
        break;
      }
      case "putObject": {
        let data: string | ArrayBuffer | Blob;
        if (params.filePath) {
          data = Bun.file(params.filePath);
        } else if (params.b64data) {
          data = Buffer.from(params.b64data, 'base64');
        } else {
          data = params.data || "";
        }
        await s3.write(params.key, data, {
          type: params.contentType
        });
        respond({ success: true });
        break;
      }
      case "deleteObject": {
        await s3.file(params.key).delete();
        respond({ success: true });
        break;
      }
      case "deleteObjects": {
        await Promise.all(params.keys.map((k: string) => s3.file(k).delete()));
        respond({ success: true });
        break;
      }
      case "getObjectMetadata": {
        const file = s3.file(params.key);
        const stat = await file.stat();
        respond({
          size: stat.size,
          lastModified: new Date(stat.lastModified),
          contentType: stat.type,
          etag: stat.etag,
          metadata: {},
        });
        break;
      }
      case "generatePresignedUrl": {
        const url = s3.file(params.key).presign({
          method: params.method || "GET",
          expiresIn: params.expiresIn || 3600
        });
        respond({ url });
        break;
      }
      case "copyObject": {
        const aws = new AwsClient({
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          service: "s3",
          region: credentials.region || "us-east-1",
        });
        
        let targetUrlStr = credentials.endpointUrl;
        if (!targetUrlStr.endsWith('/')) targetUrlStr += '/';
        targetUrlStr += `${params.targetBucket}/${params.targetKey}`;
        
        const url = new URL(targetUrlStr);
        const res = await aws.fetch(url.toString(), {
          method: "PUT",
          headers: {
            "x-amz-copy-source": `/${params.sourceBucket}/${params.sourceKey}`
          }
        });
        if (!res.ok) {
          throw new Error(`Failed to copy object: ${await res.text()}`);
        }
        respond({ success: true });
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    respondError(error);
  }
}

main();
