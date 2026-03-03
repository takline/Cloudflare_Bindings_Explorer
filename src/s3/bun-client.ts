import { runOpenDal } from "../opendal/client";
import { getConfig } from "./client";

export function initBunS3Client(extensionPath: string): void {
  // handled in extension.ts via initOpenDalClient
}

export async function runS3Action<T>(actionName: string, params: any = {}): Promise<T> {
  const credentials = await getConfig();
  
  // map the actionName to OpenDAL actions
  const opendalAction: any = {
      service: "s3",
      config: {
          endpoint: credentials.endpointUrl,
          access_key_id: credentials.accessKeyId,
          secret_access_key: credentials.secretAccessKey,
      }
  };

  if (credentials.region) {
      opendalAction.config.region = credentials.region;
  }
  if (params.bucket) {
      opendalAction.config.bucket = params.bucket;
  }

  if (actionName === "getObject") {
      opendalAction.action = "read";
      opendalAction.path = params.key;
      const res = await runOpenDal(opendalAction);
      
      const fs = await import("fs");
      const os = await import("os");
      const path = await import("path");
      
      const tempPath = path.join(os.tmpdir(), `s3x-${Date.now()}-${Math.random()}`);
      await fs.promises.writeFile(tempPath, res.content, "utf8");
      return { tempPath } as T;
  } 
  else if (actionName === "putObject") {
      opendalAction.action = "write";
      opendalAction.path = params.key;
      
      if (params.filePath) {
          const fs = await import("fs");
          const data = await fs.promises.readFile(params.filePath);
          opendalAction.content = data.toString('utf8'); 
      } else {
          opendalAction.content = Buffer.from(params.b64data, 'base64').toString('utf8');
      }
      
      await runOpenDal(opendalAction);
      return {} as T;
  }
  else if (actionName === "deleteObject") {
      opendalAction.action = "delete";
      opendalAction.path = params.key;
      await runOpenDal(opendalAction);
      return {} as T;
  }
  else if (actionName === "deleteObjects") {
      for (const key of params.keys) {
          opendalAction.action = "delete";
          opendalAction.path = key;
          await runOpenDal(opendalAction);
      }
      return {} as T;
  }
  else if (actionName === "listObjects") {
      opendalAction.action = "list";
      opendalAction.path = params.prefix || "/";
      const res = await runOpenDal(opendalAction);
      return res as T;
  }
  else if (actionName === "getObjectMetadata") {
      return { size: 0, contentType: "application/octet-stream" } as T;
  }
  else {
      throw new Error(`Action ${actionName} not supported in OpenDAL refactor`);
  }
}
