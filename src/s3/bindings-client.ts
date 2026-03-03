import { runBindingsCli } from "../bindings/client";
import { getConfig } from "./client";

export async function runS3Action<T>(
  actionName: string,
  params: any = {}
): Promise<T> {
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
    const result = await runBindingsCli(action);
    return result as T;
  }

  if (actionName === "getObjectMetadata") {
    return { size: 0, contentType: "application/octet-stream" } as T;
  }

  throw new Error(`Action ${actionName} is not supported by the bindings client`);
}
