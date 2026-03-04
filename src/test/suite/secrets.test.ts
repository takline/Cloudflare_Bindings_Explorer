import * as assert from "assert";
import {
  installVscodeModuleMock,
  uninstallVscodeModuleMock,
} from "./test-helpers/mock-vscode";

describe("Secrets Wrapper (Unit)", () => {
  let secrets: typeof import("../../util/secrets");
  let bindingsClient: typeof import("../../bindings/client");
  let originalRunBindingsCli: typeof import("../../bindings/client").runBindingsCli;

  let runBindingsCliCalls: any[];

  before(() => {
    installVscodeModuleMock();

    bindingsClient = require("../../bindings/client");
    secrets = require("../../util/secrets");
    originalRunBindingsCli = bindingsClient.runBindingsCli;
  });

  beforeEach(() => {
    runBindingsCliCalls = [];
    (bindingsClient as any).runBindingsCli = async (action: any) => {
      runBindingsCliCalls.push(action);
      return {};
    };
  });

  afterEach(() => {
    (bindingsClient as any).runBindingsCli = originalRunBindingsCli;
  });

  after(() => {
    uninstallVscodeModuleMock();

    for (const moduleId of [
      "../../util/secrets",
      "../../bindings/client",
      "../../util/output",
    ]) {
      try {
        delete require.cache[require.resolve(moduleId)];
      } catch {
        // Ignore missing entries.
      }
    }
  });

  it("storeSecret delegates to runBindingsCli with setSecret action", async () => {
    await secrets.storeSecret("r2.accessKeyId", "AKIA_TEST");

    assert.deepStrictEqual(runBindingsCliCalls, [
      {
        action: "setSecret",
        name: "r2.accessKeyId",
        value: "AKIA_TEST",
      },
      {
        action: "getSecret",
        name: "r2.accessKeyId",
      },
    ]);
  });

  it("storeSecret wraps underlying errors", async () => {
    (bindingsClient as any).runBindingsCli = async () => {
      throw new Error("keyring unavailable");
    };

    await assert.rejects(
      () => secrets.storeSecret("r2.accessKeyId", "AKIA_TEST"),
      /Failed to store secret in keyring/
    );
  });

  it("getSecret returns string values from runBindingsCli", async () => {
    const secretName = "r2.secretAccessKey.stringValue";
    (bindingsClient as any).runBindingsCli = async (action: any) => {
      runBindingsCliCalls.push(action);
      return { value: "secret-value" };
    };

    const value = await secrets.getSecret(secretName);

    assert.strictEqual(value, "secret-value");
    assert.deepStrictEqual(runBindingsCliCalls, [
      {
        action: "getSecret",
        name: secretName,
      },
    ]);
  });

  it("getSecret returns null when result value is not a string", async () => {
    const secretName = "r2.secretAccessKey.nonString";
    (bindingsClient as any).runBindingsCli = async () => ({ value: 42 });

    const value = await secrets.getSecret(secretName);
    assert.strictEqual(value, null);
  });

  it("getSecret returns null when runBindingsCli throws", async () => {
    const secretName = "r2.secretAccessKey.throw";
    (bindingsClient as any).runBindingsCli = async () => {
      throw new Error("read failed");
    };

    const value = await secrets.getSecret(secretName);
    assert.strictEqual(value, null);
  });

  it("getSecret falls back to session cache when keyring read is unavailable", async () => {
    let callCount = 0;
    (bindingsClient as any).runBindingsCli = async (action: any) => {
      callCount += 1;
      // storeSecret writes + verifies
      if (callCount <= 2) {
        return {};
      }
      // subsequent getSecret read fails
      throw new Error(`read failed for ${action?.name}`);
    };

    await secrets.storeSecret("r2.cacheTest", "cached-value");
    const value = await secrets.getSecret("r2.cacheTest");
    assert.strictEqual(value, "cached-value");
  });

  it("deleteSecret delegates to runBindingsCli with deleteSecret action", async () => {
    await secrets.deleteSecret("r2.secretAccessKey");

    assert.deepStrictEqual(runBindingsCliCalls, [
      {
        action: "deleteSecret",
        name: "r2.secretAccessKey",
      },
    ]);
  });

  it("deleteSecret wraps underlying errors", async () => {
    (bindingsClient as any).runBindingsCli = async () => {
      throw new Error("delete failed");
    };

    await assert.rejects(
      () => secrets.deleteSecret("r2.secretAccessKey"),
      /Failed to delete secret from keyring/
    );
  });
});
