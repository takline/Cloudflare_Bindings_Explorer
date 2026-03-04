import { runBindingsCli } from "../bindings/client";
import { logWarn } from "./output";

const sessionSecretCache = new Map<string, string>();

export async function storeSecret(name: string, value: string): Promise<void> {
  sessionSecretCache.set(name, value);

  try {
    await runBindingsCli({
      action: "setSecret",
      name,
      value,
    });

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
      return result.value;
    }

    const cachedValue = sessionSecretCache.get(name);
    if (typeof cachedValue === "string") {
      return cachedValue;
    }
    return null;
  } catch (error) {
    const cachedValue = sessionSecretCache.get(name);
    if (typeof cachedValue === "string") {
      return cachedValue;
    }
    return null;
  }
}

export async function deleteSecret(name: string): Promise<void> {
  sessionSecretCache.delete(name);

  try {
    await runBindingsCli({
      action: "deleteSecret",
      name,
    });
  } catch (error) {
    throw new Error("Failed to delete secret from keyring");
  }
}
