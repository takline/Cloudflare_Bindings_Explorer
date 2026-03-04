import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
  try {
    const vscodeVersion = process.env.VSCODE_VERSION || "1.105.0";
    const r2TestMode = process.env.R2_TEST_MODE || "1";

    const workspaceRoot = process.cwd();
    // Resolve from repo root to avoid bundler-specific __dirname behavior in CI.
    const extensionDevelopmentPath = workspaceRoot;
    const extensionTestsPath = path.resolve(workspaceRoot, "out/test/suite/index");

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      version: vscodeVersion,
      extensionTestsEnv: {
        ...process.env,
        R2_TEST_MODE: r2TestMode,
      },
      launchArgs: ["--disable-extensions"], // Disable other extensions for cleaner test environment
    });
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  }
}

main();
