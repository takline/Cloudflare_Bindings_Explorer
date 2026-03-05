import * as assert from "assert";
import {
  installVscodeModuleMock,
  uninstallVscodeModuleMock,
  resetMockCloudflareConfig,
  setMockR2Config,
  setMockCloudflareConfig,
} from "./test-helpers/mock-vscode";

type RunBindingsCli = (action: unknown) => Promise<unknown>;

describe("Remote Bindings Client", () => {
  let bindingsClient: { runBindingsCli: RunBindingsCli };
  let secrets: typeof import("../../util/secrets");
  let remoteClient: typeof import("../../remote-bindings/client");
  let originalRunBindingsCli: RunBindingsCli;
  let originalCloudflareAccountIdEnv: string | undefined;
  let originalCloudflareApiTokenEnv: string | undefined;

  before(() => {
    installVscodeModuleMock();

    try {
      delete require.cache[require.resolve("../../remote-bindings/client")];
    } catch {
      // Ignore missing entries.
    }

    bindingsClient = require("../../bindings/client");
    secrets = require("../../util/secrets");
    remoteClient = require("../../remote-bindings/client");
    originalRunBindingsCli = bindingsClient.runBindingsCli;
  });

  beforeEach(() => {
    originalCloudflareAccountIdEnv = process.env.CLOUDFLARE_ACCOUNT_ID;
    originalCloudflareApiTokenEnv = process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;

    resetMockCloudflareConfig();
    setMockCloudflareConfig({ accountId: "account-123" });
    remoteClient.clearRemoteBindingsCache();

    bindingsClient.runBindingsCli = async (action: any) => {
      if (action?.action === "getSecret") {
        return { value: "token-abc" };
      }
      throw new Error("runBindingsCli was not stubbed for this test");
    };
  });

  afterEach(() => {
    if (typeof originalCloudflareAccountIdEnv === "string") {
      process.env.CLOUDFLARE_ACCOUNT_ID = originalCloudflareAccountIdEnv;
    } else {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
    }
    if (typeof originalCloudflareApiTokenEnv === "string") {
      process.env.CLOUDFLARE_API_TOKEN = originalCloudflareApiTokenEnv;
    } else {
      delete process.env.CLOUDFLARE_API_TOKEN;
    }

    bindingsClient.runBindingsCli = originalRunBindingsCli;
    remoteClient.clearRemoteBindingsCache();
  });

  after(() => {
    uninstallVscodeModuleMock();

    try {
      delete require.cache[require.resolve("../../remote-bindings/client")];
    } catch {
      // Ignore missing entries.
    }
  });

  it("requires a Cloudflare account ID", async () => {
    setMockCloudflareConfig({ accountId: "" });

    await assert.rejects(
      () => remoteClient.listRemoteD1Databases(),
      /Cloudflare Account ID is required/
    );
  });

  it("requires a Cloudflare API token", async () => {
    const previousEnvToken = process.env.CLOUDFLARE_API_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = "";
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action?.action === "deleteSecret") {
        return { success: true };
      }
      return { value: null };
    };

    try {
      await secrets.deleteSecret("cloudflare.apiToken");
      await assert.rejects(
        () => remoteClient.listRemoteKvNamespaces(),
        /Cloudflare API token is required/
      );
    } finally {
      if (typeof previousEnvToken === "string") {
        process.env.CLOUDFLARE_API_TOKEN = previousEnvToken;
      } else {
        delete process.env.CLOUDFLARE_API_TOKEN;
      }
    }
  });

  it("infers account ID from r2 endpoint when cloudflare.accountId is empty", async () => {
    setMockCloudflareConfig({ accountId: "" });
    setMockR2Config({
      endpointUrl: "https://derived-user-id.r2.cloudflarestorage.com",
    });

    let listCall: any | undefined;
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action?.action === "getSecret") {
        return { value: "token-abc" };
      }
      listCall = action;
      return { namespaces: [], page: 1, hasMore: false };
    };

    await remoteClient.listRemoteKvNamespaces();
    assert.strictEqual(listCall?.accountId, "derived-user-id");
  });

  it("paginates and deduplicates remote D1 databases", async () => {
    const calls: any[] = [];
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action.action === "getSecret") {
        return { value: "token-abc" };
      }
      calls.push(action);
      if (action.page === 1) {
        return {
          databases: [
            { id: "db-b", name: "B" },
            { id: "db-a", name: "A" },
          ],
          page: 1,
          hasMore: true,
        };
      }

      return {
        databases: [{ id: "db-a", name: "A duplicate" }],
        page: 2,
        hasMore: false,
      };
    };

    const databases = await remoteClient.listRemoteD1Databases();
    assert.deepStrictEqual(databases, [
      { id: "db-a", name: "A" },
      { id: "db-b", name: "B" },
    ]);
    assert.deepStrictEqual(
      calls.map((call) => ({
        action: call.action,
        page: call.page,
        perPage: call.perPage,
      })),
      [
        { action: "listRemoteD1Databases", page: 1, perPage: 100 },
        { action: "listRemoteD1Databases", page: 2, perPage: 100 },
      ]
    );
  });

  it("reuses cached remote D1 database results for the same account", async () => {
    let callCount = 0;
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action.action === "getSecret") {
        return { value: "token-abc" };
      }
      callCount += 1;
      return {
        databases: [{ id: "db-a", name: "A" }],
        page: 1,
        hasMore: false,
      };
    };

    const first = await remoteClient.listRemoteD1Databases();
    const second = await remoteClient.listRemoteD1Databases();

    assert.strictEqual(callCount, 1);
    assert.deepStrictEqual(first, second);
  });

  it("lists and deduplicates remote KV namespaces", async () => {
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action.action === "getSecret") {
        return { value: "token-abc" };
      }
      assert.strictEqual(action.action, "listRemoteKvNamespaces");
      return {
        namespaces: [
          { id: "ns-b", title: "beta" },
          { id: "ns-a", title: "alpha" },
          { id: "ns-a", title: "alpha duplicate" },
        ],
        page: 1,
        hasMore: false,
      };
    };

    const namespaces = await remoteClient.listRemoteKvNamespaces();
    assert.deepStrictEqual(namespaces, [
      { id: "ns-a", title: "alpha" },
      { id: "ns-b", title: "beta" },
    ]);
  });

  it("normalizes remote KV list responses", async () => {
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action.action === "getSecret") {
        return { value: "token-abc" };
      }
      assert.deepStrictEqual(action, {
        action: "listRemoteKvEntries",
        accountId: "account-123",
        apiToken: "token-abc",
        namespaceId: "ns-1",
        prefix: "users/",
        cursor: "cursor-1",
        limit: 50,
      });
      return {
        prefixes: [{ prefix: "users/a/" }, { prefix: 123 }],
        entries: [{ key: "users/a/1" }, { bad: true }],
        cursor: "cursor-2",
        isTruncated: true,
      };
    };

    const result = await remoteClient.listRemoteKvEntries({
      namespaceId: "ns-1",
      prefix: "users/",
      cursor: "cursor-1",
      limit: 50,
    });

    assert.deepStrictEqual(result, {
      prefixes: [{ prefix: "users/a/" }],
      entries: [{ key: "users/a/1" }],
      cursor: "cursor-2",
      isTruncated: true,
    });
  });

  it("enforces a Cloudflare-compatible minimum KV list limit", async () => {
    let capturedAction: any;
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action.action === "getSecret") {
        return { value: "token-abc" };
      }
      capturedAction = action;
      return {
        prefixes: [],
        entries: [],
        isTruncated: false,
      };
    };

    await remoteClient.listRemoteKvEntries({
      namespaceId: "ns-1",
      limit: 1,
    });

    assert.strictEqual(capturedAction?.action, "listRemoteKvEntries");
    assert.strictEqual(capturedAction?.limit, 10);
  });

  it("materializes a remote D1 database using bounded defaults", async () => {
    let call: any | undefined;
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action.action === "getSecret") {
        return { value: "token-abc" };
      }
      call = action;
      return {
        sqlitePath: "/tmp/remote-d1.sqlite",
        fromCache: false,
        tableCount: 2,
        rowLimit: 500,
      };
    };

    const result = await remoteClient.materializeRemoteD1Database({
      databaseId: "db-1",
      databaseName: "main",
    });

    assert.strictEqual(result.sqlitePath, "/tmp/remote-d1.sqlite");
    assert.deepStrictEqual(call, {
      action: "materializeRemoteD1Database",
      accountId: "account-123",
      apiToken: "token-abc",
      databaseId: "db-1",
      databaseName: "main",
      forceRefresh: false,
      maxTables: 100,
      maxRowsPerTable: 500,
    });
  });

  it("forwards forceRefresh for remote D1 materialization", async () => {
    let call: any | undefined;
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action.action === "getSecret") {
        return { value: "token-abc" };
      }
      call = action;
      return {
        sqlitePath: "/tmp/remote-d1.sqlite",
        fromCache: false,
        tableCount: 2,
        rowLimit: 500,
      };
    };

    await remoteClient.materializeRemoteD1Database({
      databaseId: "db-2",
      databaseName: "staging",
      forceRefresh: true,
    });

    assert.strictEqual(call?.forceRefresh, true);
  });

  it("executes remote D1 SQL and normalizes row results", async () => {
    let capturedAction: any;
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action.action === "getSecret") {
        return { value: "token-abc" };
      }
      capturedAction = action;
      return {
        rows: [{ id: 1 }, null, "bad"],
      };
    };

    const rows = await remoteClient.executeRemoteD1Sql({
      databaseId: "db-1",
      sql: "SELECT 1 AS id",
    });

    assert.deepStrictEqual(rows, [{ id: 1 }]);
    assert.deepStrictEqual(capturedAction, {
      action: "executeRemoteD1Sql",
      accountId: "account-123",
      apiToken: "token-abc",
      databaseId: "db-1",
      sql: "SELECT 1 AS id",
    });
  });

  it("validates remote KV value responses", async () => {
    bindingsClient.runBindingsCli = async (action: any) => {
      if (action.action === "getSecret") {
        return { value: "token-abc" };
      }
      return { content: 123 };
    };

    await assert.rejects(
      () =>
        remoteClient.readRemoteKvValue({
          namespaceId: "ns-1",
          key: "settings/theme",
        }),
      /Remote KV value response was invalid/
    );
  });
});
