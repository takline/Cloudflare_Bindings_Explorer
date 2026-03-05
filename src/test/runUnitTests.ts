import { run } from "./suite";
import { installVscodeModuleMock } from "./suite/test-helpers/mock-vscode";

async function main() {
  try {
    if (!process.env.RUN_R2_LIVE_TESTS) {
      process.env.RUN_R2_LIVE_TESTS = "0";
    }
    if (!process.env.RUN_REMOTE_BINDINGS_LIVE_TESTS) {
      process.env.RUN_REMOTE_BINDINGS_LIVE_TESTS = "0";
    }

    installVscodeModuleMock();
    await run();
  } catch (error) {
    console.error("Failed to run deterministic unit tests:", error);
    process.exit(1);
  }
}

main();
