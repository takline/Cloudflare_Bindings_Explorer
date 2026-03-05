import * as vscode from "vscode";
import { runBindingsCli } from "../bindings/client";
import { logWarn } from "./output";

const sessionSecretCache = new Map<string, string>();
let fallbackSecretStorage: vscode.SecretStorage | undefined;

export function initSecretStorage(storage: vscode.SecretStorage): void {
  fallbackSecretStorage = storage;
}

async function writeFallbackSecret(name: string, value: string): Promise<void> {
  if (!fallbackSecretStorage) {
    return;
  }
  await fallbackSecretStorage.store(name, value);
}

async function readFallbackSecret(name: string): Promise<string | null> {
  if (!fallbackSecretStorage) {
    return null;
  }
  return (await fallbackSecretStorage.get(name)) || null;
}

async function deleteFallbackSecret(name: string): Promise<void> {
  if (!fallbackSecretStorage) {
    return;
  }
  await fallbackSecretStorage.delete(name);
}

export async function storeSecret(name: string, value: string): Promise<void> {
  sessionSecretCache.set(name, value);
  let keyringWriteSucceeded = false;

  try {
    await runBindingsCli({
      action: "setSecret",
      name,
      value,
    });
    keyringWriteSucceeded = true;

    // Verify read-after-write when available. Some environments report success on
    // write but do not expose a readable keyring backend for subsequent reads.
    const verification = await runBindingsCli({
      action: "getSecret",
      name,
    });
    if (typeof verification?.value !== "string") {
      logWarn(
        `Keyring write for '${name}' could not be read back; using in-memory session secret cache.`
      );
    }
  } catch (error) {
    logWarn(
      `Failed to write keyring secret '${name}', attempting VS Code secure fallback: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    await writeFallbackSecret(name, value);
  } catch (fallbackError) {
    if (!keyringWriteSucceeded) {
      sessionSecretCache.delete(name);
      throw new Error("Failed to store secret in keyring");
    }
    logWarn(
      `Failed to store fallback secret '${name}': ${
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError)
      }`
    );
  }

  if (!keyringWriteSucceeded && !fallbackSecretStorage) {
    sessionSecretCache.delete(name);
    throw new Error("Failed to store secret in keyring");
  }
}

export async function getSecret(name: string): Promise<string | null> {
  try {
    const result = await runBindingsCli({
      action: "getSecret",
      name,
    });
    if (typeof result?.value === "string") {
      sessionSecretCache.set(name, result.value);
      try {
        await writeFallbackSecret(name, result.value);
      } catch {
        // Ignore fallback persistence failures during reads.
      }
      return result.value;
    }
  } catch (error) {
    logWarn(
      `Keyring read failed for '${name}', checking secure fallback storage.`
    );
  }

  const fallbackValue = await readFallbackSecret(name);
  if (typeof fallbackValue === "string") {
    sessionSecretCache.set(name, fallbackValue);
    return fallbackValue;
  }

  const cachedValue = sessionSecretCache.get(name);
  if (typeof cachedValue === "string") {
    return cachedValue;
  }

  return null;
}

export async function deleteSecret(name: string): Promise<void> {
  sessionSecretCache.delete(name);
  let keyringDeleteSucceeded = false;

  try {
    await runBindingsCli({
      action: "deleteSecret",
      name,
    });
    keyringDeleteSucceeded = true;
  } catch (error) {
    logWarn(
      `Failed to delete keyring secret '${name}', attempting fallback delete: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    await deleteFallbackSecret(name);
  } catch (fallbackError) {
    if (!keyringDeleteSucceeded) {
      throw new Error("Failed to delete secret from keyring");
    }
    logWarn(
      `Failed to delete fallback secret '${name}': ${
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError)
      }`
    );
  }

  if (!keyringDeleteSucceeded && !fallbackSecretStorage) {
    throw new Error("Failed to delete secret from keyring");
  }
}
