import { build } from "bun";
import { readdirSync, statSync } from "fs";
import { join } from "path";

const production = process.argv.includes("--production");
const sourcemap = process.argv.includes("--sourcemap");

// Function to find all TypeScript files
function findTSFiles(dir: string, fileList: string[] = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    if (statSync(filePath).isDirectory()) {
      findTSFiles(filePath, fileList);
    } else if (file.endsWith(".ts")) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

async function main() {
  const entrypoints =
    sourcemap && !production ? findTSFiles("src") : ["src/extension.ts"];

  const result = await build({
    entrypoints,
    outdir: "out",
    root: "src",
    target: "node",
    format: "cjs",
    external: ["vscode", "mocha"],
    minify: production,
    sourcemap: sourcemap ? "external" : "none",
  });

  if (!result.success) {
    console.error("Build failed");
    for (const message of result.logs) {
      console.error(message);
    }
    process.exit(1);
  } else {
    console.log(`Build succeeded`);
  }
}

main();
