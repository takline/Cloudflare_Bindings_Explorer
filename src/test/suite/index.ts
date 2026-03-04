import * as path from "path";
import Mocha from "mocha";

export function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: "bdd",
    color: true,
    timeout: 20000, // 20 second timeout for network operations
  });

  const testsRoot = path.resolve(__dirname, "..");
  const runLiveR2Tests = process.env.RUN_R2_LIVE_TESTS === "1";

  return new Promise((resolve, reject) => {
    // Use require instead of import for glob to avoid TypeScript issues
    const globModule = require("glob");
    const globSync =
      globModule.globSync || globModule.sync || (typeof globModule === "function" ? globModule : null);

    if (typeof globSync !== "function") {
      return reject(
        new Error("Glob module did not provide a sync matcher function.")
      );
    }

    const files = (globSync("**/*.test.js", { cwd: testsRoot }) as string[])
      .sort((a: string, b: string) => a.localeCompare(b));

    const integrationTests = files.filter((f: string) =>
      f.endsWith("integration.test.js")
    );
    const selectedFiles = files.filter(
      (f: string) => runLiveR2Tests || !f.endsWith("integration.test.js")
    );

    if (!runLiveR2Tests && integrationTests.length > 0) {
      console.log(
        "Skipping live R2 integration tests. Set RUN_R2_LIVE_TESTS=1 to enable."
      );
    }

    // Add files to the test suite
    selectedFiles.forEach((f: string) =>
      mocha.addFile(path.resolve(testsRoot, f))
    );

    try {
      // Run the mocha test
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
