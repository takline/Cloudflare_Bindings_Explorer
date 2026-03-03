import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
  try {
    process.env.R2_TEST_MODE = "1";

    const workspaceRoot = process.cwd();
    // Resolve from repo root to avoid bundler-specific __dirname behavior in CI.
    const extensionDevelopmentPath = workspaceRoot;
    const extensionTestsPath = path.resolve(workspaceRoot, "out/test/suite/index");

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ["--disable-extensions"], // Disable other extensions for cleaner test environment
    });
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  }
}

main();
