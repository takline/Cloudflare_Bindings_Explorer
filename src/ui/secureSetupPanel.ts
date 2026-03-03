import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { getConfig, validateConfig } from "../s3/client";
import { storeSecret } from "../util/secrets";

interface SecureSetupState {
  endpointUrl: string;
  region: string;
  hasAccessKeyId: boolean;
  hasSecretAccessKey: boolean;
}

interface SecureSetupPayload {
  endpointUrl: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
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
  const state: SecureSetupState = {
    endpointUrl: currentConfig.endpointUrl,
    region: currentConfig.region || "auto",
    hasAccessKeyId: Boolean(currentConfig.accessKeyId),
    hasSecretAccessKey: Boolean(currentConfig.secretAccessKey),
  };

  return new Promise<boolean>((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      "r2SecureSetup",
      "Update R2 Endpoint & Credentials",
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
        await workspaceConfig.update(
          "endpointUrl",
          payload.endpointUrl,
          vscode.ConfigurationTarget.Global
        );
        await workspaceConfig.update(
          "region",
          payload.region || "auto",
          vscode.ConfigurationTarget.Global
        );

        if (payload.accessKeyId) {
          await storeSecret("r2.accessKeyId", payload.accessKeyId);
        }
        if (payload.secretAccessKey) {
          await storeSecret("r2.secretAccessKey", payload.secretAccessKey);
        }

        const updatedConfig = await getConfig();
        const configErrors = validateConfig(updatedConfig);
        if (configErrors.length > 0) {
          await panel.webview.postMessage({
            type: "error",
            message: configErrors.join(", "),
          });
          await panel.webview.postMessage({ type: "saving", value: false });
          return;
        }

        settle(true);
        panel.dispose();
        vscode.window.showInformationMessage(
          "R2 endpoint and credentials were updated securely."
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

function normalizePayload(
  payload: Partial<SecureSetupPayload> | undefined
): SecureSetupPayload {
  return {
    endpointUrl: (payload?.endpointUrl || "").trim(),
    region: ((payload?.region || "").trim() || "auto").trim(),
    accessKeyId: (payload?.accessKeyId || "").trim(),
    secretAccessKey: (payload?.secretAccessKey || "").trim(),
  };
}

function validateSecureSetupPayload(
  payload: SecureSetupPayload,
  currentState: SecureSetupState
): string | undefined {
  if (!payload.endpointUrl) {
    return "Endpoint URL is required.";
  }

  if (!isValidHttpsUrl(payload.endpointUrl)) {
    return "Endpoint URL must be a valid HTTPS URL.";
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

function isValidHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getSecureSetupHtml(state: SecureSetupState): string {
  const nonce = getNonce();
  const endpointUrl = escapeHtml(state.endpointUrl);
  const region = escapeHtml(state.region || "auto");
  const accessKeyPlaceholder = state.hasAccessKeyId
    ? "******** (stored securely)"
    : "Enter Access Key ID";
  const secretKeyPlaceholder = state.hasSecretAccessKey
    ? "******** (stored securely)"
    : "Enter Secret Access Key";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Update R2 Endpoint & Credentials</title>
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
    <h1>Update R2 Endpoint & Credentials</h1>
    <p>
      Credentials are stored in your system keyring and are never shown in
      plaintext. Existing values are shown only as <strong>********</strong>.
    </p>
    <form id="secure-form">
      <div class="field">
        <label for="endpointUrl">Endpoint URL</label>
        <input
          id="endpointUrl"
          type="url"
          value="${endpointUrl}"
          placeholder="https://your-account.r2.cloudflarestorage.com"
          autocomplete="off"
          required
        />
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
      const endpointInput = document.getElementById("endpointUrl");
      const regionInput = document.getElementById("region");
      const accessKeyInput = document.getElementById("accessKeyId");
      const secretKeyInput = document.getElementById("secretAccessKey");

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
            endpointUrl: endpointInput.value,
            region: regionInput.value,
            accessKeyId: accessKeyInput.value,
            secretAccessKey: secretKeyInput.value,
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
