import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { getConfig } from "../s3/client";
import { getSecret, storeSecret } from "../util/secrets";

export interface SecureSetupState {
  userId: string;
  region: string;
  hasAccessKeyId: boolean;
  hasSecretAccessKey: boolean;
  hasApiToken: boolean;
}

export interface SecureSetupPayload {
  userId: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  apiToken: string;
}

type SecureSetupMessage =
  | {
      type: "save";
      payload?: Partial<SecureSetupPayload>;
    }
  | {
      type: "cancel";
    };

export async function openSecureSetupPanel(): Promise<boolean> {
  const currentConfig = await getConfig();
  const cloudflareConfig = vscode.workspace.getConfiguration("cloudflare");
  const cloudflareApiToken = await getSecret("cloudflare.apiToken");
  const configuredAccountId = (
    cloudflareConfig.get<string>("accountId", "") || ""
  ).trim();
  const inferredUserId =
    configuredAccountId ||
    extractUserIdFromEndpoint(currentConfig.endpointUrl) ||
    "";
  const state: SecureSetupState = {
    userId: inferredUserId,
    region: currentConfig.region || "auto",
    hasAccessKeyId: Boolean(currentConfig.accessKeyId),
    hasSecretAccessKey: Boolean(currentConfig.secretAccessKey),
    hasApiToken: Boolean(cloudflareApiToken),
  };

  return new Promise<boolean>((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      "r2SecureSetup",
      "Update R2 Credentials",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    panel.webview.html = getSecureSetupHtml(state);

    let settled = false;
    const settle = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    panel.onDidDispose(() => settle(false));

    panel.webview.onDidReceiveMessage(async (message: SecureSetupMessage) => {
      if (message.type === "cancel") {
        panel.dispose();
        return;
      }

      if (message.type !== "save") {
        return;
      }

      await panel.webview.postMessage({ type: "saving", value: true });

      try {
        const payload = normalizePayload(message.payload);
        const validationError = validateSecureSetupPayload(payload, state);

        if (validationError) {
          await panel.webview.postMessage({
            type: "error",
            message: validationError,
          });
          await panel.webview.postMessage({ type: "saving", value: false });
          return;
        }

        const workspaceConfig = vscode.workspace.getConfiguration("r2");
        const inferredEndpointUrl = inferR2EndpointUrl(payload.userId);
        await workspaceConfig.update(
          "endpointUrl",
          inferredEndpointUrl,
          vscode.ConfigurationTarget.Global
        );
        await workspaceConfig.update(
          "region",
          payload.region || "auto",
          vscode.ConfigurationTarget.Global
        );
        await vscode.workspace
          .getConfiguration("cloudflare")
          .update(
            "accountId",
            payload.userId,
            vscode.ConfigurationTarget.Global
          );

        if (payload.accessKeyId) {
          await storeSecret("r2.accessKeyId", payload.accessKeyId);
        }
        if (payload.secretAccessKey) {
          await storeSecret("r2.secretAccessKey", payload.secretAccessKey);
        }
        if (payload.apiToken) {
          await storeSecret("cloudflare.apiToken", payload.apiToken);
        }

        settle(true);
        panel.dispose();
        vscode.window.showInformationMessage(
          "R2 credentials were updated securely."
        );
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : String(error);
        await panel.webview.postMessage({
          type: "error",
          message: `Failed to save secure configuration: ${messageText}`,
        });
        await panel.webview.postMessage({ type: "saving", value: false });
      }
    });
  });
}

export function normalizePayload(
  payload: Partial<SecureSetupPayload> | undefined
): SecureSetupPayload {
  return {
    userId: (payload?.userId || "").trim(),
    region: ((payload?.region || "").trim() || "auto").trim(),
    accessKeyId: (payload?.accessKeyId || "").trim(),
    secretAccessKey: (payload?.secretAccessKey || "").trim(),
    apiToken: (payload?.apiToken || "").trim(),
  };
}

export function validateSecureSetupPayload(
  payload: SecureSetupPayload,
  currentState: SecureSetupState
): string | undefined {
  if (!payload.userId) {
    return "User ID is required.";
  }

  if (!isValidUserId(payload.userId)) {
    return "User ID must contain only letters, numbers, and hyphens.";
  }

  const hasAccessKeyId = Boolean(payload.accessKeyId) || currentState.hasAccessKeyId;
  const hasSecretAccessKey =
    Boolean(payload.secretAccessKey) || currentState.hasSecretAccessKey;

  if (!hasAccessKeyId) {
    return "Access Key ID is required.";
  }

  if (!hasSecretAccessKey) {
    return "Secret Access Key is required.";
  }

  return undefined;
}

function isValidUserId(userId: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(userId);
}

export function inferR2EndpointUrl(userId: string): string {
  return `https://${userId.toLowerCase()}.r2.cloudflarestorage.com`;
}

function extractUserIdFromEndpoint(endpointUrl: string): string | undefined {
  try {
    const parsed = new URL(endpointUrl);
    if (parsed.protocol !== "https:") {
      return undefined;
    }

    const hostParts = parsed.hostname.split(".");
    if (hostParts.length < 4) {
      return undefined;
    }

    if (hostParts[hostParts.length - 3] !== "r2") {
      return undefined;
    }

    if (hostParts[hostParts.length - 2] !== "cloudflarestorage") {
      return undefined;
    }

    if (hostParts[hostParts.length - 1] !== "com") {
      return undefined;
    }

    const userId = hostParts[0];
    if (!isValidUserId(userId)) {
      return undefined;
    }

    return userId;
  } catch {
    return undefined;
  }
}

function getSecureSetupHtml(state: SecureSetupState): string {
  const nonce = getNonce();
  const userId = escapeHtml(state.userId || "");
  const region = escapeHtml(state.region || "auto");
  const accessKeyPlaceholder = state.hasAccessKeyId
    ? "******** (stored securely)"
    : "Enter Access Key ID";
  const secretKeyPlaceholder = state.hasSecretAccessKey
    ? "******** (stored securely)"
    : "Enter Secret Access Key";
  const apiTokenPlaceholder = state.hasApiToken
    ? "******** (stored securely)"
    : "Enter Cloudflare API Token";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Update R2 Credentials</title>
    <style nonce="${nonce}">
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        margin: 0;
        padding: 20px;
      }
      h1 {
        margin: 0 0 8px 0;
        font-size: 20px;
      }
      p {
        margin: 0 0 18px 0;
        color: var(--vscode-descriptionForeground);
      }
      .field {
        margin-bottom: 14px;
      }
      label {
        display: block;
        font-weight: 600;
        margin-bottom: 6px;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px;
        border-radius: 4px;
        border: 1px solid var(--vscode-input-border, transparent);
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
      }
      .hint {
        margin-top: 6px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .actions {
        margin-top: 18px;
        display: flex;
        gap: 10px;
      }
      button {
        border: none;
        border-radius: 4px;
        padding: 8px 14px;
        cursor: pointer;
      }
      #cancel {
        color: var(--vscode-button-secondaryForeground);
        background: var(--vscode-button-secondaryBackground);
      }
      #save {
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
      }
      #error {
        min-height: 20px;
        color: var(--vscode-errorForeground);
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <h1>Update R2 Credentials</h1>
    <p>
      Credentials are stored in your system keyring and are never shown in
      plaintext. Existing values are shown only as <strong>********</strong>.
      Your User ID is used to infer the R2 endpoint and remote D1/KV account.
    </p>
    <form id="secure-form">
      <div class="field">
        <label for="userId">User ID</label>
        <input
          id="userId"
          type="text"
          value="${userId}"
          placeholder="Cloudflare account/user ID"
          autocomplete="off"
          required
        />
        <div class="hint">
          Endpoint is inferred as <code>https://&lt;userId&gt;.r2.cloudflarestorage.com</code>.
        </div>
      </div>
      <div class="field">
        <label for="region">Region</label>
        <input
          id="region"
          type="text"
          value="${region}"
          placeholder="auto"
          autocomplete="off"
        />
      </div>
      <div class="field">
        <label for="accessKeyId">Access Key ID</label>
        <input
          id="accessKeyId"
          type="password"
          placeholder="${accessKeyPlaceholder}"
          autocomplete="new-password"
        />
        <div class="hint">
          Leave blank to keep the currently stored value.
        </div>
      </div>
      <div class="field">
        <label for="secretAccessKey">Secret Access Key</label>
        <input
          id="secretAccessKey"
          type="password"
          placeholder="${secretKeyPlaceholder}"
          autocomplete="new-password"
        />
        <div class="hint">
          Leave blank to keep the currently stored value.
        </div>
      </div>
      <div class="field">
        <label for="apiToken">Cloudflare API Token (Optional, for D1/KV)</label>
        <input
          id="apiToken"
          type="password"
          placeholder="${apiTokenPlaceholder}"
          autocomplete="new-password"
        />
        <div class="hint">
          Leave blank to keep the currently stored value.
        </div>
      </div>
      <div id="error" role="alert" aria-live="polite"></div>
      <div class="actions">
        <button id="cancel" type="button">Cancel</button>
        <button id="save" type="submit">Save Securely</button>
      </div>
    </form>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const form = document.getElementById("secure-form");
      const saveButton = document.getElementById("save");
      const cancelButton = document.getElementById("cancel");
      const errorElement = document.getElementById("error");
      const userIdInput = document.getElementById("userId");
      const regionInput = document.getElementById("region");
      const accessKeyInput = document.getElementById("accessKeyId");
      const secretKeyInput = document.getElementById("secretAccessKey");
      const apiTokenInput = document.getElementById("apiToken");

      const setSaving = (saving) => {
        saveButton.disabled = saving;
        saveButton.textContent = saving ? "Saving..." : "Save Securely";
      };

      const setError = (message) => {
        errorElement.textContent = message || "";
      };

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        setError("");
        setSaving(true);
        vscode.postMessage({
          type: "save",
          payload: {
            userId: userIdInput.value,
            region: regionInput.value,
            accessKeyId: accessKeyInput.value,
            secretAccessKey: secretKeyInput.value,
            apiToken: apiTokenInput.value,
          },
        });
      });

      cancelButton.addEventListener("click", () => {
        vscode.postMessage({ type: "cancel" });
      });

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || typeof message !== "object") {
          return;
        }

        if (message.type === "error") {
          setSaving(false);
          setError(message.message || "An unknown error occurred.");
          return;
        }

        if (message.type === "saving") {
          setSaving(Boolean(message.value));
        }
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getNonce(): string {
  return randomBytes(16).toString("hex");
}
