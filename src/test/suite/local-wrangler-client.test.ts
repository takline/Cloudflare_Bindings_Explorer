import * as assert from "assert";

type RunBindingsCli = (action: unknown) => Promise<unknown>;

const bindingsClient = require("../../bindings/client") as {
  runBindingsCli: RunBindingsCli;
};
const localWranglerClient = require("../../local-wrangler/client") as typeof import("../../local-wrangler/client");

describe("Local Wrangler Client", () => {
  let originalRunBindingsCli: RunBindingsCli;

  beforeEach(() => {
    originalRunBindingsCli = bindingsClient.runBindingsCli;
  });

  afterEach(() => {
    bindingsClient.runBindingsCli = originalRunBindingsCli;
  });

  function stubRunBindingsCli(impl: RunBindingsCli): void {
    bindingsClient.runBindingsCli = impl;
  }

  it("filters non-string roots via findWranglerRoots", async () => {
    stubRunBindingsCli(async (action) => {
      assert.deepStrictEqual(action, {
        action: "findRoots",
        roots: ["/workspace"],
      });
      return { roots: ["/a", 1, "/b", null, { path: "/c" }] };
    });

    const roots = await localWranglerClient.findWranglerRoots(["/workspace"]);
    assert.deepStrictEqual(roots, ["/a", "/b"]);
  });

  it("normalizes storage types and falls back statePath to wranglerDir", async () => {
    const wranglerDir = "/tmp/.wrangler-state";

    stubRunBindingsCli(async (action) => {
      assert.deepStrictEqual(action, {
        action: "listStorageTypes",
        wranglerDir,
      });
      return { statePath: 123, types: ["kv", "invalid", "d1", 42, "r2"] };
    });

    const result = await localWranglerClient.listStorageTypes(wranglerDir);
    assert.deepStrictEqual(result, {
      statePath: wranglerDir,
      types: ["kv", "d1", "r2"],
    });
  });

  it("preserves explicit statePath from CLI response", async () => {
    const wranglerDir = "/tmp/.wrangler";
    const statePath = "/tmp/.wrangler/state/v3";

    stubRunBindingsCli(async () => ({ statePath, types: [] }));

    const result = await localWranglerClient.listStorageTypes(wranglerDir);
    assert.strictEqual(result.statePath, statePath);
    assert.deepStrictEqual(result.types, []);
  });

  it("maps runtime initialization errors to LocalWranglerRuntimeNotFoundError", async () => {
    stubRunBindingsCli(async () => {
      throw new Error("Bindings CLI not initialized");
    });

    await assert.rejects(
      () => localWranglerClient.listStorageTypes("/tmp/.wrangler"),
      (error: unknown) =>
        error instanceof localWranglerClient.LocalWranglerRuntimeNotFoundError
    );
  });

  it("maps ENOENT CLI spawn errors to LocalWranglerRuntimeNotFoundError", async () => {
    stubRunBindingsCli(async () => {
      throw "spawn /path/to/bindings-cli ENOENT";
    });

    await assert.rejects(
      () => localWranglerClient.findWranglerRoots(["/workspace"]),
      (error: unknown) =>
        error instanceof localWranglerClient.LocalWranglerRuntimeNotFoundError
    );
  });

  it("normalizes listKvEntries prefixes and entries fallbacks", async () => {
    stubRunBindingsCli(async () => ({
      prefixes: [{ prefix: "docs/" }, { prefix: 12 }, null, {}],
      entries: "invalid",
    }));

    const result = await localWranglerClient.listKvEntries({
      wranglerDir: "/tmp/.wrangler",
      sqlitePath: "/tmp/ns.sqlite",
    });

    assert.deepStrictEqual(result, {
      prefixes: [{ prefix: "docs/" }],
      entries: [],
    });
  });

  it("normalizes listR2Objects prefixes and objects fallbacks", async () => {
    stubRunBindingsCli(async () => ({
      prefixes: [{ prefix: "images/" }, { prefix: true }],
      objects: null,
    }));

    const result = await localWranglerClient.listR2Objects({
      wranglerDir: "/tmp/.wrangler",
      bucket: "demo",
    });

    assert.deepStrictEqual(result, {
      prefixes: [{ prefix: "images/" }],
      objects: [],
    });
  });

  it("normalizes listD1Rows fallback when rows is not an array", async () => {
    stubRunBindingsCli(async () => ({ rows: { invalid: true } }));

    const result = await localWranglerClient.listD1Rows({
      sqlitePath: "/tmp/demo.sqlite",
      table: "users",
    });

    assert.deepStrictEqual(result, { rows: [] });
  });

  it("preserves listD1Rows arrays from CLI response", async () => {
    stubRunBindingsCli(async () => ({
      rows: [{ rowid: 1, name: "Ada" }],
    }));

    const result = await localWranglerClient.listD1Rows({
      sqlitePath: "/tmp/demo.sqlite",
      table: "users",
    });

    assert.deepStrictEqual(result, {
      rows: [{ rowid: 1, name: "Ada" }],
    });
  });
});
