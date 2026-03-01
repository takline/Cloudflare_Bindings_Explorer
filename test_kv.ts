import { Database } from "bun:sqlite";
import { readKV } from "./src/kv.ts";

const dbPath = "dummy_kv.sqlite";
const db = new Database(dbPath);
db.run("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)");
db.run("INSERT INTO kv (key, value) VALUES ('test-key', 'test-value')");
db.close();

console.log(readKV(dbPath));
