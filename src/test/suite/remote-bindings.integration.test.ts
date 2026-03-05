import * as assert from "assert";
import * as fs from "node:fs";
import { initBindingsCliClient, runBindingsCli } from "../../bindings/client";
import {
  clearRemoteBindingsCache,
  executeRemoteD1Sql,
  listRemoteD1Databases,
  listRemoteKvEntries,
  listRemoteKvNamespaces,
  materializeRemoteD1Database,
  readRemoteKvValue,
} from "../../remote-bindings/client";
import { RemoteKvNamespaceInfo } from "../../remote-bindings/types";
import { getSecret } from "../../util/secrets";
import {
  assertValidRemoteBindingsLiveTestConfig,
  getTestConfig,
  setupTestEnvironment,
  teardownTestEnvironment,
} from "../test-config";

describe("Remote Bindings Integration Tests", () => {
  let liveConfig = getTestConfig();
  let authNamespace: RemoteKvNamespaceInfo | undefined;
  let createdKey: string | undefined;

  const shouldRunLiveRemoteTests =
    process.env.RUN_REMOTE_BINDINGS_LIVE_TESTS === "1";

  before(async function () {
    this.timeout(90000);
    if (!shouldRunLiveRemoteTests) {
      this.skip();
      return;
    }

    liveConfig = assertValidRemoteBindingsLiveTestConfig();
    initBindingsCliClient(process.cwd());
    await setupTestEnvironment();
    clearRemoteBindingsCache();
  });

  after(async function () {
    this.timeout(30000);
    if (createdKey && authNamespace) {
      await runBindingsCli({
        action: "delete",
        service: "cloudflare_kv",
        config: {
          token: liveConfig.cloudflareApiToken,
          account_id: liveConfig.cloudflareAccountId,
          namespace_id: authNamespace.id,
        },
        path: createdKey,
      }).catch(() => undefined);
    }

    clearRemoteBindingsCache();
    await teardownTestEnvironment();
  });

  it("reads Cloudflare API token from secure storage and lists remote KV namespaces", async function () {
    this.timeout(30000);
    const previousTokenEnv = process.env.CLOUDFLARE_API_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = "";

    try {
      const secureToken = await getSecret("cloudflare.apiToken");
      assert.strictEqual(
        secureToken,
        liveConfig.cloudflareApiToken,
        "cloudflare.apiToken should be read from secure storage"
      );

      const namespaces = await listRemoteKvNamespaces();
      assert.ok(namespaces.length > 0, "Expected at least one KV namespace");

      authNamespace = namespaces.find(
        (namespace) => namespace.title === liveConfig.remoteKvNamespaceTitle
      );
      assert.ok(
        authNamespace,
        `Expected namespace '${liveConfig.remoteKvNamespaceTitle}' to exist`
      );
    } finally {
      if (typeof previousTokenEnv === "string") {
        process.env.CLOUDFLARE_API_TOKEN = previousTokenEnv;
      } else {
        delete process.env.CLOUDFLARE_API_TOKEN;
      }
    }
  });

  it("lists remote KV entries and reads a live value without list parsing failures", async function () {
    this.timeout(90000);
    if (!authNamespace) {
      const namespaces = await listRemoteKvNamespaces();
      authNamespace = namespaces.find(
        (namespace) => namespace.title === liveConfig.remoteKvNamespaceTitle
      );
      assert.ok(
        authNamespace,
        `Expected namespace '${liveConfig.remoteKvNamespaceTitle}' to exist`
      );
    }

    createdKey = `cloudflare-bindings-explorer/e2e-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.txt`;
    const expectedValue = `remote-kv-integration-${Date.now()}`;

    await runBindingsCli({
      action: "write",
      service: "cloudflare_kv",
      config: {
        token: liveConfig.cloudflareApiToken,
        account_id: liveConfig.cloudflareAccountId,
        namespace_id: authNamespace!.id,
      },
      path: createdKey,
      content: expectedValue,
    });

    const entryVisible = await waitForKvKey(authNamespace!.id, createdKey);
    assert.ok(entryVisible, `Expected KV key '${createdKey}' to become listable`);

    const value = await waitForKvValue(authNamespace!.id, createdKey);
    assert.strictEqual(value, expectedValue, "KV value should match written value");
  });

  it("lists remote D1 databases and materializes the staging snapshot", async function () {
    this.timeout(120000);

    const databases = await listRemoteD1Databases();
    assert.ok(databases.length > 0, "Expected at least one remote D1 database");

    const target = databases.find(
      (database) => database.name === liveConfig.remoteD1DatabaseName
    );
    assert.ok(
      target,
      `Expected remote D1 database '${liveConfig.remoteD1DatabaseName}' to exist`
    );

    const snapshot = await materializeRemoteD1Database({
      databaseId: target!.id,
      databaseName: target!.name,
    });

    assert.ok(
      fs.existsSync(snapshot.sqlitePath),
      `Expected snapshot file to exist at ${snapshot.sqlitePath}`
    );
    assert.ok(snapshot.tableCount >= 0);

    const tablesResult = (await runBindingsCli({
      action: "listD1Tables",
      sqlitePath: snapshot.sqlitePath,
    })) as { tables?: Array<{ name?: string; rowCount?: number }> };

    assert.ok(Array.isArray(tablesResult.tables), "Expected D1 tables array");
  });

  it("propagates remote D1 mutations after force refresh", async function () {
    this.timeout(150000);

    const databases = await listRemoteD1Databases();
    const target = databases.find(
      (database) => database.name === liveConfig.remoteD1DatabaseName
    );
    assert.ok(
      target,
      `Expected remote D1 database '${liveConfig.remoteD1DatabaseName}' to exist`
    );

    const tableName = `__cbe_e2e_${Date.now().toString(36)}`;
    const quotedTable = `"${tableName.replace(/"/g, "\"\"")}"`;
    const initialValue = `before-${Date.now()}`;
    const updatedValue = `after-${Date.now()}`;

    try {
      await executeRemoteD1Sql({
        databaseId: target!.id,
        sql: `CREATE TABLE ${quotedTable} (id INTEGER PRIMARY KEY, value TEXT)`,
      });
      await executeRemoteD1Sql({
        databaseId: target!.id,
        sql: `INSERT INTO ${quotedTable} (id, value) VALUES (1, '${initialValue}')`,
      });

      const firstSnapshot = await materializeRemoteD1Database({
        databaseId: target!.id,
        databaseName: target!.name,
        forceRefresh: true,
      });
      const firstMetadataResult = (await runBindingsCli({
        action: "listD1Rows",
        sqlitePath: firstSnapshot.sqlitePath,
        table: "__cbe_remote_metadata",
      })) as { rows?: Array<Record<string, unknown>> };
      assert.strictEqual(firstSnapshot.fromCache, false);
      const firstFetchedAt = Number(
        firstMetadataResult.rows?.find((row) => row.key === "fetched_at")?.value
      );
      assert.ok(
        Number.isFinite(firstFetchedAt),
        "Expected fetched_at metadata in first snapshot"
      );

      await executeRemoteD1Sql({
        databaseId: target!.id,
        sql: `UPDATE ${quotedTable} SET value = '${updatedValue}' WHERE id = 1`,
      });
      const updatedRows = await executeRemoteD1Sql({
        databaseId: target!.id,
        sql: `SELECT value FROM ${quotedTable} WHERE id = 1`,
      });
      assert.strictEqual(updatedRows[0]?.value, updatedValue);

      await new Promise((resolve) => setTimeout(resolve, 1_100));

      const secondSnapshot = await materializeRemoteD1Database({
        databaseId: target!.id,
        databaseName: target!.name,
        forceRefresh: true,
      });
      const secondMetadataResult = (await runBindingsCli({
        action: "listD1Rows",
        sqlitePath: secondSnapshot.sqlitePath,
        table: "__cbe_remote_metadata",
      })) as { rows?: Array<Record<string, unknown>> };
      assert.strictEqual(secondSnapshot.fromCache, false);
      const secondFetchedAt = Number(
        secondMetadataResult.rows?.find((row) => row.key === "fetched_at")?.value
      );
      assert.ok(
        Number.isFinite(secondFetchedAt),
        "Expected fetched_at metadata in second snapshot"
      );
      assert.ok(
        secondFetchedAt >= firstFetchedAt,
        "Expected refreshed snapshot metadata timestamp to move forward"
      );
    } finally {
      await executeRemoteD1Sql({
        databaseId: target!.id,
        sql: `DROP TABLE IF EXISTS ${quotedTable}`,
      }).catch(() => undefined);
    }
  });
});

async function waitForKvKey(
  namespaceId: string,
  key: string,
  timeoutMs = 30000
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await listRemoteKvEntries({
      namespaceId,
      prefix: key,
      limit: 10,
    });
    if (result.entries.some((entry) => entry.key === key)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function waitForKvValue(
  namespaceId: string,
  key: string,
  timeoutMs = 30000
): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await readRemoteKvValue({ namespaceId, key });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("404") || message.includes("NotFound")) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Timed out waiting for KV value '${key}' to become readable`);
}
