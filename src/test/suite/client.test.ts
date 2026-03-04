import * as assert from "assert";
import {
  installVscodeModuleMock,
  resetMockR2Config,
  setMockR2Config,
  uninstallVscodeModuleMock,
} from "./test-helpers/mock-vscode";

describe("S3 Client (Unit)", () => {
  let s3Client: typeof import("../../s3/client");
  let bindingsClient: typeof import("../../s3/bindings-client");
  let secrets: typeof import("../../util/secrets");

  let originalRunS3Action: typeof import("../../s3/bindings-client").runS3Action;
  let originalGetSecret: typeof import("../../util/secrets").getSecret;

  let runS3ActionCalls: Array<{ actionName: string; params: any }>;

  before(() => {
    installVscodeModuleMock();

    bindingsClient = require("../../s3/bindings-client");
    secrets = require("../../util/secrets");
    s3Client = require("../../s3/client");

    originalRunS3Action = bindingsClient.runS3Action;
    originalGetSecret = secrets.getSecret;
  });

  beforeEach(() => {
    runS3ActionCalls = [];
    setMockR2Config({
      endpointUrl: "https://unit-test.r2.example.com",
    });

    (bindingsClient as any).runS3Action = async (
      actionName: string,
      params?: any
    ) => {
      runS3ActionCalls.push({ actionName, params });
      return {};
    };

    (secrets as any).getSecret = async () => null;
  });

  afterEach(() => {
    (bindingsClient as any).runS3Action = originalRunS3Action;
    (secrets as any).getSecret = originalGetSecret;
    resetMockR2Config();
  });

  after(() => {
    uninstallVscodeModuleMock();

    for (const moduleId of [
      "../../s3/client",
      "../../s3/bindings-client",
      "../../util/secrets",
      "../../util/output",
      "../../types",
    ]) {
      try {
        delete require.cache[require.resolve(moduleId)];
      } catch {
        // Ignore missing entries.
      }
    }
  });

  it("validateConfig validates required fields", () => {
    const validConfig: import("../../types").S3Config = {
      endpointUrl: "https://example.r2.cloudflarestorage.com",
      region: "auto",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      forcePathStyle: true,
      maxPreviewSizeBytes: 10485760,
    };

    assert.deepStrictEqual(s3Client.validateConfig(validConfig), []);

    assert.ok(
      s3Client
        .validateConfig({ ...validConfig, endpointUrl: "" })
        .some((err) => err.includes("Endpoint URL"))
    );
    assert.ok(
      s3Client
        .validateConfig({ ...validConfig, accessKeyId: "" })
        .some((err) => err.includes("Access Key ID"))
    );
    assert.ok(
      s3Client
        .validateConfig({ ...validConfig, secretAccessKey: "" })
        .some((err) => err.includes("Secret Access Key"))
    );
    assert.ok(
      s3Client
        .validateConfig({ ...validConfig, endpointUrl: "not-a-url" })
        .some((err) => err.includes("valid HTTPS URL"))
    );
  });

  it("testConnection calls runS3Action with the testConnection action", async () => {
    await s3Client.testConnection();

    assert.deepStrictEqual(runS3ActionCalls, [
      { actionName: "testConnection", params: undefined },
    ]);
  });

  it("testConnection maps auth failures to a user-friendly S3Error", async () => {
    (bindingsClient as any).runS3Action = async () => {
      const err: any = new Error("Forbidden");
      err.code = "Forbidden";
      err.$metadata = { httpStatusCode: 403 };
      throw err;
    };

    await assert.rejects(() => s3Client.testConnection(), (error: any) => {
      assert.strictEqual(error.name, "S3Error");
      assert.strictEqual(
        error.message,
        "Authentication failed. Please check your access credentials."
      );
      assert.strictEqual(error.code, "Forbidden");
      assert.strictEqual(error.statusCode, 403);
      assert.strictEqual(error.retryable, false);
      return true;
    });
  });

  it("testConnection maps ENOTFOUND/network failures with endpoint context", async () => {
    (bindingsClient as any).runS3Action = async () => {
      const err: any = new Error("getaddrinfo ENOTFOUND");
      err.code = "ENOTFOUND";
      throw err;
    };

    setMockR2Config({
      endpointUrl: "https://deterministic-endpoint.r2.example.com",
    });

    await assert.rejects(() => s3Client.testConnection(), (error: any) => {
      assert.strictEqual(error.name, "S3Error");
      assert.strictEqual(
        error.message,
        "Cannot connect to endpoint: https://deterministic-endpoint.r2.example.com. Please verify the URL is correct."
      );
      assert.strictEqual(error.code, "ENOTFOUND");
      assert.strictEqual(error.statusCode, undefined);
      assert.strictEqual(error.retryable, true);
      return true;
    });
  });

  it("testConnection wraps generic errors and preserves retryable metadata", async () => {
    (bindingsClient as any).runS3Action = async () => {
      const err: any = new Error("rate limit");
      err.code = "TooManyRequests";
      err.$metadata = { httpStatusCode: 429 };
      throw err;
    };

    await assert.rejects(() => s3Client.testConnection(), (error: any) => {
      assert.strictEqual(error.name, "S3Error");
      assert.strictEqual(error.message, "Connection test failed: rate limit");
      assert.strictEqual(error.code, "TooManyRequests");
      assert.strictEqual(error.statusCode, 429);
      assert.strictEqual(error.retryable, true);
      return true;
    });
  });
});
