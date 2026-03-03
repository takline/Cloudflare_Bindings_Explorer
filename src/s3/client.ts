import { runS3Action } from "./bindings-client";
import * as vscode from "vscode";
import { S3Config, S3Error } from "../types";

import { getSecret } from "../util/secrets";

export async function getConfig(): Promise<S3Config> {
  const config = vscode.workspace.getConfiguration("r2");
  const accessKeyId = (await getSecret("r2.accessKeyId")) || "";
  const secretAccessKey = (await getSecret("r2.secretAccessKey")) || "";

  return {
    endpointUrl: config.get<string>("endpointUrl", ""),
    region: config.get<string>("region", "auto"),
    accessKeyId,
    secretAccessKey,
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

export function clearClientCache(): void {
  // No-op: configuration is read fresh for each request.
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
