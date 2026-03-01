import { Database } from "bun:sqlite";
import { readD1 } from "./src/d1.ts";

const dbPath = "dummy_d1.sqlite";
const db = new Database(dbPath);
db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
db.run("INSERT INTO users (name) VALUES ('Alice')");
db.run("INSERT INTO users (name) VALUES ('Bob')");
db.run("CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)");
db.run("INSERT INTO posts (title) VALUES ('Hello World')");
db.close();

console.log(JSON.stringify(readD1(dbPath), null, 2));
