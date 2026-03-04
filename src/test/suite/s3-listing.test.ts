import * as assert from "assert";
import {
  installVscodeModuleMock,
  uninstallVscodeModuleMock,
} from "./test-helpers/mock-vscode";

describe("S3 Listing (Unit)", () => {
  let listing: typeof import("../../s3/listing");
  let bindingsClient: typeof import("../../s3/bindings-client");
  let originalRunS3Action: typeof import("../../s3/bindings-client").runS3Action;

  let runS3ActionCalls: Array<{ actionName: string; params: any }>;

  before(() => {
    installVscodeModuleMock();

    bindingsClient = require("../../s3/bindings-client");
    listing = require("../../s3/listing");
    originalRunS3Action = bindingsClient.runS3Action;
  });

  beforeEach(() => {
    runS3ActionCalls = [];
  });

  afterEach(() => {
    (bindingsClient as any).runS3Action = originalRunS3Action;
  });

  after(() => {
    uninstallVscodeModuleMock();

    for (const moduleId of [
      "../../s3/listing",
      "../../s3/bindings-client",
      "../../s3/client",
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

  it("listBuckets maps SDK response buckets into extension bucket shape", async () => {
    const firstDate = "2025-01-02T03:04:05.000Z";
    const secondDate = "2025-02-03T04:05:06.000Z";

    (bindingsClient as any).runS3Action = async (
      actionName: string,
      params?: any
    ) => {
      runS3ActionCalls.push({ actionName, params });
      return {
        buckets: [
          { name: "alpha", creationDate: firstDate },
          { name: "beta", creationDate: secondDate },
          { name: "gamma" },
        ],
      };
    };

    const buckets = await listing.listBuckets();

    assert.deepStrictEqual(runS3ActionCalls, [
      { actionName: "listBuckets", params: undefined },
    ]);
    assert.strictEqual(buckets.length, 3);
    assert.strictEqual(buckets[0].name, "alpha");
    assert.strictEqual(buckets[0].creationDate?.toISOString(), firstDate);
    assert.strictEqual(buckets[1].name, "beta");
    assert.strictEqual(buckets[1].creationDate?.toISOString(), secondDate);
    assert.strictEqual(buckets[2].name, "gamma");
    assert.strictEqual(buckets[2].creationDate, undefined);
  });

  it("listBuckets wraps failures in S3Error with original details", async () => {
    (bindingsClient as any).runS3Action = async () => {
      const err: any = new Error("request failed");
      err.code = "GatewayTimeout";
      err.$metadata = { httpStatusCode: 504 };
      throw err;
    };

    await assert.rejects(() => listing.listBuckets(), (error: any) => {
      assert.strictEqual(error.name, "S3Error");
      assert.strictEqual(error.message, "Failed to list buckets: request failed");
      assert.strictEqual(error.code, "GatewayTimeout");
      assert.strictEqual(error.statusCode, 504);
      assert.strictEqual(error.retryable, true);
      return true;
    });
  });
});
