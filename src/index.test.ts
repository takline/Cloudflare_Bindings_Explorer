import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { readKV } from "./kv.ts";
import { readD1 } from "./d1.ts";
import { readR2 } from "./r2.ts";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

describe("KV Parser", () => {
    const dbPath = "test_kv.sqlite";

    beforeAll(() => {
        const db = new Database(dbPath);
        db.run("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)");
        db.run("INSERT INTO kv (key, value) VALUES ('key1', 'value1')");
        db.run("INSERT INTO kv (key, value) VALUES ('key2', 'value2')");
        db.close();
    });

    afterAll(async () => {
        await rm(dbPath, { force: true });
    });

    test("should read all key-value pairs", () => {
        const result = readKV(dbPath);
        expect(result).toHaveLength(2);
        expect(result).toEqual([
            { key: "key1", value: "value1" },
            { key: "key2", value: "value2" },
        ]);
    });
});

describe("D1 Parser", () => {
    const dbPath = "test_d1.sqlite";

    beforeAll(() => {
        const db = new Database(dbPath);
        db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
        db.run("INSERT INTO users (name) VALUES ('Alice')");
        db.run("CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)");
        db.run("INSERT INTO posts (title) VALUES ('Hello')");
        db.close();
    });

    afterAll(async () => {
        await rm(dbPath, { force: true });
    });

    test("should list tables and read data", () => {
        const result = readD1(dbPath);
        expect(result.tables).toContain("users");
        expect(result.tables).toContain("posts");
        expect(result.data.users).toHaveLength(1);
        expect(result.data.users[0].name).toBe("Alice");
        expect(result.data.posts).toHaveLength(1);
        expect(result.data.posts[0].title).toBe("Hello");
    });
});

describe("R2 Parser", () => {
    const dirPath = "test_r2_dir";

    beforeAll(async () => {
        await mkdir(dirPath, { recursive: true });
        await writeFile(join(dirPath, "file.txt"), "content");
        await writeFile(join(dirPath, "file.txt.metadata"), JSON.stringify({ customMetadata: { m: "v" } }));
        await mkdir(join(dirPath, "nested"), { recursive: true });
        await writeFile(join(dirPath, "nested", "image.png"), "data");
    });

    afterAll(async () => {
        await rm(dirPath, { recursive: true, force: true });
    });

    test("should traverse and parse blobs and metadata", async () => {
        const result = await readR2(dirPath);
        expect(result).toHaveLength(2);

        const fileTxt = result.find(r => r.key === "file.txt");
        expect(fileTxt).toBeDefined();
        expect(fileTxt?.size).toBe(7);
        expect(fileTxt?.customMetadata?.m).toBe("v");

        const imagePng = result.find(r => r.key === "nested/image.png");
        expect(imagePng).toBeDefined();
        expect(imagePng?.size).toBe(4);
    });
});
