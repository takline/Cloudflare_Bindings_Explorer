import { runBindingsCli } from "../bindings/client";

export async function storeSecret(name: string, value: string): Promise<void> {
  try {
    await runBindingsCli({
      action: "setSecret",
      name,
      value,
    });
  } catch (error) {
    throw new Error("Failed to store secret in keyring");
  }
}

export async function getSecret(name: string): Promise<string | null> {
  try {
    const result = await runBindingsCli({
      action: "getSecret",
      name,
    });
    return typeof result?.value === "string" ? result.value : null;
  } catch (error) {
    return null;
  }
}

export async function deleteSecret(name: string): Promise<void> {
  try {
    await runBindingsCli({
      action: "deleteSecret",
      name,
    });
  } catch (error) {
    throw new Error("Failed to delete secret from keyring");
  }
}
