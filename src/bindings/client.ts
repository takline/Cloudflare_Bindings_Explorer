import { execFile } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { logError, logInfo } from "../util/output";

let cliPath: string | null = null;

export function initBindingsCliClient(extensionPath: string): void {
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
  logInfo(`Initialized bindings CLI at: ${cliPath}`);
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
  const actionSummary = summarizeCliAction(action);
  logInfo(`Bindings CLI request: ${actionSummary}`);

  return new Promise((resolve, reject) => {
    const child = execFile(targetCliPath, []);
    let stdoutData = "";
    let stderrData = "";

    child.stdout?.on("data", (data) => (stdoutData += data));
    child.stderr?.on("data", (data) => (stderrData += data));

    child.on("close", (code) => {
      if (code !== 0) {
        logError(
          `Bindings CLI failed (code ${code}) for ${actionSummary}`,
          stderrData.trim()
        );
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
          logError(`Bindings CLI returned error for ${actionSummary}`, result.error);
          reject(new Error(String(result.error)));
          return;
        }
        resolve(result);
      } catch {
        logError(`Bindings CLI returned invalid JSON for ${actionSummary}`, stdoutData);
        reject(new Error(`Failed to parse CLI output: ${stdoutData}`));
      }
    });

    if (child.stdin) {
      child.stdin.write(payload);
      child.stdin.end();
    }
  });
}

function summarizeCliAction(action: unknown): string {
  if (!action || typeof action !== "object") {
    return "unknown action";
  }

  const payload = action as Record<string, unknown>;
  const service = typeof payload.service === "string" ? payload.service : "unknown";
  const type = typeof payload.action === "string" ? payload.action : "unknown";
  const pathValue =
    typeof payload.path === "string" && payload.path.length > 0
      ? ` path=${payload.path}`
      : "";

  return `service=${service} action=${type}${pathValue}`;
}
