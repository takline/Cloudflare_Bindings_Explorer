import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { LocalWranglerExplorer } from "../../tree/localWranglerExplorer";
import {
  LocalWranglerNode,
  WranglerD1TableNode,
  WranglerKvNamespaceNode,
  WranglerKvPrefixNode,
  WranglerR2BucketNode,
  WranglerRootNode,
  WranglerSqliteRootNode,
} from "../../tree/localWranglerNodes";

type LocalWranglerClientModule = typeof import("../../local-wrangler/client");

const localWranglerClient = require("../../local-wrangler/client") as LocalWranglerClientModule;

const MANUAL_SQLITE_STORAGE_KEY = "cloudflareBindingsExplorer.manualSqliteDatabases";

class InMemoryMemento implements vscode.Memento {
  private readonly state = new Map<string, unknown>();

  keys(): readonly string[] {
    return Array.from(this.state.keys());
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.state.has(key)) {
      return this.state.get(key) as T;
    }
    return defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.state.delete(key);
      return;
    }
    this.state.set(key, value);
  }
}

function nodeLabel(node: LocalWranglerNode): string {
  if (typeof node.label === "string") {
    return node.label;
  }
  return node.label?.label ?? "";
}

describe("Local Wrangler Explorer", () => {
  let store: InMemoryMemento;
  const tempDirs: string[] = [];
  const originalClientFns: Pick<
    LocalWranglerClientModule,
    "listStorageTypes" | "listKvEntries" | "listR2Objects" | "listD1Rows"
  > = {
    listStorageTypes: localWranglerClient.listStorageTypes,
    listKvEntries: localWranglerClient.listKvEntries,
    listR2Objects: localWranglerClient.listR2Objects,
    listD1Rows: localWranglerClient.listD1Rows,
  };

  beforeEach(() => {
    store = new InMemoryMemento();
  });

  afterEach(() => {
    localWranglerClient.listStorageTypes = originalClientFns.listStorageTypes;
    localWranglerClient.listKvEntries = originalClientFns.listKvEntries;
    localWranglerClient.listR2Objects = originalClientFns.listR2Objects;
    localWranglerClient.listD1Rows = originalClientFns.listD1Rows;

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("routes wrangler root nodes through listStorageTypes", async () => {
    const explorer = new LocalWranglerExplorer(store);
    const wranglerPath = "/tmp/.wrangler-state";

    localWranglerClient.listStorageTypes = async (actualWranglerPath: string) => {
      assert.strictEqual(actualWranglerPath, wranglerPath);
      return {
        statePath: "/tmp/.wrangler-state/state/v3",
        types: ["kv", "r2"],
      };
    };

    const children = await explorer.getChildren(
      new WranglerRootNode("wrangler", wranglerPath)
    );

    assert.deepStrictEqual(
      children.map((node) => node.type),
      ["storageType", "storageType"]
    );
  });

  it("routes KV namespace and KV prefix nodes through listKvEntries", async () => {
    const explorer = new LocalWranglerExplorer(store);
    const calls: Array<{
      wranglerDir: string;
      sqlitePath: string;
      blobsPath?: string;
      prefix?: string;
    }> = [];

    localWranglerClient.listKvEntries = async (payload) => {
      calls.push(payload);
      return {
        prefixes: [{ prefix: "docs/" }],
        entries: [{ key: "welcome.txt" }],
      };
    };

    const namespaceNode = new WranglerKvNamespaceNode("/tmp/.wrangler", {
      id: "namespace-1",
      sqlitePath: "/tmp/kv.sqlite",
    });

    const namespaceChildren = await explorer.getChildren(namespaceNode);
    assert.deepStrictEqual(
      namespaceChildren.map((node) => node.type),
      ["kvPrefix", "kvEntry"]
    );
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.prefix, undefined);

    const prefixNode = namespaceChildren[0] as WranglerKvPrefixNode;
    await explorer.getChildren(prefixNode);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1]?.prefix, "docs/");
  });

  it("routes R2 bucket nodes through listR2Objects", async () => {
    const explorer = new LocalWranglerExplorer(store);
    const calls: Array<{ wranglerDir: string; bucket: string; prefix?: string }> = [];

    localWranglerClient.listR2Objects = async (payload) => {
      calls.push(payload);
      return {
        prefixes: [{ prefix: "images/" }],
        objects: [
          {
            key: "logo.png",
            blobId: "blob-1",
            size: 42,
            etag: "etag-1",
            uploaded: 1700000000,
            blobPath: "/tmp/logo.png",
          },
        ],
      };
    };

    const children = await explorer.getChildren(
      new WranglerR2BucketNode("/tmp/.wrangler", "assets")
    );

    assert.deepStrictEqual(
      children.map((node) => node.type),
      ["r2Prefix", "r2Object"]
    );
    assert.deepStrictEqual(calls, [
      {
        wranglerDir: "/tmp/.wrangler",
        bucket: "assets",
        prefix: undefined,
      },
    ]);
  });

  it("routes D1 table nodes through listD1Rows", async () => {
    const explorer = new LocalWranglerExplorer(store);
    const calls: Array<{ sqlitePath: string; table: string }> = [];

    localWranglerClient.listD1Rows = async (payload) => {
      calls.push(payload);
      return {
        rows: [{ rowid: 1, id: 1, name: "Ada" }],
      };
    };

    const children = await explorer.getChildren(
      new WranglerD1TableNode("/tmp/.wrangler", "/tmp/demo.sqlite", {
        name: "users",
        rowCount: 1,
      })
    );

    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0]?.type, "d1Row");
    assert.deepStrictEqual(calls, [
      {
        sqlitePath: "/tmp/demo.sqlite",
        table: "users",
      },
    ]);
  });

  it("returns runtime-not-found message nodes when CLI runtime is unavailable", async () => {
    const explorer = new LocalWranglerExplorer(store);

    localWranglerClient.listStorageTypes = async () => {
      throw new localWranglerClient.LocalWranglerRuntimeNotFoundError();
    };

    const children = await explorer.getChildren(
      new WranglerRootNode("wrangler", "/tmp/.wrangler")
    );

    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0]?.type, "message");
    assert.strictEqual(
      nodeLabel(children[0]!),
      "Local Wrangler runtime is unavailable."
    );
  });

  it("returns error message nodes for unexpected failures", async () => {
    const explorer = new LocalWranglerExplorer(store);

    localWranglerClient.listStorageTypes = async () => {
      throw new Error("boom");
    };

    const children = await explorer.getChildren(
      new WranglerRootNode("wrangler", "/tmp/.wrangler")
    );

    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0]?.type, "message");
    assert.strictEqual(nodeLabel(children[0]!), "Wrangler explorer error: boom");
  });

  it("loads manual sqlite database nodes from workspace state", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wrangler-explorer-test-"));
    tempDirs.push(tempDir);

    const sqlitePath = path.join(tempDir, "manual.sqlite");
    fs.writeFileSync(sqlitePath, "not-a-real-sqlite");

    await store.update(MANUAL_SQLITE_STORAGE_KEY, [
      {
        id: "manual-db",
        label: "Manual DB",
        dbPath: sqlitePath,
        addedAt: new Date().toISOString(),
      },
    ]);

    const explorer = new LocalWranglerExplorer(store);
    const children = await explorer.getChildren(new WranglerSqliteRootNode("SQLite Databases"));

    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0]?.type, "sqliteDatabase");
    assert.strictEqual(nodeLabel(children[0]!), "Manual DB");
  });
});
