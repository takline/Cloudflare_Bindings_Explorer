import * as assert from "assert";
import { EventEmitter } from "node:events";
import {
  installVscodeModuleMock,
  uninstallVscodeModuleMock,
} from "./test-helpers/mock-vscode";

interface MockCliScenario {
  exitCode: number;
  stdout: string;
  stderr: string;
}

describe("Bindings CLI Client (Unit)", () => {
  let bindingsClient: typeof import("../../bindings/client");
  let childProcessModule: typeof import("node:child_process");
  let originalExecFile: typeof import("node:child_process").execFile;

  let scenario: MockCliScenario;
  let stdinPayload: string;

  before(() => {
    installVscodeModuleMock();

    childProcessModule = require("node:child_process");
    bindingsClient = require("../../bindings/client");
    originalExecFile = childProcessModule.execFile;
  });

  beforeEach(() => {
    scenario = { exitCode: 0, stdout: "{}", stderr: "" };
    stdinPayload = "";

    (childProcessModule as any).execFile = ((() => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        write(chunk: string) {
          stdinPayload += String(chunk);
          return true;
        },
        end() {
          return undefined;
        },
      };

      setImmediate(() => {
        if (scenario.stdout.length > 0) {
          child.stdout.emit("data", scenario.stdout);
        }
        if (scenario.stderr.length > 0) {
          child.stderr.emit("data", scenario.stderr);
        }
        child.emit("close", scenario.exitCode);
      });

      return child;
    }) as unknown) as typeof import("node:child_process").execFile;

    bindingsClient.initBindingsCliClient("/tmp/mock-extension");
  });

  afterEach(() => {
    (childProcessModule as any).execFile = originalExecFile;
  });

  after(() => {
    uninstallVscodeModuleMock();

    for (const moduleId of ["../../bindings/client", "../../util/output"]) {
      try {
        delete require.cache[require.resolve(moduleId)];
      } catch {
        // Ignore missing entries.
      }
    }
  });

  it("parses successful JSON output from bindings CLI", async () => {
    scenario = {
      exitCode: 0,
      stdout: '{"ok":true,"count":2}',
      stderr: "",
    };

    const action = { service: "s3", action: "list", path: "/" };
    const result = await bindingsClient.runBindingsCli(action);

    assert.deepStrictEqual(result, { ok: true, count: 2 });
    assert.strictEqual(stdinPayload, JSON.stringify(action));
  });

  it("prefers stderr text on CLI failure", async () => {
    scenario = {
      exitCode: 1,
      stdout: '{"error":"stdout failure"}',
      stderr: "stderr failure",
    };

    await assert.rejects(() => bindingsClient.runBindingsCli({ action: "list" }), (error: any) => {
      assert.match(
        error.message,
        /^Bindings CLI failed with code 1: stderr failure$/
      );
      return true;
    });
  });

  it("falls back to stdout JSON error text when stderr is empty", async () => {
    scenario = {
      exitCode: 2,
      stdout: '{"error":"json stdout failure"}',
      stderr: "",
    };

    await assert.rejects(() => bindingsClient.runBindingsCli({ action: "list" }), (error: any) => {
      assert.match(
        error.message,
        /^Bindings CLI failed with code 2: json stdout failure$/
      );
      return true;
    });
  });

  it("falls back to raw stdout when stderr is empty and stdout is not JSON", async () => {
    scenario = {
      exitCode: 3,
      stdout: "raw failure text",
      stderr: "",
    };

    await assert.rejects(() => bindingsClient.runBindingsCli({ action: "list" }), (error: any) => {
      assert.match(
        error.message,
        /^Bindings CLI failed with code 3: raw failure text$/
      );
      return true;
    });
  });

  it("uses default failure text when CLI provides no stderr or stdout", async () => {
    scenario = {
      exitCode: 4,
      stdout: "",
      stderr: "",
    };

    await assert.rejects(() => bindingsClient.runBindingsCli({ action: "list" }), (error: any) => {
      assert.match(
        error.message,
        /^Bindings CLI failed with code 4: No error output provided by bindings CLI$/
      );
      return true;
    });
  });
});
