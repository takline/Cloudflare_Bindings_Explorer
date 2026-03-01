import { readR2 } from "./src/r2.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function main() {
    const dirPath = "dummy_r2";
    await mkdir(dirPath, { recursive: true });

    await writeFile(join(dirPath, "file1.txt"), "Hello World");
    await writeFile(join(dirPath, "file1.txt.metadata"), JSON.stringify({ customMetadata: { user: "alice" } }));

    await mkdir(join(dirPath, "folder"), { recursive: true });
    await writeFile(join(dirPath, "folder", "file2.png"), "fake png content");

    console.log(JSON.stringify(await readR2(dirPath), null, 2));
}

main();
