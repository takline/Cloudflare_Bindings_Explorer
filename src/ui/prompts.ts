import * as vscode from "vscode";
import { S3Bucket } from "../types";
import { listBuckets } from "../s3/listing";
import { isValidS3Key, sanitizeS3Key, getFileName } from "../util/paths";
import { getConfig, validateConfig } from "../s3/client";
import { storeSecret } from "../util/secrets";

export interface QuickPickBucket extends vscode.QuickPickItem {
  bucket: S3Bucket;
}

export interface QuickPickExpiryOption extends vscode.QuickPickItem {
  seconds: number;
}

export async function showErrorMessage(
  message: string,
  ...actions: string[]
): Promise<string | undefined> {
  return vscode.window.showErrorMessage(message, ...actions);
}

export async function showWarningMessage(
  message: string,
  ...actions: string[]
): Promise<string | undefined> {
  return vscode.window.showWarningMessage(message, ...actions);
}

export async function showInformationMessage(
  message: string,
  ...actions: string[]
): Promise<string | undefined> {
  return vscode.window.showInformationMessage(message, ...actions);
}

export async function promptForBucket(
  placeholder = "Select a bucket"
): Promise<string | undefined> {
  try {
    const buckets = await listBuckets();

    if (buckets.length === 0) {
      showErrorMessage("No buckets found. Please check your S3 configuration.");
      return undefined;
    }

    const quickPickItems: QuickPickBucket[] = buckets.map((bucket) => ({
      label: bucket.name,
      description: bucket.creationDate
        ? `Created ${bucket.creationDate.toLocaleDateString()}`
        : "",
      bucket,
    }));

    const selected = await vscode.window.showQuickPick(quickPickItems, {
      placeHolder: placeholder,
      matchOnDescription: true,
    });

    return selected?.bucket.name;
  } catch (error) {
    showErrorMessage(
      `Failed to load buckets: ${
        error instanceof Error ? error.message : error
      }`
    );
    return undefined;
  }
}

export async function promptForKey(
  title: string,
  placeholder?: string,
  defaultValue?: string,
  validate = true
): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    title,
    placeHolder: placeholder || "Enter object key (path)",
    value: defaultValue,
    validateInput: validate ? validateKeyInput : undefined,
  });

  if (input && validate) {
    return sanitizeS3Key(input);
  }

  return input;
}

export async function promptForFolderName(
  title = "New Folder",
  placeholder = "Enter folder name",
  defaultValue?: string
): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    title,
    placeHolder: placeholder,
    value: defaultValue,
    validateInput: validateFolderName,
  });

  return input;
}

export async function promptForFileName(
  title = "File Name",
  placeholder = "Enter file name",
  defaultValue?: string
): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    title,
    placeHolder: placeholder,
    value: defaultValue,
    validateInput: validateFileName,
  });

  return input;
}

export async function promptForSearchTerm(
  bucket?: string,
  placeholder?: string
): Promise<{ prefix?: string; contains?: string } | undefined> {
  const bucketName =
    bucket || (await promptForBucket("Select bucket to search"));
  if (!bucketName) {
    return undefined;
  }

  const searchType = await vscode.window.showQuickPick(
    [
      {
        label: "Prefix Search",
        description: "Search by object key prefix (server-side, faster)",
        value: "prefix",
      },
      {
        label: "Contains Search",
        description: "Search for keys containing text (client-side)",
        value: "contains",
      },
    ],
    {
      placeHolder: "Choose search type",
    }
  );

  if (!searchType) {
    return undefined;
  }

  const searchTerm = await vscode.window.showInputBox({
    title:
      searchType.value === "prefix" ? "Search by Prefix" : "Search for Text",
    placeHolder:
      placeholder ||
      (searchType.value === "prefix"
        ? "Enter prefix (e.g., folder/subfolder/)"
        : "Enter text to search for in object names"),
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Search term cannot be empty";
      }
      return undefined;
    },
  });

  if (!searchTerm) {
    return undefined;
  }

  return searchType.value === "prefix"
    ? { prefix: searchTerm }
    : { contains: searchTerm };
}

export async function promptForPresignedUrlExpiry(): Promise<
  number | undefined
> {
  const options: QuickPickExpiryOption[] = [
    { label: "15 minutes", seconds: 15 * 60 },
    { label: "1 hour", seconds: 60 * 60 },
    { label: "6 hours", seconds: 6 * 60 * 60 },
    { label: "1 day", seconds: 24 * 60 * 60 },
    { label: "7 days", seconds: 7 * 24 * 60 * 60 },
    { label: "Custom...", seconds: -1 },
  ];

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: "Select URL expiry time",
  });

  if (!selected) {
    return undefined;
  }

  if (selected.seconds === -1) {
    // Custom expiry
    const customInput = await vscode.window.showInputBox({
      title: "Custom Expiry",
      placeHolder: "Enter expiry in seconds (max 604800 = 7 days)",
      validateInput: (value) => {
        const num = parseInt(value);
        if (isNaN(num) || num <= 0) {
          return "Must be a positive number";
        }
        if (num > 604800) {
          return "Maximum expiry is 604800 seconds (7 days)";
        }
        return undefined;
      },
    });

    return customInput ? parseInt(customInput) : undefined;
  }

  return selected.seconds;
}

export async function promptForConfirmation(
  message: string,
  confirmText = "Yes",
  cancelText = "No"
): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    confirmText,
    cancelText
  );

  return choice === confirmText;
}

export async function promptForDestructiveConfirmation(
  action: string,
  itemName: string,
  itemCount = 1
): Promise<boolean> {
  const itemText = itemCount === 1 ? `"${itemName}"` : `${itemCount} items`;

  const message = `Are you sure you want to ${action.toLowerCase()} ${itemText}? This action cannot be undone.`;

  return promptForConfirmation(message, action, "Cancel");
}

export async function promptForMoveOrCopy(): Promise<
  "move" | "copy" | undefined
> {
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "Copy",
        description: "Create a copy at the destination",
        value: "copy",
      },
      {
        label: "Move",
        description: "Move to destination (original will be deleted)",
        value: "move",
      },
    ],
    {
      placeHolder: "Choose action",
    }
  );

  return choice?.value as "move" | "copy" | undefined;
}

export async function promptForCredentials(): Promise<
  { accessKeyId: string; secretAccessKey: string } | undefined
> {
  const accessKeyId = await vscode.window.showInputBox({
    title: "S3 Access Key ID",
    placeHolder: "Enter your S3 Access Key ID",
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Access Key ID is required";
      }
      return undefined;
    },
  });

  if (!accessKeyId) {
    return undefined;
  }

  const secretAccessKey = await vscode.window.showInputBox({
    title: "S3 Secret Access Key",
    placeHolder: "Enter your S3 Secret Access Key",
    password: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Secret Access Key is required";
      }
      return undefined;
    },
  });

  if (!secretAccessKey) {
    return undefined;
  }

  return { accessKeyId, secretAccessKey };
}

export async function promptForEndpoint(): Promise<string | undefined> {
  const endpoint = await vscode.window.showInputBox({
    title: "S3 Endpoint URL",
    placeHolder: "https://your-account.r2.cloudflarestorage.com",
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Endpoint URL is required";
      }

      try {
        const url = new URL(value);
        if (url.protocol !== "https:") {
          return "Endpoint must use HTTPS";
        }
      } catch {
        return "Invalid URL format";
      }

      return undefined;
    },
  });

  return endpoint;
}

export async function promptForConfigurationSetup(): Promise<boolean> {
  if (process.env.R2_TEST_MODE === "1") {
    return false;
  }

  const config = await getConfig();
  const errors = validateConfig(config);

  if (errors.length === 0) {
    return true; // Already configured
  }

  const message = `Cloudflare Bindings Explorer is not configured. Missing: ${errors.join(
    ", "
  )}. Would you like to configure it now?`;

  const choice = await vscode.window.showInformationMessage(
    message,
    "Configure Now",
    "Cancel"
  );

  if (choice !== "Configure Now") {
    return false;
  }

  // Guide through configuration
  let endpoint: string | undefined = config.endpointUrl;
  if (!endpoint) {
    endpoint = await promptForEndpoint();
    if (!endpoint) {return false;}
  }

  let credentials = {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    const newCredentials = await promptForCredentials();
    if (!newCredentials) {return false;}
    credentials = newCredentials;
  }

  // Update configuration
  const workspaceConfig = vscode.workspace.getConfiguration("r2");
  await workspaceConfig.update(
    "endpointUrl",
    endpoint,
    vscode.ConfigurationTarget.Global
  );
  // Store credentials securely via Bun.secrets
  await storeSecret("r2.accessKeyId", credentials.accessKeyId);
  // Clear the hardcoded setting if it exists
  await workspaceConfig.update("accessKeyId", undefined, vscode.ConfigurationTarget.Global);
  await storeSecret("r2.secretAccessKey", credentials.secretAccessKey);
  // Clear the hardcoded setting if it exists
  await workspaceConfig.update("secretAccessKey", undefined, vscode.ConfigurationTarget.Global);

  showInformationMessage("Cloudflare Bindings Explorer has been configured successfully!");
  return true;
}

// Validation functions
function validateKeyInput(value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return "Key cannot be empty";
  }

  if (!isValidS3Key(value)) {
    return "Invalid S3 key format";
  }

  return undefined;
}

function validateFolderName(value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return "Folder name cannot be empty";
  }

  if (value.includes("/")) {
    return "Folder name cannot contain slashes";
  }

  if (!isValidS3Key(value + "/")) {
    return "Invalid folder name";
  }

  return undefined;
}

function validateFileName(value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return "File name cannot be empty";
  }

  if (value.includes("/")) {
    return "File name cannot contain slashes";
  }

  if (!isValidS3Key(value)) {
    return "Invalid file name";
  }

  return undefined;
}

// File picker utilities
export async function showFilePicker(
  options: vscode.OpenDialogOptions = {}
): Promise<vscode.Uri[] | undefined> {
  return vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    ...options,
  });
}

export async function showFolderPicker(
  options: vscode.OpenDialogOptions = {}
): Promise<vscode.Uri[] | undefined> {
  return vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    ...options,
  });
}

export async function showSaveDialog(
  defaultName?: string,
  filters?: { [name: string]: string[] }
): Promise<vscode.Uri | undefined> {
  return vscode.window.showSaveDialog({
    defaultUri: defaultName ? vscode.Uri.file(defaultName) : undefined,
    filters,
  });
}
