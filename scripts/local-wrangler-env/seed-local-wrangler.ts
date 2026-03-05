import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

type SeedOptions = {
  targetDir: string;
  cleanState: boolean;
};

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");
const WRANGLER_CONFIG_TEMPLATE = path.join(
  REPO_ROOT,
  "scripts",
  "local-wrangler-env",
  "wrangler.jsonc"
);
const WRANGLER_STATE_DIRNAME = ".wrangler";

function parseArgs(args: string[]): SeedOptions {
  let targetDir = REPO_ROOT;
  let cleanState = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--target") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("--target requires a value");
      }
      targetDir = path.resolve(value);
      i++;
      continue;
    }

    if (arg === "--no-clean") {
      cleanState = false;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsageAndExit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { targetDir, cleanState };
}

function printUsageAndExit(code: number): never {
  const usage = [
    "Seed local Wrangler state with dummy KV, D1, and R2 data.",
    "",
    "Usage:",
    "  bun ./scripts/local-wrangler-env/seed-local-wrangler.ts [--target <dir>] [--no-clean]",
    "",
    "Options:",
    "  --target <dir>  Directory where .wrangler will be created (default: repo root)",
    "  --no-clean      Do not clear existing .wrangler state before seeding",
  ].join("\n");

  console.log(usage);
  process.exit(code);
}

async function runBunx(cwd: string, args: string[], allowFailure = false): Promise<void> {
  console.log(`$ (cd ${cwd} && bunx ${args.join(" ")})`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("bunx", args, {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Command failed with exit code ${code}: bunx ${args.join(" ")}\n${stderr}`.trim()
        )
      );
    });
  });
}

async function runWranglerLocal(
  targetDir: string,
  configPath: string,
  args: string[],
  allowFailure = false
): Promise<void> {
  await runBunx(
    targetDir,
    ["wrangler", ...args, "--local", "--config", configPath],
    allowFailure
  );
}

async function seedKv(targetDir: string, configPath: string): Promise<void> {
  console.log("Seeding KV data...");
  const kvEntries: Array<{ key: string; value: string }> = [
    {
      key: "users:1",
      value: JSON.stringify({
        id: 1,
        email: "ada@example.com",
        role: "admin",
      }),
    },
    {
      key: "users:2",
      value: JSON.stringify({
        id: 2,
        email: "grace@example.com",
        role: "member",
      }),
    },
    {
      key: "feature-flags:r2-browser",
      value: JSON.stringify({
        enabled: true,
        rollout: 100,
      }),
    },
  ];

  for (const entry of kvEntries) {
    await runWranglerLocal(targetDir, configPath, [
      "kv",
      "key",
      "put",
      entry.key,
      entry.value,
      "--binding",
      "MOCK_KV",
    ]);
  }
}

async function seedD1(targetDir: string, configPath: string): Promise<void> {
  console.log("Seeding D1 data...");
  await runWranglerLocal(targetDir, configPath, [
    "d1",
    "execute",
    "mock-db",
    "--command",
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, plan TEXT NOT NULL, created_at TEXT NOT NULL);",
  ]);
  await runWranglerLocal(targetDir, configPath, [
    "d1",
    "execute",
    "mock-db",
    "--command",
    "DELETE FROM users;",
  ]);
  await runWranglerLocal(targetDir, configPath, [
    "d1",
    "execute",
    "mock-db",
    "--command",
    "INSERT INTO users (id, email, plan, created_at) VALUES (1, 'ada@example.com', 'enterprise', datetime('now')), (2, 'grace@example.com', 'pro', datetime('now')), (3, 'linus@example.com', 'free', datetime('now'));",
  ]);
}

async function seedR2(targetDir: string, configPath: string): Promise<void> {
  console.log("Seeding R2 data...");
  const tempDir = await mkdtemp(path.join(tmpdir(), "wrangler-local-seed-"));
  try {
    const objects = [
      {
        key: "documents/welcome.txt",
        content: "Welcome to local Wrangler R2 test data.",
      },
      {
        key: "logs/app-2026-03-04.log",
        content: "INFO seeded local object store\nINFO request complete",
      },
      {
        key: "images/meta.json",
        content: JSON.stringify({ seeded: true, source: "seed-local-wrangler.ts" }),
      },
    ];

    for (const object of objects) {
      const tempFile = path.join(tempDir, path.basename(object.key));
      await writeFile(tempFile, object.content, "utf8");
      await runWranglerLocal(targetDir, configPath, [
        "r2",
        "object",
        "put",
        `mock-bucket/${object.key}`,
        "--file",
        tempFile,
      ]);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function gatherStateFileSummary(stateRoot: string): Promise<{
  totalFiles: number;
  kvFiles: number;
  d1Files: number;
  r2Files: number;
}> {
  let totalFiles = 0;
  let kvFiles = 0;
  let d1Files = 0;
  let r2Files = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          return;
        }

        if (!entry.isFile()) {
          return;
        }

        totalFiles++;
        const rel = path.relative(stateRoot, fullPath);
        const segments = rel.split(path.sep);
        if (segments.includes("kv")) {
          kvFiles++;
        }
        if (segments.includes("d1")) {
          d1Files++;
        }
        if (segments.includes("r2")) {
          r2Files++;
        }
      })
    );
  }

  await walk(stateRoot);
  return { totalFiles, kvFiles, d1Files, r2Files };
}

async function ensureStateExists(stateRoot: string): Promise<void> {
  const rootStat = await stat(stateRoot).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error(`Wrangler state not found at ${stateRoot}`);
  }

  const summary = await gatherStateFileSummary(stateRoot);
  if (summary.kvFiles < 1 || summary.d1Files < 1 || summary.r2Files < 1) {
    throw new Error(
      `Seeded state is incomplete (kv=${summary.kvFiles}, d1=${summary.d1Files}, r2=${summary.r2Files})`
    );
  }

  console.log(
    `State summary: total files=${summary.totalFiles}, kv=${summary.kvFiles}, d1=${summary.d1Files}, r2=${summary.r2Files}`
  );
}

async function createTargetWranglerConfig(targetDir: string): Promise<string> {
  const rawConfig = await readFile(WRANGLER_CONFIG_TEMPLATE, "utf8");
  const config = JSON.parse(rawConfig) as Record<string, unknown>;
  const mockMainPath = path.join(REPO_ROOT, "scripts", "local-wrangler-env", "mockMain.ts");
  const relativeMainPath = path.relative(targetDir, mockMainPath).split(path.sep).join("/");
  config.main = relativeMainPath;

  const targetConfigPath = path.join(targetDir, ".wrangler-seed.config.jsonc");
  await writeFile(targetConfigPath, JSON.stringify(config, null, 2), "utf8");
  return targetConfigPath;
}

async function seedLocalWranglerState(options: SeedOptions): Promise<void> {
  const targetDirStat = await stat(options.targetDir).catch(() => null);
  if (!targetDirStat?.isDirectory()) {
    throw new Error(`Target directory does not exist: ${options.targetDir}`);
  }

  const stateDir = path.join(options.targetDir, WRANGLER_STATE_DIRNAME);
  if (options.cleanState) {
    console.log(`Removing existing state at ${stateDir}`);
    await rm(stateDir, { recursive: true, force: true });
  }

  const targetConfigPath = await createTargetWranglerConfig(options.targetDir);
  try {
    await seedKv(options.targetDir, targetConfigPath);
    await seedD1(options.targetDir, targetConfigPath);
    await seedR2(options.targetDir, targetConfigPath);
  } finally {
    await rm(targetConfigPath, { force: true });
  }

  const stateRoot = path.join(stateDir, "state", "v3");
  await ensureStateExists(stateRoot);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Target directory: ${options.targetDir}`);
  console.log(`Wrangler config template: ${WRANGLER_CONFIG_TEMPLATE}`);

  await seedLocalWranglerState(options);

  console.log("Local Wrangler state seeded successfully.");
}

main().catch((error) => {
  console.error("Failed to seed local Wrangler state.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
