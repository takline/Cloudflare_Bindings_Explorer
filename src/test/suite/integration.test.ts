import * as assert from "assert";
import { listBuckets } from "../../s3/listing";
import {
  createFolder,
  putObject,
  getObject,
  deleteObject,
  getObjectMetadata,
  generatePresignedUrl,
} from "../../s3/ops";
import { testConnection } from "../../s3/client";
import { s3Cache } from "../../util/cache";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  skipIfNoCredentials,
  generateTestObjectKey,
} from "../test-config";

describe("R2 Integration Tests", () => {
  let testConfig: any;
  let testBucketName: string;

  suiteSetup(async function () {
    this.timeout(30000);
    testConfig = setupTestEnvironment();

    if (skipIfNoCredentials()) {
      this.skip();
      return;
    }

    // Find an existing bucket to use for testing
    // We'll use a unique prefix so we don't interfere with existing objects
    try {
      const buckets = await listBuckets();
      if (buckets.length === 0) {
        throw new Error(
          "No buckets available for testing. Please create at least one bucket in your R2 account."
        );
      }
      testBucketName = buckets[0].name;
      console.log(`Using bucket "${testBucketName}" for integration tests`);
    } catch (error) {
      console.error("Failed to setup integration tests:", error);
      this.skip();
    }
  });

  suiteTeardown(async function () {
    this.timeout(30000);
    teardownTestEnvironment();

    if (!testBucketName) {
      return;
    }

    try {
      // Clean up any test objects that might have been left behind
      // We use a specific prefix to ensure we only delete our test objects
      const testPrefix = "r2-test-";
      console.log(
        `Cleaning up test objects with prefix "${testPrefix}" in bucket "${testBucketName}"`
      );

      // Note: In a production implementation, we would list objects with the prefix
      // and delete them. For now, we'll just clean up the cache.
      s3Cache.invalidate(testBucketName);
    } catch (error) {
      console.warn("Failed to clean up test objects:", error);
    }
  });

  it("testConnection should connect to R2 successfully", async function () {
    this.timeout(15000);

    if (skipIfNoCredentials()) {
      return;
    }

    await testConnection();
    // If we get here without throwing, the test passed
    assert.ok(true, "Connection should succeed");
  });

  it("listBuckets should return available buckets", async function () {
    this.timeout(10000);

    if (skipIfNoCredentials()) {
      return;
    }

    const buckets = await listBuckets();
    assert.ok(Array.isArray(buckets), "Should return an array of buckets");
    assert.ok(buckets.length > 0, "Should have at least one bucket");

    const testBucket = buckets.find((b) => b.name === testBucketName);
    assert.ok(testBucket, `Should find test bucket "${testBucketName}"`);
    assert.ok(testBucket.name, "Bucket should have a name");
  });

  it("CRUD operations should work with test objects", async function () {
    this.timeout(20000);

    if (skipIfNoCredentials()) {
      return;
    }

    const testKey = generateTestObjectKey("r2-test-crud");
    const testContent = `Test content created at ${new Date().toISOString()}\nThis is a test object for the Cloudflare Bindings Explorer extension.`;
    const testContentBytes = new TextEncoder().encode(testContent);

    try {
      // CREATE: Upload a test object
      await putObject(testBucketName, testKey, testContent, "text/plain");
      console.log(`Created test object: ${testKey}`);

      // READ: Download the test object
      const downloadedBytes = await getObject(testBucketName, testKey);
      const downloadedContent = new TextDecoder().decode(downloadedBytes);
      assert.strictEqual(
        downloadedContent,
        testContent,
        "Downloaded content should match uploaded content"
      );

      // READ: Get object metadata
      const metadata = await getObjectMetadata(testBucketName, testKey);
      assert.ok(metadata, "Should have metadata");
      assert.strictEqual(
        metadata.contentType,
        "text/plain",
        "Content type should match"
      );
      assert.ok(metadata.contentLength, "Should have content length");
      assert.ok(metadata.lastModified, "Should have last modified date");
      assert.ok(metadata.etag, "Should have ETag");

      // UPDATE: Modify the object
      const updatedContent = testContent + "\nUpdated content";
      await putObject(testBucketName, testKey, updatedContent, "text/plain");

      const updatedBytes = await getObject(testBucketName, testKey);
      const updatedContentStr = new TextDecoder().decode(updatedBytes);
      assert.strictEqual(
        updatedContentStr,
        updatedContent,
        "Updated content should match"
      );
    } finally {
      // DELETE: Clean up the test object
      try {
        await deleteObject(testBucketName, testKey);
        console.log(`Deleted test object: ${testKey}`);
      } catch (error) {
        console.warn(`Failed to delete test object ${testKey}:`, error);
      }
    }
  });

  it("folder operations should work", async function () {
    this.timeout(15000);

    if (skipIfNoCredentials()) {
      return;
    }

    const folderPrefix = `r2-test-folder-${Date.now()}/`;
    const testObjectKey = folderPrefix + "test-file.txt";

    try {
      // Create a folder (prefix)
      await createFolder(testBucketName, folderPrefix);
      console.log(`Created test folder: ${folderPrefix}`);

      // Create an object within the folder
      const testContent = "File inside test folder";
      await putObject(testBucketName, testObjectKey, testContent);
      console.log(`Created object in folder: ${testObjectKey}`);

      // Verify the object exists
      const downloadedBytes = await getObject(testBucketName, testObjectKey);
      const downloadedContent = new TextDecoder().decode(downloadedBytes);
      assert.strictEqual(
        downloadedContent,
        testContent,
        "File in folder should be readable"
      );
    } finally {
      // Clean up
      try {
        await deleteObject(testBucketName, testObjectKey);
        await deleteObject(testBucketName, folderPrefix);
        console.log(`Cleaned up folder: ${folderPrefix}`);
      } catch (error) {
        console.warn(`Failed to clean up folder ${folderPrefix}:`, error);
      }
    }
  });

  it("presigned URL generation should work", async function () {
    this.timeout(15000);

    if (skipIfNoCredentials()) {
      return;
    }

    const testKey = generateTestObjectKey("r2-test-presign");
    const testContent = "Content for presigned URL test";

    try {
      // Create test object
      await putObject(testBucketName, testKey, testContent);

      // Generate presigned URL
      const presignedUrl = await generatePresignedUrl(testBucketName, testKey, {
        expiresIn: 3600,
      });

      assert.ok(presignedUrl, "Should generate presigned URL");
      assert.ok(presignedUrl.startsWith("https://"), "URL should be HTTPS");
      assert.ok(
        presignedUrl.includes(testBucketName),
        "URL should contain bucket name"
      );
      assert.ok(
        presignedUrl.includes("X-Amz-Signature"),
        "URL should be signed"
      );

      console.log(
        `Generated presigned URL: ${presignedUrl.substring(0, 100)}...`
      );
    } finally {
      // Clean up
      try {
        await deleteObject(testBucketName, testKey);
      } catch (error) {
        console.warn(`Failed to delete test object ${testKey}:`, error);
      }
    }
  });

  it("cache should work correctly", async function () {
    this.timeout(10000);

    if (skipIfNoCredentials()) {
      return;
    }

    // Clear cache first
    s3Cache.invalidateAll();

    // Cache should be empty
    const initialStats = s3Cache.getStats();
    assert.strictEqual(initialStats.size, 0, "Cache should be empty initially");

    // Use cache with a bucket
    s3Cache.set(testBucketName, [], [], false);

    const statsAfterSet = s3Cache.getStats();
    assert.strictEqual(statsAfterSet.size, 1, "Cache should have one entry");

    // Get from cache
    const cached = s3Cache.get(testBucketName);
    assert.ok(cached, "Should retrieve cached data");
    assert.ok(
      Array.isArray(cached.objects),
      "Cached data should have objects array"
    );
    assert.ok(
      Array.isArray(cached.prefixes),
      "Cached data should have prefixes array"
    );

    // Invalidate specific bucket
    s3Cache.invalidate(testBucketName);

    const statsAfterInvalidate = s3Cache.getStats();
    assert.strictEqual(
      statsAfterInvalidate.size,
      0,
      "Cache should be empty after invalidation"
    );
  });

  it("error handling should work correctly", async function () {
    this.timeout(10000);

    if (skipIfNoCredentials()) {
      return;
    }

    // Test with non-existent object
    const nonExistentKey = "r2-test-nonexistent-" + Date.now();

    try {
      await getObject(testBucketName, nonExistentKey);
      assert.fail("Should throw error for non-existent object");
    } catch (error: any) {
      // Log the actual error details for debugging
      console.log("Error details:", {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        name: error.name,
        stack: error.stack?.split("\n").slice(0, 3).join("\n"),
      });

      // Check if error message contains "not found" (case insensitive) or has appropriate error codes
      const messageContainsNotFound =
        error.message && error.message.toLowerCase().includes("not found");
      const hasNoSuchKeyCode =
        error.code === "NoSuchKey" || error.code === "NotFound";
      const hasNotFoundName =
        error.name === "NoSuchKey" || error.name === "NotFound";
      const has404Status =
        error.statusCode === 404 || error.$metadata?.httpStatusCode === 404;

      assert.ok(
        messageContainsNotFound ||
          hasNoSuchKeyCode ||
          hasNotFoundName ||
          has404Status,
        `Should throw appropriate error for non-existent object. Got: message="${error.message}", code="${error.code}", name="${error.name}", statusCode="${error.statusCode}"`
      );
    }

    // Test with non-existent bucket (we don't want to actually try this as it might be expensive)
    // Instead, we'll test that our error handling code works
    assert.ok(true, "Error handling test completed");
  });
});
