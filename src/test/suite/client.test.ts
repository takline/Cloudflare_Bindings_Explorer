import * as assert from "assert";
import * as vscode from "vscode";
import {
  getConfig,
  validateConfig,
  testConnection,
  clearClientCache,
} from "../../s3/client";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  skipIfNoCredentials,
} from "../test-config";

describe("S3 Client Tests", () => {
  let testConfig: any;

  suiteSetup(() => {
    testConfig = setupTestEnvironment();
  });

  suiteTeardown(() => {
    teardownTestEnvironment();
    clearClientCache();
  });

  it("getConfig returns valid configuration", async () => {
    const config = await getConfig();

    assert.strictEqual(config.endpointUrl, testConfig.endpointUrl);
    assert.strictEqual(config.accessKeyId, testConfig.accessKeyId);
    assert.strictEqual(config.secretAccessKey, testConfig.secretAccessKey);
    assert.strictEqual(config.region, testConfig.region);
    assert.strictEqual(config.forcePathStyle, true);
    assert.strictEqual(config.maxPreviewSizeBytes, 10485760);
  });

  it("validateConfig validates required fields", () => {
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

    const noEndpointConfig = { ...validConfig, endpointUrl: "" };
    const endpointErrors = validateConfig(noEndpointConfig);
    assert.ok(endpointErrors.some((err) => err.includes("Endpoint URL")));

    const noAccessKeyConfig = { ...validConfig, accessKeyId: "" };
    const accessKeyErrors = validateConfig(noAccessKeyConfig);
    assert.ok(accessKeyErrors.some((err) => err.includes("Access Key ID")));

    const noSecretConfig = { ...validConfig, secretAccessKey: "" };
    const secretErrors = validateConfig(noSecretConfig);
    assert.ok(secretErrors.some((err) => err.includes("Secret Access Key")));

    const invalidUrlConfig = { ...validConfig, endpointUrl: "not-a-url" };
    const urlErrors = validateConfig(invalidUrlConfig);
    assert.ok(urlErrors.some((err) => err.includes("valid HTTPS URL")));
  });

  it("testConnection validates R2 connectivity", async function () {
    this.timeout(10000);

    if (skipIfNoCredentials()) {return;}

    try {
      await testConnection();
      assert.ok(true, "Connection test should succeed");
    } catch (error) {
      console.log("Connection test failed:", error);
      assert.ok(
        error instanceof Error,
        "Should throw proper error on connection failure"
      );
    }
  });
});
