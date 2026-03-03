import { runS3Action } from "./bindings-client";
import * as vscode from "vscode";
import { S3Config, S3Error } from "../types";

let cachedConfig: S3Config | null = null;

import { getSecret } from "../util/secrets";

export async function getConfig(): Promise<S3Config> {
  const config = vscode.workspace.getConfiguration("r2");

  return {
    endpointUrl: config.get<string>("endpointUrl", ""),
    region: config.get<string>("region", "us-east-1"),
    accessKeyId: (await getSecret("r2.accessKeyId")) || config.get<string>("accessKeyId", ""), // Fallback to settings
    secretAccessKey: (await getSecret("r2.secretAccessKey")) || config.get<string>("secretAccessKey", ""), // Fallback to settings
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
  cachedConfig = null;
}

export async function testConnection(): Promise<void> {
  try {
    await runS3Action("testConnection");
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
          (await getConfig()).endpointUrl
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
