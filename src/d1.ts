import { Database } from "bun:sqlite";

export function readD1(dbPath: string): { tables: string[], data: Record<string, any[]> } {
    let db: Database | null = null;
    try {
        db = new Database(dbPath, { readonly: true });
        const tablesQuery = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        const tables = tablesQuery.all() as { name: string }[];
        const tableNames = tables.map(t => t.name);

        const data: Record<string, any[]> = {};
        for (const tableName of tableNames) {
            const query = db.query(`SELECT * FROM "${tableName}"`);
            data[tableName] = query.all();
        }

        return { tables: tableNames, data };
    } catch (e) {
        console.error("Error reading D1 from", dbPath, e);
        return { tables: [], data: {} };
    } finally {
        if (db) db.close();
    }
}
