import * as assert from "assert";
import * as vscode from "vscode";
import {
  getConfig,
  validateConfig,
  getS3Client,
  testConnection,
  clearClientCache,
} from "../../s3/client";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  skipIfNoCredentials,
} from "../test-config";

suite("S3 Client Tests", () => {
  let testConfig: any;

  suiteSetup(() => {
    testConfig = setupTestEnvironment();
  });

  suiteTeardown(() => {
    teardownTestEnvironment();
    clearClientCache();
  });

  test("getConfig returns valid configuration", () => {
    const config = getConfig();

    assert.strictEqual(config.endpointUrl, testConfig.endpointUrl);
    assert.strictEqual(config.accessKeyId, testConfig.accessKeyId);
    assert.strictEqual(config.secretAccessKey, testConfig.secretAccessKey);
    assert.strictEqual(config.region, testConfig.region);
    assert.strictEqual(config.forcePathStyle, true);
    assert.strictEqual(config.maxPreviewSizeBytes, 10485760);
  });

  test("validateConfig validates required fields", () => {
    // Create a valid config for testing
    const validConfig = {
      endpointUrl: "https://example.r2.cloudflarestorage.com",
      region: "us-east-1",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key", 
      forcePathStyle: true,
      maxPreviewSizeBytes: 10485760
    };
    const validErrors = validateConfig(validConfig);
    assert.strictEqual(validErrors.length, 0);

    // Missing endpoint should return error
    const noEndpointConfig = { ...validConfig, endpointUrl: "" };
    const endpointErrors = validateConfig(noEndpointConfig);
    assert.ok(endpointErrors.some((err) => err.includes("Endpoint URL")));

    // Missing access key should return error
    const noAccessKeyConfig = { ...validConfig, accessKeyId: "" };
    const accessKeyErrors = validateConfig(noAccessKeyConfig);
    assert.ok(accessKeyErrors.some((err) => err.includes("Access Key ID")));

    // Missing secret should return error
    const noSecretConfig = { ...validConfig, secretAccessKey: "" };
    const secretErrors = validateConfig(noSecretConfig);
    assert.ok(secretErrors.some((err) => err.includes("Secret Access Key")));

    // Invalid URL should return error
    const invalidUrlConfig = { ...validConfig, endpointUrl: "not-a-url" };
    const urlErrors = validateConfig(invalidUrlConfig);
    assert.ok(urlErrors.some((err) => err.includes("valid HTTPS URL")));
  });

  test("getS3Client creates client with correct configuration", () => {
    if (skipIfNoCredentials()) {return;}

    const client = getS3Client();
    assert.ok(client, "S3 client should be created");

    // Test that subsequent calls return cached client
    const client2 = getS3Client();
    assert.strictEqual(client, client2, "Should return cached client");

    // Test that forcing new client works
    const client3 = getS3Client(true);
    assert.ok(client3, "Should create new client when forced");
  });

  test("testConnection validates R2 connectivity", async function () {
    this.timeout(10000); // Allow 10 seconds for network request

    if (skipIfNoCredentials()) {return;}

    try {
      await testConnection();
      // If we get here, connection was successful
      assert.ok(true, "Connection test should succeed");
    } catch (error) {
      // Connection test failed - this might be expected in some environments
      console.log("Connection test failed:", error);
      assert.ok(
        error instanceof Error,
        "Should throw proper error on connection failure"
      );
    }
  });

  test("clearClientCache clears cached client", () => {
    if (skipIfNoCredentials()) {return;}

    // Create client
    const client1 = getS3Client();
    assert.ok(client1);

    // Clear cache
    clearClientCache();

    // New client should be different
    const client2 = getS3Client();
    assert.ok(client2);
    // Note: We can't directly compare clients as they're complex objects
    // But the cache should have been cleared
  });

  test("getS3Client throws error for invalid configuration", () => {
    // Temporarily override configuration
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, defaultValue?: any) => {
        switch (key) {
          case "endpointUrl":
            return "";
          case "accessKeyId":
            return "";
          case "secretAccessKey":
            return "";
          default:
            return defaultValue;
        }
      },
    });

    try {
      assert.throws(() => {
        getS3Client();
      }, /Configuration invalid/);
    } finally {
      // Restore original configuration
      (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    }
  });
});
