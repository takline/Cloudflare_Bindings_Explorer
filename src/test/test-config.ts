import * as vscode from "vscode";

export interface TestConfig {
  endpointUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  testBucketPrefix: string;
}

/**
 * Get test configuration from environment or local settings
 * Uses GitHub secrets in CI, local credentials for development
 */
export function getTestConfig(): TestConfig {
  return {
    endpointUrl: process.env.S3X_ENDPOINT_URL || "",
    accessKeyId: process.env.S3X_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3X_SECRET_ACCESS_KEY || "",
    region: process.env.S3X_REGION || "us-east-1",
    testBucketPrefix: "s3x-test-ci",
  };
}

/**
 * Generate a unique test bucket name that won't conflict with existing buckets
 */
export function generateTestBucketName(prefix: string = "s3x-test"): string {
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
      accessKeyId: testConfig.accessKeyId,
      secretAccessKey: testConfig.secretAccessKey,
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

/**
 * Set up test environment with mock VS Code configuration
 */
export function setupTestEnvironment(): TestConfig {
  const testConfig = getTestConfig();

  // Mock vscode.workspace.getConfiguration
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  (vscode.workspace as any).getConfiguration = (section?: string) => {
    if (section === "s3x") {
      return new MockWorkspaceConfiguration(testConfig);
    }
    return originalGetConfiguration(section);
  };

  return testConfig;
}

/**
 * Clean up test environment
 */
export function teardownTestEnvironment() {
  // Restore original VS Code configuration method if needed
  // This would be implemented if we need to restore mocks
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
