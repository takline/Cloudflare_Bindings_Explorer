import { Database } from "bun:sqlite";

export function readKV(dbPath: string): { key: string, value: string }[] {
    let db: Database | null = null;
    try {
        db = new Database(dbPath, { readonly: true });
        const query = db.query("SELECT key, value FROM kv");
        return query.all() as { key: string, value: string }[];
    } catch (e) {
        console.error("Error reading KV from", dbPath, e);
        return [];
    } finally {
        if (db) db.close();
    }
}
