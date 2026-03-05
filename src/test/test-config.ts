import * as vscode from "vscode";
import { initBindingsCliClient } from "../bindings/client";
import { deleteSecret, getSecret, storeSecret } from "../util/secrets";

export interface TestConfig {
  endpointUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  testBucketPrefix: string;
  testBucketName?: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  remoteD1DatabaseName: string;
  remoteKvNamespaceTitle: string;
}

/**
 * Get test configuration from environment
 * Uses CI secrets or local shell environment values
 */
export function getTestConfig(): TestConfig {
  return {
    endpointUrl: process.env.R2_ENDPOINT_URL || process.env.R2_URL || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    region: process.env.R2_REGION || "auto",
    testBucketPrefix: "r2-test-ci",
    testBucketName: process.env.R2_TEST_BUCKET || process.env.R2_BUCKET,
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || "",
    remoteD1DatabaseName: process.env.CLOUDFLARE_D1_DATABASE || "staging",
    remoteKvNamespaceTitle: process.env.CLOUDFLARE_KV_NAMESPACE || "auth",
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

export class MockCloudflareConfiguration
  implements vscode.WorkspaceConfiguration
{
  private config: { [key: string]: any } = {};

  constructor(testConfig: TestConfig) {
    this.config = {
      accountId: testConfig.cloudflareAccountId,
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
  | {
      accessKeyId: string | null;
      secretAccessKey: string | null;
      cloudflareApiToken: string | null;
    }
  | undefined;
let didInitBindingsCli = false;

function ensureBindingsCliInitialized(): void {
  if (didInitBindingsCli) {
    return;
  }

  initBindingsCliClient(process.cwd());
  didInitBindingsCli = true;
}

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

export async function setCloudflareApiToken(token: string): Promise<void> {
  if (token) {
    await storeSecret("cloudflare.apiToken", token);
  } else {
    await deleteSecret("cloudflare.apiToken");
  }
}

/**
 * Set up test environment with mock VS Code configuration
 */
export async function setupTestEnvironment(): Promise<TestConfig> {
  const testConfig = getTestConfig();
  ensureBindingsCliInitialized();

  if (!originalSecrets) {
    originalSecrets = {
      accessKeyId: await getSecret("r2.accessKeyId"),
      secretAccessKey: await getSecret("r2.secretAccessKey"),
      cloudflareApiToken: await getSecret("cloudflare.apiToken"),
    };
  }

  await setSecureCredentials(testConfig.accessKeyId, testConfig.secretAccessKey);
  await setCloudflareApiToken(testConfig.cloudflareApiToken);

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
    if (section === "cloudflare") {
      return new MockCloudflareConfiguration(testConfig);
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
    await setCloudflareApiToken(originalSecrets.cloudflareApiToken || "");
    originalSecrets = undefined;
  }
}

/**
 * Check if we have valid test credentials
 */
export function hasValidTestCredentials(): boolean {
  const config = getTestConfig();
  return !!(
    config.endpointUrl.trim() &&
    config.accessKeyId.trim() &&
    config.secretAccessKey.trim()
  );
}

export function hasValidRemoteBindingsCredentials(): boolean {
  const config = getTestConfig();
  return !!(
    config.cloudflareAccountId.trim() &&
    config.cloudflareApiToken.trim()
  );
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

/**
 * Throws with a concrete message when live-test credentials are incomplete.
 */
export function assertValidLiveTestConfig(
  config: TestConfig = getTestConfig()
): TestConfig {
  const missing: string[] = [];

  if (!config.endpointUrl.trim()) {
    missing.push("R2_ENDPOINT_URL (or R2_URL)");
  }
  if (!config.accessKeyId.trim()) {
    missing.push("R2_ACCESS_KEY_ID");
  }
  if (!config.secretAccessKey.trim()) {
    missing.push("R2_SECRET_ACCESS_KEY");
  }

  if (missing.length > 0) {
    throw new Error(
      `Live R2 tests require credentials. Missing: ${missing.join(", ")}.`
    );
  }

  return config;
}

export function assertValidRemoteBindingsLiveTestConfig(
  config: TestConfig = getTestConfig()
): TestConfig {
  const missing: string[] = [];

  if (!config.cloudflareAccountId.trim()) {
    missing.push("CLOUDFLARE_ACCOUNT_ID");
  }
  if (!config.cloudflareApiToken.trim()) {
    missing.push("CLOUDFLARE_API_TOKEN");
  }

  if (missing.length > 0) {
    throw new Error(
      `Live remote bindings tests require credentials. Missing: ${missing.join(", ")}.`
    );
  }

  return config;
}
