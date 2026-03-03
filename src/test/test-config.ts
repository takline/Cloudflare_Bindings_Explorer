import * as vscode from "vscode";
import { deleteSecret, getSecret, storeSecret } from "../util/secrets";

export interface TestConfig {
  endpointUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  testBucketPrefix: string;
}

/**
 * Get test configuration from environment
 * Uses CI secrets or local shell environment values
 */
export function getTestConfig(): TestConfig {
  return {
    endpointUrl: process.env.R2_ENDPOINT_URL || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    region: process.env.R2_REGION || "auto",
    testBucketPrefix: "r2-test-ci",
  };
}

/**
 * Generate a unique test bucket name that won't conflict with existing buckets
 */
export function generateTestBucketName(prefix: string = "r2-test"): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`.toLowerCase();
}

/**
 * Generate a unique test object key
 */
export function generateTestObjectKey(prefix: string = "test-object"): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}.txt`;
}

/**
 * Mock VS Code configuration for testing
 */
export class MockWorkspaceConfiguration
  implements vscode.WorkspaceConfiguration
{
  private config: { [key: string]: any } = {};

  constructor(testConfig: TestConfig) {
    this.config = {
      endpointUrl: testConfig.endpointUrl,
      // Legacy fields are intentionally set to validate that runtime
      // configuration no longer reads credentials from settings.
      accessKeyId: "legacy-setting-access-key",
      secretAccessKey: "legacy-setting-secret-key",
      region: testConfig.region,
      forcePathStyle: true,
      maxPreviewSizeBytes: 10485760,
    };
  }

  get<T>(section: string, defaultValue?: T): T {
    return this.config[section] ?? defaultValue;
  }

  has(section: string): boolean {
    return section in this.config;
  }

  inspect<T>(section: string):
    | {
        key: string;
        defaultValue?: T;
        globalValue?: T;
        workspaceValue?: T;
        workspaceFolderValue?: T;
      }
    | undefined {
    throw new Error("Method not implemented.");
  }

  update(
    section: string,
    value: any,
    configurationTarget?: vscode.ConfigurationTarget | boolean
  ): Thenable<void> {
    this.config[section] = value;
    return Promise.resolve();
  }

  readonly [key: string]: any;
}

let originalGetConfiguration:
  | typeof vscode.workspace.getConfiguration
  | undefined;
let originalSecrets:
  | { accessKeyId: string | null; secretAccessKey: string | null }
  | undefined;

export async function setSecureCredentials(
  accessKeyId: string,
  secretAccessKey: string
): Promise<void> {
  if (accessKeyId) {
    await storeSecret("r2.accessKeyId", accessKeyId);
  } else {
    await deleteSecret("r2.accessKeyId");
  }

  if (secretAccessKey) {
    await storeSecret("r2.secretAccessKey", secretAccessKey);
  } else {
    await deleteSecret("r2.secretAccessKey");
  }
}

/**
 * Set up test environment with mock VS Code configuration
 */
export async function setupTestEnvironment(): Promise<TestConfig> {
  const testConfig = getTestConfig();

  if (!originalSecrets) {
    originalSecrets = {
      accessKeyId: await getSecret("r2.accessKeyId"),
      secretAccessKey: await getSecret("r2.secretAccessKey"),
    };
  }

  await setSecureCredentials(testConfig.accessKeyId, testConfig.secretAccessKey);

  if (!originalGetConfiguration) {
    originalGetConfiguration = vscode.workspace.getConfiguration.bind(
      vscode.workspace
    );
  }

  // Mock vscode.workspace.getConfiguration
  (vscode.workspace as any).getConfiguration = (section?: string) => {
    if (section === "r2") {
      return new MockWorkspaceConfiguration(testConfig);
    }
    return originalGetConfiguration
      ? originalGetConfiguration(section)
      : vscode.workspace.getConfiguration(section);
  };

  return testConfig;
}

/**
 * Clean up test environment
 */
export async function teardownTestEnvironment() {
  if (originalGetConfiguration) {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  }

  if (originalSecrets) {
    await setSecureCredentials(
      originalSecrets.accessKeyId || "",
      originalSecrets.secretAccessKey || ""
    );
    originalSecrets = undefined;
  }
}

/**
 * Check if we have valid test credentials
 */
export function hasValidTestCredentials(): boolean {
  const config = getTestConfig();
  return !!(config.endpointUrl && config.accessKeyId && config.secretAccessKey);
}

/**
 * Skip test if credentials are not available
 */
export function skipIfNoCredentials() {
  if (!hasValidTestCredentials()) {
    console.log("Skipping test - no R2 credentials available");
    return true;
  }
  return false;
}
