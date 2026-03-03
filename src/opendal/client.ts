import { execFile } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

let cliPath: string | null = null;

export function initOpenDalClient(extensionPath: string): void {
  const releasePath = path.join(
    extensionPath,
    "src-rust",
    "bindings-cli",
    "target",
    "release",
    "bindings-cli"
  );
  const debugPath = path.join(
    extensionPath,
    "src-rust",
    "bindings-cli",
    "target",
    "debug",
    "bindings-cli"
  );

  cliPath = fs.existsSync(releasePath) ? releasePath : debugPath;
}

function ensureCliPath(): string {
  if (!cliPath) {
    throw new Error("Bindings CLI not initialized");
  }
  return cliPath;
}

export async function runBindingsCli(action: unknown): Promise<any> {
  const targetCliPath = ensureCliPath();
  const payload = JSON.stringify(action);

  return new Promise((resolve, reject) => {
    const child = execFile(targetCliPath, []);
    let stdoutData = "";
    let stderrData = "";

    child.stdout?.on("data", (data) => (stdoutData += data));
    child.stderr?.on("data", (data) => (stderrData += data));

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Bindings CLI failed with code ${code}: ${stderrData}`));
        return;
      }

      try {
        const trimmed = stdoutData.trim();
        if (!trimmed) {
          reject(new Error("Bindings CLI returned no output"));
          return;
        }
        const result = JSON.parse(trimmed);
        if (result?.error) {
          reject(new Error(String(result.error)));
          return;
        }
        resolve(result);
      } catch {
        reject(new Error(`Failed to parse CLI output: ${stdoutData}`));
      }
    });

    if (child.stdin) {
      child.stdin.write(payload);
      child.stdin.end();
    }
  });
}

export async function runOpenDal(action: any): Promise<any> {
  return runBindingsCli(action);
}
