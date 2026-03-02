import { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import * as vscode from "vscode";
import { S3Config, S3Error } from "../types";

let cachedClient: S3Client | null = null;
let cachedConfig: S3Config | null = null;

export function getConfig(): S3Config {
  const config = vscode.workspace.getConfiguration("s3x");

  return {
    endpointUrl: config.get<string>("endpointUrl", ""),
    region: config.get<string>("region", "us-east-1"),
    accessKeyId: config.get<string>("accessKeyId", ""),
    secretAccessKey: config.get<string>("secretAccessKey", ""),
    forcePathStyle: config.get<boolean>("forcePathStyle", true),
    maxPreviewSizeBytes: config.get<number>("maxPreviewSizeBytes", 10485760),
  };
}

export function validateConfig(config: S3Config): string[] {
  const errors: string[] = [];

  if (!config.endpointUrl) {
    errors.push("Endpoint URL is required");
  }

  if (!config.accessKeyId) {
    errors.push("Access Key ID is required");
  }

  if (!config.secretAccessKey) {
    errors.push("Secret Access Key is required");
  }

  if (config.endpointUrl && !isValidUrl(config.endpointUrl)) {
    errors.push("Endpoint URL must be a valid HTTPS URL");
  }

  return errors;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getS3Client(forceNew = false): S3Client {
  const currentConfig = getConfig();

  // Validate configuration
  const configErrors = validateConfig(currentConfig);
  if (configErrors.length > 0) {
    throw new S3Error(`Configuration invalid: ${configErrors.join(", ")}`);
  }

  // Return cached client if config hasn't changed
  if (
    !forceNew &&
    cachedClient &&
    cachedConfig &&
    configsEqual(currentConfig, cachedConfig)
  ) {
    return cachedClient;
  }

  // Create new client
  const clientConfig: S3ClientConfig = {
    region: currentConfig.region,
    endpoint: currentConfig.endpointUrl,
    forcePathStyle: currentConfig.forcePathStyle,
    credentials: {
      accessKeyId: currentConfig.accessKeyId,
      secretAccessKey: currentConfig.secretAccessKey,
    },
    // Configure for better R2 compatibility
    maxAttempts: 3,
    requestHandler: {
      requestTimeout: 30000, // 30 seconds
      connectionTimeout: 5000, // 5 seconds
    },
  };

  cachedClient = new S3Client(clientConfig);
  cachedConfig = { ...currentConfig };

  return cachedClient;
}

function configsEqual(a: S3Config, b: S3Config): boolean {
  return (
    a.endpointUrl === b.endpointUrl &&
    a.region === b.region &&
    a.accessKeyId === b.accessKeyId &&
    a.secretAccessKey === b.secretAccessKey &&
    a.forcePathStyle === b.forcePathStyle
  );
}

export function clearClientCache(): void {
  if (cachedClient) {
    cachedClient.destroy();
    cachedClient = null;
    cachedConfig = null;
  }
}

export async function testConnection(): Promise<void> {
  const client = getS3Client();

  try {
    // Import here to avoid circular dependencies
    const { ListBucketsCommand } = await import("@aws-sdk/client-s3");
    const response = await client.send(new ListBucketsCommand({}));

    if (!response.Buckets) {
      throw new S3Error("Invalid response from S3 service - no buckets array");
    }
  } catch (error: any) {
    if (S3Error.isAuthError(error)) {
      throw new S3Error(
        "Authentication failed. Please check your access credentials.",
        error.code,
        error.$metadata?.httpStatusCode,
        false
      );
    }

    if (error.code === "NetworkingError" || error.code === "ENOTFOUND") {
      throw new S3Error(
        `Cannot connect to endpoint: ${
          getConfig().endpointUrl
        }. Please verify the URL is correct.`,
        error.code,
        undefined,
        true
      );
    }

    throw new S3Error(
      `Connection test failed: ${error.message}`,
      error.code,
      error.$metadata?.httpStatusCode,
      S3Error.isRetryable(error)
    );
  }
}

// Utility function to handle retries with exponential backoff
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      if (attempt === maxRetries || !S3Error.isRetryable(error)) {
        break;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
