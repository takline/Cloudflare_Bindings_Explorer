import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function storeSecret(name: string, value: string): Promise<void> {
  const b64Name = Buffer.from(name).toString("base64");
  const b64Value = Buffer.from(value).toString("base64");
  const script = `async function run() { const n = Buffer.from("${b64Name}", "base64").toString(); const v = Buffer.from("${b64Value}", "base64").toString(); await Bun.secrets.set({service: "cloudflare-bindings-explorer", name: n, value: v}); } run()`;
  try {
    await execFileAsync("bun", ["-e", script]);
  } catch (error) {
    throw new Error("Failed to store secret via Bun");
  }
}

export async function getSecret(name: string): Promise<string | null> {
  const b64Name = Buffer.from(name).toString("base64");
  const script = `async function run() { const n = Buffer.from("${b64Name}", "base64").toString(); const val = await Bun.secrets.get({service: "cloudflare-bindings-explorer", name: n}); if (val) console.log(Buffer.from(val).toString("base64")); } run()`;
  try {
    const { stdout } = await execFileAsync("bun", ["-e", script]);
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    return Buffer.from(trimmed, "base64").toString();
  } catch (error) {
    return null;
  }
}

export async function deleteSecret(name: string): Promise<void> {
  const b64Name = Buffer.from(name).toString("base64");
  const script = `async function run() { const n = Buffer.from("${b64Name}", "base64").toString(); await Bun.secrets.delete({service: "cloudflare-bindings-explorer", name: n}); } run()`;
  try {
    await execFileAsync("bun", ["-e", script]);
  } catch (error) {
    throw new Error("Failed to delete secret via Bun");
  }
}
