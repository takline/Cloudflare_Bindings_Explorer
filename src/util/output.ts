import * as vscode from "vscode";

const OUTPUT_CHANNEL_NAME = "Cloudflare Bindings Explorer";
let outputChannel: vscode.OutputChannel | undefined;

function timestamp(): string {
  return new Date().toISOString();
}

export function initOutputChannel(
  context?: vscode.ExtensionContext
): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }

  if (context && !context.subscriptions.includes(outputChannel)) {
    context.subscriptions.push(outputChannel);
  }

  return outputChannel;
}

export function getOutputChannel(): vscode.OutputChannel {
  return initOutputChannel();
}

export function showOutputChannel(preserveFocus = false): void {
  getOutputChannel().show(preserveFocus);
}

export function logInfo(message: string): void {
  getOutputChannel().appendLine(`[${timestamp()}] INFO ${message}`);
}

export function logWarn(message: string): void {
  getOutputChannel().appendLine(`[${timestamp()}] WARN ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const details =
    error instanceof Error ? error.stack || error.message : String(error || "");
  getOutputChannel().appendLine(`[${timestamp()}] ERROR ${message}`);
  if (details) {
    getOutputChannel().appendLine(details);
  }
}
