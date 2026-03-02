const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Function to find all TypeScript files
function findTSFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findTSFiles(filePath, fileList);
    } else if (file.endsWith(".ts")) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`
        );
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const sourcemap = process.argv.includes("--sourcemap");

  // If sourcemap is enabled (dev/test mode) and not production, compile all TypeScript files
  // Otherwise, just compile the main extension
  const entryPoints =
    sourcemap && !production ? findTSFiles("src") : ["src/extension.ts"];

  const bundle = entryPoints.length === 1; // Only bundle for single entry point

  const buildConfig = {
    entryPoints,
    bundle,
    format: "cjs",
    minify: production,
    sourcemap: sourcemap,
    sourcesContent: false,
    platform: "node",
    logLevel: "silent",
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  };

  // Only set external when bundling
  if (bundle) {
    buildConfig.external = ["vscode"];
  }

  // Use outfile for single entry, outdir for multiple entries
  if (entryPoints.length === 1) {
    buildConfig.outfile = "out/extension.js";
  } else {
    buildConfig.outdir = "out";
    buildConfig.preserveSymlinks = true;
  }

  const ctx = await esbuild.context(buildConfig);
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
