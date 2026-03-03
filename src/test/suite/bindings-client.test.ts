import * as assert from "assert";
import {
  mapListEntriesToBuckets,
  mapListEntriesToListObjectsResult,
} from "../../s3/bindings-client";

describe("Bindings Client S3 Mapping", () => {
  it("maps list entries to unique bucket names", () => {
    const result = mapListEntriesToBuckets({
      entries: [
        { path: "/bucket-b/", is_dir: true },
        { path: "bucket-a/", is_dir: true },
        { path: "bucket-b/", is_dir: true },
        { path: "", is_dir: true },
      ],
    });

    assert.deepStrictEqual(result, [{ name: "bucket-a" }, { name: "bucket-b" }]);
  });

  it("maps list entries to object/prefix lists", () => {
    const result = mapListEntriesToListObjectsResult({
      entries: [
        { path: "folder", is_dir: true },
        { path: "folder/", is_dir: true },
        { path: "/file.txt", is_dir: false },
        { path: "file.txt", is_dir: false },
        { path: "", is_dir: false },
      ],
    });

    assert.deepStrictEqual(result.prefixes, [{ prefix: "folder/" }]);
    assert.deepStrictEqual(result.objects, [{ key: "file.txt" }]);
    assert.strictEqual(result.isTruncated, false);
  });
});
