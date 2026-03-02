import * as assert from "assert";
import {
  normalizeKey,
  joinPath,
  getParentPrefix,
  getFileName,
  isFolder,
  ensureTrailingSlash,
  removeTrailingSlash,
  createS3xUri,
  parseS3xUri,
  isChildOf,
  getRelativePath,
  getPathSegments,
  getPathDepth,
  generateUniqueKey,
  getFileExtension,
  isTextFile,
  isImageFile,
  isValidS3Key,
  sanitizeS3Key,
} from "../../util/paths";

suite("Path Utilities Tests", () => {
  test("normalizeKey should remove leading slashes", () => {
    assert.strictEqual(normalizeKey("key"), "key");
    assert.strictEqual(normalizeKey("/key"), "key");
    assert.strictEqual(normalizeKey("//key"), "/key");
    assert.strictEqual(normalizeKey("folder/file.txt"), "folder/file.txt");
    assert.strictEqual(normalizeKey("/folder/file.txt"), "folder/file.txt");
  });

  test("joinPath should join path segments correctly", () => {
    assert.strictEqual(joinPath("folder", "file.txt"), "folder/file.txt");
    assert.strictEqual(joinPath("folder/", "file.txt"), "folder/file.txt");
    assert.strictEqual(joinPath("folder", "/file.txt"), "folder/file.txt");
    assert.strictEqual(joinPath("folder/", "/file.txt"), "folder/file.txt");
    assert.strictEqual(joinPath("", "file.txt"), "file.txt");
    assert.strictEqual(joinPath("folder", ""), "folder");
    assert.strictEqual(joinPath("a", "b", "c"), "a/b/c");
  });

  test("getParentPrefix should return parent path", () => {
    assert.strictEqual(getParentPrefix("folder/file.txt"), "folder/");
    assert.strictEqual(
      getParentPrefix("folder/subfolder/file.txt"),
      "folder/subfolder/"
    );
    assert.strictEqual(getParentPrefix("file.txt"), "");
    assert.strictEqual(getParentPrefix("folder/"), "");
    assert.strictEqual(getParentPrefix("/folder/file.txt"), "folder/");
  });

  test("getFileName should extract filename", () => {
    assert.strictEqual(getFileName("file.txt"), "file.txt");
    assert.strictEqual(getFileName("folder/file.txt"), "file.txt");
    assert.strictEqual(getFileName("folder/subfolder/file.txt"), "file.txt");
    assert.strictEqual(getFileName("/folder/file.txt"), "file.txt");
    assert.strictEqual(getFileName("folder/"), "");
  });

  test("isFolder should detect folders", () => {
    assert.strictEqual(isFolder("folder/"), true);
    assert.strictEqual(isFolder("folder/subfolder/"), true);
    assert.strictEqual(isFolder("file.txt"), false);
    assert.strictEqual(isFolder("folder/file.txt"), false);
  });

  test("ensureTrailingSlash should add slash if missing", () => {
    assert.strictEqual(ensureTrailingSlash("folder"), "folder/");
    assert.strictEqual(ensureTrailingSlash("folder/"), "folder/");
    assert.strictEqual(ensureTrailingSlash(""), "/");
  });

  test("removeTrailingSlash should remove slash if present", () => {
    assert.strictEqual(removeTrailingSlash("folder/"), "folder");
    assert.strictEqual(removeTrailingSlash("folder"), "folder");
    assert.strictEqual(removeTrailingSlash("/"), "");
  });

  test("createS3xUri should create valid URIs", () => {
    assert.strictEqual(createS3xUri("bucket"), "s3x://bucket/");
    assert.strictEqual(
      createS3xUri("bucket", "file.txt"),
      "s3x://bucket/file.txt"
    );
    assert.strictEqual(
      createS3xUri("bucket", "/file.txt"),
      "s3x://bucket/file.txt"
    );
    assert.strictEqual(
      createS3xUri("bucket", "folder/file.txt"),
      "s3x://bucket/folder/file.txt"
    );
  });

  test("parseS3xUri should parse URIs correctly", () => {
    const result1 = parseS3xUri("s3x://bucket/file.txt");
    assert.strictEqual(result1.bucket, "bucket");
    assert.strictEqual(result1.key, "file.txt");

    const result2 = parseS3xUri("s3x://bucket/folder/file.txt");
    assert.strictEqual(result2.bucket, "bucket");
    assert.strictEqual(result2.key, "folder/file.txt");

    const result3 = parseS3xUri("s3x://bucket/");
    assert.strictEqual(result3.bucket, "bucket");
    assert.strictEqual(result3.key, "");

    assert.throws(() => parseS3xUri("invalid-uri"), /Invalid S3X URI/);
  });

  test("isChildOf should detect parent-child relationships", () => {
    assert.strictEqual(isChildOf("folder/file.txt", "folder"), true);
    assert.strictEqual(isChildOf("folder/subfolder/file.txt", "folder"), true);
    assert.strictEqual(isChildOf("file.txt", ""), true);
    assert.strictEqual(isChildOf("other/file.txt", "folder"), false);
    assert.strictEqual(isChildOf("file.txt", "folder"), false);
  });

  test("getRelativePath should return relative paths", () => {
    assert.strictEqual(
      getRelativePath("folder/file.txt", "folder"),
      "file.txt"
    );
    assert.strictEqual(
      getRelativePath("folder/subfolder/file.txt", "folder"),
      "subfolder/file.txt"
    );
    assert.strictEqual(getRelativePath("file.txt", ""), "file.txt");
    assert.strictEqual(
      getRelativePath("other/file.txt", "folder"),
      "other/file.txt"
    );
  });

  test("getPathSegments should split paths correctly", () => {
    assert.deepStrictEqual(getPathSegments("folder/file.txt"), [
      "folder",
      "file.txt",
    ]);
    assert.deepStrictEqual(getPathSegments("folder/subfolder/file.txt"), [
      "folder",
      "subfolder",
      "file.txt",
    ]);
    assert.deepStrictEqual(getPathSegments("file.txt"), ["file.txt"]);
    assert.deepStrictEqual(getPathSegments(""), []);
    assert.deepStrictEqual(getPathSegments("/folder/file.txt"), [
      "folder",
      "file.txt",
    ]);
  });

  test("getPathDepth should return correct depth", () => {
    assert.strictEqual(getPathDepth("file.txt"), 1);
    assert.strictEqual(getPathDepth("folder/file.txt"), 2);
    assert.strictEqual(getPathDepth("folder/subfolder/file.txt"), 3);
    assert.strictEqual(getPathDepth(""), 0);
  });

  test("generateUniqueKey should create unique names", () => {
    const existingKeys = ["file.txt", "file (1).txt"];
    const uniqueKey = generateUniqueKey("file.txt", existingKeys);
    assert.strictEqual(uniqueKey, "file (2).txt");

    const uniqueKey2 = generateUniqueKey("document", [
      "document",
      "document (1)",
    ]);
    assert.strictEqual(uniqueKey2, "document (2)");

    const uniqueKey3 = generateUniqueKey("new-file.txt", []);
    assert.strictEqual(uniqueKey3, "new-file.txt");
  });

  test("getFileExtension should extract extensions", () => {
    assert.strictEqual(getFileExtension("file.txt"), "txt");
    assert.strictEqual(getFileExtension("document.pdf"), "pdf");
    assert.strictEqual(getFileExtension("archive.tar.gz"), "gz");
    assert.strictEqual(getFileExtension("folder/file.txt"), "txt");
    assert.strictEqual(getFileExtension("filename"), "");
    assert.strictEqual(getFileExtension(".hidden"), "");
    assert.strictEqual(getFileExtension("file."), "");
  });

  test("isTextFile should identify text files", () => {
    assert.strictEqual(isTextFile("document.txt"), true);
    assert.strictEqual(isTextFile("script.js"), true);
    assert.strictEqual(isTextFile("style.css"), true);
    assert.strictEqual(isTextFile("data.json"), true);
    assert.strictEqual(isTextFile("readme.md"), true);
    assert.strictEqual(isTextFile("image.jpg"), false);
    assert.strictEqual(isTextFile("video.mp4"), false);
    assert.strictEqual(isTextFile("archive.zip"), false);
    assert.strictEqual(isTextFile("unknown"), false);
  });

  test("isImageFile should identify image files", () => {
    assert.strictEqual(isImageFile("photo.jpg"), true);
    assert.strictEqual(isImageFile("image.png"), true);
    assert.strictEqual(isImageFile("icon.gif"), true);
    assert.strictEqual(isImageFile("vector.svg"), true);
    assert.strictEqual(isImageFile("document.txt"), false);
    assert.strictEqual(isImageFile("video.mp4"), false);
    assert.strictEqual(isImageFile("unknown"), false);
  });

  test("isValidS3Key should validate S3 keys", () => {
    assert.strictEqual(isValidS3Key("valid-key.txt"), true);
    assert.strictEqual(isValidS3Key("folder/file.txt"), true);
    assert.strictEqual(isValidS3Key("folder/"), true);
    assert.strictEqual(isValidS3Key("file with spaces.txt"), true);
    assert.strictEqual(
      isValidS3Key("file-with-dashes_and_underscores.txt"),
      true
    );

    assert.strictEqual(isValidS3Key(""), false);
    assert.strictEqual(isValidS3Key("/leading-slash.txt"), false);
    assert.strictEqual(isValidS3Key("double//slash.txt"), false);

    // Test very long key
    const longKey = "a".repeat(1025);
    assert.strictEqual(isValidS3Key(longKey), false);
  });

  test("sanitizeS3Key should fix invalid keys", () => {
    assert.strictEqual(sanitizeS3Key("valid-key.txt"), "valid-key.txt");
    assert.strictEqual(
      sanitizeS3Key("/leading-slash.txt"),
      "leading-slash.txt"
    );
    assert.strictEqual(sanitizeS3Key("double//slash.txt"), "double/slash.txt");
    assert.strictEqual(
      sanitizeS3Key("///multiple///slashes.txt"),
      "multiple/slashes.txt"
    );

    // Test key truncation
    const longKey = "a".repeat(1025);
    const sanitized = sanitizeS3Key(longKey);
    assert.ok(sanitized.length <= 1024);

    // Test key with extension truncation
    const longKeyWithExt = "a".repeat(1020) + ".txt";
    const sanitizedWithExt = sanitizeS3Key(longKeyWithExt);
    assert.ok(sanitizedWithExt.length <= 1024);
    assert.ok(sanitizedWithExt.endsWith(".txt"));
  });
});
