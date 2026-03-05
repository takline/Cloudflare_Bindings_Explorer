import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import { getNonce } from "../email/util";
import {
  executeRemoteD1Sql,
  materializeRemoteD1Database,
} from "../remote-bindings/client";

export interface SqliteTableInfo {
  name: string;
  type: "table" | "view";
  rowCount: number;
  columnCount: number;
}

export interface SqliteColumnInfo {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | number | null;
  primaryKey: boolean;
}

export interface SqliteTableData {
  columns: SqliteColumnInfo[];
  rows: Array<Record<string, SqliteValue>>;
  rowCount: number;
}

export interface SqliteDatabaseInfo {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  displayName?: string;
  locationLabel?: string;
  source?: "local" | "remote-d1";
}

export type SqliteValue = string | number | null | Uint8Array;

type WebviewRequest =
  | { type: "init" }
  | { type: "getTables" }
  | { type: "getTableData"; tableName: string }
  | { type: "refreshFromSource"; tableName?: string }
  | {
      type: "updateRow";
      tableName: string;
      rowId: number;
      column: string;
      value: SqliteValue;
      rowIdentity?: Record<string, SqliteValue>;
    }
  | {
      type: "deleteRow";
      tableName: string;
      rowId: number;
      rowIdentity?: Record<string, SqliteValue>;
    }
  | { type: "insertRow"; tableName: string; values: Record<string, SqliteValue> }
  | { type: "executeQuery"; query: string; tableName?: string };

type WebviewResponse =
  | { type: "dbInfo"; info: SqliteDatabaseInfo }
  | { type: "tablesLoaded"; tables: SqliteTableInfo[] }
  | { type: "tableDataLoaded"; tableName: string; data: SqliteTableData }
  | { type: "queryResult"; result: Array<Record<string, SqliteValue>> | { message: string } }
  | { type: "updateSuccess"; rowId: number; column: string }
  | { type: "deleteSuccess"; rowId: number }
  | { type: "insertSuccess" }
  | { type: "error"; message: string };

export class SqliteVisualEditor implements vscode.CustomReadonlyEditorProvider<SqliteDocument> {
  static readonly viewType = "cloudflareBindingsExplorer.sqliteEditor";

  private readonly sqlJs: Promise<SqlJsStatic>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.sqlJs = this.initSqlJs();
  }

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new SqliteVisualEditor(context);
    return vscode.window.registerCustomEditorProvider(
      SqliteVisualEditor.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  async openCustomDocument(uri: vscode.Uri): Promise<SqliteDocument> {
    return new SqliteDocument(uri);
  }

  async resolveCustomEditor(
    document: SqliteDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const uriContext = parseUriContext(document.uri);
    const dbInfo = await this.getDatabaseInfo(document.uri.fsPath, uriContext);
    if (uriContext?.remoteD1) {
      webviewPanel.title = `Remote D1: ${uriContext.remoteD1.databaseName}`;
    }
    webviewPanel.webview.postMessage({ type: "dbInfo", info: dbInfo } satisfies WebviewResponse);

    webviewPanel.webview.onDidReceiveMessage(async (rawMessage) => {
      try {
        const message = this.parseMessage(rawMessage);
        await this.handleMessage(document, webviewPanel, message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        webviewPanel.webview.postMessage({ type: "error", message } satisfies WebviewResponse);
      }
    });
  }

  private async handleMessage(
    document: SqliteDocument,
    panel: vscode.WebviewPanel,
    message: WebviewRequest
  ): Promise<void> {
    const uriContext = parseUriContext(document.uri);

    switch (message.type) {
      case "init":
      case "getTables": {
        const tables = await this.getTables(document.uri.fsPath);
        panel.webview.postMessage({ type: "tablesLoaded", tables } satisfies WebviewResponse);
        return;
      }
      case "getTableData": {
        const data = await this.getTableData(document.uri.fsPath, message.tableName);
        panel.webview.postMessage({
          type: "tableDataLoaded",
          tableName: message.tableName,
          data,
        } satisfies WebviewResponse);
        return;
      }
      case "refreshFromSource": {
        if (uriContext?.remoteD1) {
          await this.refreshRemoteD1Snapshot(uriContext.remoteD1);
          const dbInfo = await this.getDatabaseInfo(document.uri.fsPath, uriContext);
          panel.webview.postMessage({ type: "dbInfo", info: dbInfo } satisfies WebviewResponse);
        }

        const tables = await this.getTables(document.uri.fsPath);
        panel.webview.postMessage({ type: "tablesLoaded", tables } satisfies WebviewResponse);

        if (message.tableName) {
          const data = await this.getTableData(document.uri.fsPath, message.tableName);
          panel.webview.postMessage({
            type: "tableDataLoaded",
            tableName: message.tableName,
            data,
          } satisfies WebviewResponse);
        }
        return;
      }
      case "updateRow": {
        if (uriContext?.remoteD1) {
          const whereClause = buildRemoteRowPredicate(message.rowIdentity);
          if (!whereClause) {
            throw new Error(
              "Remote row updates require a table PRIMARY KEY. Use SQL Query for this table."
            );
          }
          const sql = `UPDATE ${quoteIdentifier(message.tableName)} SET ${quoteIdentifier(
            message.column
          )} = ${toSqlLiteral(message.value)} WHERE ${whereClause}`;
          await executeRemoteD1Sql({
            databaseId: uriContext.remoteD1.databaseId,
            sql,
          });
          await this.refreshRemoteD1Snapshot(uriContext.remoteD1);
          const tables = await this.getTables(document.uri.fsPath);
          panel.webview.postMessage({
            type: "tablesLoaded",
            tables,
          } satisfies WebviewResponse);
          const data = await this.getTableData(document.uri.fsPath, message.tableName);
          panel.webview.postMessage({
            type: "tableDataLoaded",
            tableName: message.tableName,
            data,
          } satisfies WebviewResponse);
          panel.webview.postMessage({
            type: "updateSuccess",
            rowId: message.rowId,
            column: message.column,
          } satisfies WebviewResponse);
          return;
        }

        await this.updateRow(document.uri.fsPath, message.tableName, message.rowId, message.column, message.value);
        panel.webview.postMessage({
          type: "updateSuccess",
          rowId: message.rowId,
          column: message.column,
        } satisfies WebviewResponse);
        return;
      }
      case "deleteRow": {
        if (uriContext?.remoteD1) {
          const whereClause = buildRemoteRowPredicate(message.rowIdentity);
          if (!whereClause) {
            throw new Error(
              "Remote row deletes require a table PRIMARY KEY. Use SQL Query for this table."
            );
          }
          const sql = `DELETE FROM ${quoteIdentifier(message.tableName)} WHERE ${whereClause}`;
          await executeRemoteD1Sql({
            databaseId: uriContext.remoteD1.databaseId,
            sql,
          });
          await this.refreshRemoteD1Snapshot(uriContext.remoteD1);
          const tables = await this.getTables(document.uri.fsPath);
          panel.webview.postMessage({
            type: "tablesLoaded",
            tables,
          } satisfies WebviewResponse);
          const data = await this.getTableData(document.uri.fsPath, message.tableName);
          panel.webview.postMessage({
            type: "tableDataLoaded",
            tableName: message.tableName,
            data,
          } satisfies WebviewResponse);
          panel.webview.postMessage({
            type: "deleteSuccess",
            rowId: message.rowId,
          } satisfies WebviewResponse);
          return;
        }

        await this.deleteRow(document.uri.fsPath, message.tableName, message.rowId);
        panel.webview.postMessage({
          type: "deleteSuccess",
          rowId: message.rowId,
        } satisfies WebviewResponse);
        return;
      }
      case "insertRow": {
        if (uriContext?.remoteD1) {
          const entries = Object.entries(message.values).filter(
            ([, value]) => value !== undefined
          );
          const quotedTable = quoteIdentifier(message.tableName);
          const sql =
            entries.length === 0
              ? `INSERT INTO ${quotedTable} DEFAULT VALUES`
              : `INSERT INTO ${quotedTable} (${entries
                  .map(([column]) => quoteIdentifier(column))
                  .join(", ")}) VALUES (${entries
                  .map(([, value]) => toSqlLiteral(value))
                  .join(", ")})`;

          await executeRemoteD1Sql({
            databaseId: uriContext.remoteD1.databaseId,
            sql,
          });
          await this.refreshRemoteD1Snapshot(uriContext.remoteD1);
          const tables = await this.getTables(document.uri.fsPath);
          panel.webview.postMessage({
            type: "tablesLoaded",
            tables,
          } satisfies WebviewResponse);
          const data = await this.getTableData(document.uri.fsPath, message.tableName);
          panel.webview.postMessage({
            type: "tableDataLoaded",
            tableName: message.tableName,
            data,
          } satisfies WebviewResponse);
          panel.webview.postMessage({ type: "insertSuccess" } satisfies WebviewResponse);
          return;
        }

        await this.insertRow(document.uri.fsPath, message.tableName, message.values);
        panel.webview.postMessage({ type: "insertSuccess" } satisfies WebviewResponse);
        return;
      }
      case "executeQuery": {
        if (uriContext?.remoteD1) {
          const rows = await executeRemoteD1Sql({
            databaseId: uriContext.remoteD1.databaseId,
            sql: message.query,
          });
          const normalizedRows = rows.map(normalizeSqliteRowValues);

          if (isMutatingSqlQuery(message.query)) {
            await this.refreshRemoteD1Snapshot(uriContext.remoteD1);
            const tables = await this.getTables(document.uri.fsPath);
            panel.webview.postMessage({
              type: "tablesLoaded",
              tables,
            } satisfies WebviewResponse);
            if (message.tableName) {
              const data = await this.getTableData(document.uri.fsPath, message.tableName);
              panel.webview.postMessage({
                type: "tableDataLoaded",
                tableName: message.tableName,
                data,
              } satisfies WebviewResponse);
            }
          }

          panel.webview.postMessage({
            type: "queryResult",
            result:
              normalizedRows.length > 0
                ? normalizedRows
                : { message: "Query executed successfully" },
          } satisfies WebviewResponse);
          return;
        }

        const result = await this.executeQuery(document.uri.fsPath, message.query);
        panel.webview.postMessage({ type: "queryResult", result } satisfies WebviewResponse);
        return;
      }
      default: {
        const _exhaustive: never = message;
        throw new Error(`Unsupported message: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  private parseMessage(rawMessage: unknown): WebviewRequest {
    if (!rawMessage || typeof rawMessage !== "object") {
      throw new Error("Invalid webview message.");
    }

    const message = rawMessage as { type?: unknown };
    if (typeof message.type !== "string") {
      throw new Error("Webview message missing type.");
    }

    switch (message.type) {
      case "init":
      case "getTables":
        return { type: message.type };
      case "getTableData":
        return {
          type: "getTableData",
          tableName: this.requireString(rawMessage, "tableName"),
        };
      case "refreshFromSource": {
        const tableName = (rawMessage as { tableName?: unknown }).tableName;
        return {
          type: "refreshFromSource",
          tableName: typeof tableName === "string" ? tableName : undefined,
        };
      }
      case "updateRow":
        return {
          type: "updateRow",
          tableName: this.requireString(rawMessage, "tableName"),
          rowId: this.requireNumber(rawMessage, "rowId"),
          column: this.requireString(rawMessage, "column"),
          value: this.normalizeValue((rawMessage as { value?: unknown }).value),
          rowIdentity: this.optionalRecord(rawMessage, "rowIdentity"),
        };
      case "deleteRow":
        return {
          type: "deleteRow",
          tableName: this.requireString(rawMessage, "tableName"),
          rowId: this.requireNumber(rawMessage, "rowId"),
          rowIdentity: this.optionalRecord(rawMessage, "rowIdentity"),
        };
      case "insertRow":
        return {
          type: "insertRow",
          tableName: this.requireString(rawMessage, "tableName"),
          values: this.requireRecord(rawMessage, "values"),
        };
      case "executeQuery":
        return {
          type: "executeQuery",
          query: this.requireString(rawMessage, "query"),
          tableName: this.optionalString(rawMessage, "tableName"),
        };
      default:
        throw new Error(`Unknown webview message type: ${message.type}`);
    }
  }

  private requireString(raw: unknown, key: string): string {
    if (!raw || typeof raw !== "object") {
      throw new Error("Malformed webview message.");
    }
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Missing ${key}.`);
    }
    return value;
  }

  private requireNumber(raw: unknown, key: string): number {
    if (!raw || typeof raw !== "object") {
      throw new Error("Malformed webview message.");
    }
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new Error(`Invalid ${key}.`);
    }
    return value;
  }

  private requireRecord(raw: unknown, key: string): Record<string, SqliteValue> {
    if (!raw || typeof raw !== "object") {
      throw new Error("Malformed webview message.");
    }
    const value = (raw as Record<string, unknown>)[key];
    if (!value || typeof value !== "object") {
      throw new Error(`Invalid ${key}.`);
    }
    const record: Record<string, SqliteValue> = {};
    for (const [field, entry] of Object.entries(value)) {
      record[field] = this.normalizeValue(entry);
    }
    return record;
  }

  private optionalRecord(
    raw: unknown,
    key: string
  ): Record<string, SqliteValue> | undefined {
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) {
      return undefined;
    }
    if (!value || typeof value !== "object") {
      throw new Error(`Invalid ${key}.`);
    }
    const record: Record<string, SqliteValue> = {};
    for (const [field, entry] of Object.entries(value)) {
      record[field] = this.normalizeValue(entry);
    }
    return record;
  }

  private optionalString(raw: unknown, key: string): string | undefined {
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "string") {
      throw new Error(`Invalid ${key}.`);
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private normalizeValue(value: unknown): SqliteValue {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string" || typeof value === "number") {
      return value;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    return JSON.stringify(value);
  }

  private async initSqlJs(): Promise<SqlJsStatic> {
    const wasmPath = path.join(this.context.extensionPath, "media", "sql-wasm.wasm");
    return initSqlJs({ locateFile: () => wasmPath });
  }

  private async loadDatabase(dbPath: string): Promise<Database> {
    const sql = await this.sqlJs;
    const maxAttempts = 6;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const buffer = await fs.promises.readFile(dbPath);
        return new sql.Database(buffer);
      } catch (error) {
        lastError = error;

        if (!isTransientSqliteOpenError(error) || attempt === maxAttempts) {
          break;
        }

        await delay(250 * attempt);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to open SQLite database: ${String(lastError)}`);
  }

  private async saveDatabase(dbPath: string, db: Database): Promise<void> {
    const data = db.export();
    await fs.promises.writeFile(dbPath, Buffer.from(data));
  }

  private async getDatabaseInfo(
    dbPath: string,
    context?: SqliteUriContext
  ): Promise<SqliteDatabaseInfo> {
    const stats = await fs.promises.stat(dbPath);

    if (context?.remoteD1) {
      return {
        name: context.remoteD1.databaseName,
        path: dbPath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        displayName: `Remote D1: ${context.remoteD1.databaseName}`,
        locationLabel: `Database ID: ${context.remoteD1.databaseId}`,
        source: "remote-d1",
      };
    }

    return {
      name: path.basename(dbPath),
      path: dbPath,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      source: "local",
    };
  }

  private async getTables(dbPath: string): Promise<SqliteTableInfo[]> {
    const db = await this.loadDatabase(dbPath);
    try {
      const results = db.exec(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
      );
      if (results.length === 0) {
        return [];
      }

      const tables = results[0].values.map((row) => {
        const type: "table" | "view" = row[1] === "view" ? "view" : "table";
        return { name: String(row[0]), type };
      });

      return tables.map((table) => {
        const quotedName = quoteIdentifier(table.name);
        const countResult = db.exec(`SELECT COUNT(*) as count FROM ${quotedName}`);
        const rowCount = countResult.length > 0 ? Number(countResult[0].values[0][0]) : 0;
        const columnsResult = db.exec(`PRAGMA table_info(${quotedName})`);
        const columnCount = columnsResult.length > 0 ? columnsResult[0].values.length : 0;
        return {
          name: table.name,
          type: table.type,
          rowCount,
          columnCount,
        };
      });
    } finally {
      db.close();
    }
  }

  private async getTableData(dbPath: string, tableName: string): Promise<SqliteTableData> {
    const db = await this.loadDatabase(dbPath);
    try {
      const quotedName = quoteIdentifier(tableName);
      const columnResult = db.exec(`PRAGMA table_info(${quotedName})`);
      const columns: SqliteColumnInfo[] = columnResult.length > 0
        ? columnResult[0].values.map((row) => ({
          cid: Number(row[0]),
          name: String(row[1]),
          type: String(row[2] ?? ""),
          notNull: Boolean(row[3]),
          defaultValue: row[4] === null ? null : (row[4] as string | number),
          primaryKey: Boolean(row[5]),
        }))
        : [];

      let dataResult:
        | Array<{ columns: string[]; values: Array<unknown[]> }>
        | undefined;
      let syntheticRowId = false;
      try {
        dataResult = db.exec(`SELECT rowid as _rowid_, * FROM ${quotedName} LIMIT 1000`);
      } catch (error) {
        if (!isMissingRowIdError(error)) {
          throw error;
        }
        syntheticRowId = true;
        dataResult = db.exec(`SELECT * FROM ${quotedName} LIMIT 1000`);
      }

      const rows = dataResult.length > 0
        ? dataResult[0].values.map((row, rowIndex) => {
          const obj: Record<string, SqliteValue> = {};
          dataResult[0].columns.forEach((col, idx) => {
            obj[col] = row[idx] as SqliteValue;
          });
          if (syntheticRowId) {
            obj._rowid_ = rowIndex + 1;
          }
          return obj;
        })
        : [];

      const countResult = db.exec(`SELECT COUNT(*) as count FROM ${quotedName}`);
      const rowCount = countResult.length > 0 ? Number(countResult[0].values[0][0]) : rows.length;

      return { columns, rows, rowCount };
    } finally {
      db.close();
    }
  }

  private async updateRow(
    dbPath: string,
    tableName: string,
    rowId: number,
    column: string,
    value: SqliteValue
  ): Promise<void> {
    const db = await this.loadDatabase(dbPath);
    try {
      const quotedTable = quoteIdentifier(tableName);
      const quotedColumn = quoteIdentifier(column);
      db.run(`UPDATE ${quotedTable} SET ${quotedColumn} = ? WHERE rowid = ?`, [value, rowId]);
      await this.saveDatabase(dbPath, db);
    } finally {
      db.close();
    }
  }

  private async deleteRow(dbPath: string, tableName: string, rowId: number): Promise<void> {
    const db = await this.loadDatabase(dbPath);
    try {
      const quotedTable = quoteIdentifier(tableName);
      db.run(`DELETE FROM ${quotedTable} WHERE rowid = ?`, [rowId]);
      await this.saveDatabase(dbPath, db);
    } finally {
      db.close();
    }
  }

  private async insertRow(
    dbPath: string,
    tableName: string,
    values: Record<string, SqliteValue>
  ): Promise<void> {
    const db = await this.loadDatabase(dbPath);
    try {
      const entries = Object.entries(values).filter(([, value]) => value !== undefined);
      if (entries.length === 0) {
        return;
      }

      const columns = entries.map(([key]) => quoteIdentifier(key)).join(", ");
      const placeholders = entries.map(() => "?").join(", ");
      const params = entries.map(([, value]) => value ?? null);
      const quotedTable = quoteIdentifier(tableName);

      db.run(`INSERT INTO ${quotedTable} (${columns}) VALUES (${placeholders})`, params);
      await this.saveDatabase(dbPath, db);
    } finally {
      db.close();
    }
  }

  private async executeQuery(
    dbPath: string,
    query: string
  ): Promise<Array<Record<string, SqliteValue>> | { message: string }> {
    const db = await this.loadDatabase(dbPath);
    try {
      const results = db.exec(query);
      if (results.length === 0) {
        await this.saveDatabase(dbPath, db);
        return { message: "Query executed successfully" };
      }

      const rows = results[0].values.map((row) => {
        const obj: Record<string, SqliteValue> = {};
        results[0].columns.forEach((col, idx) => {
          obj[col] = row[idx] as SqliteValue;
        });
        return obj;
      });

      await this.saveDatabase(dbPath, db);
      return rows;
    } finally {
      db.close();
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "sqlite-editor.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "sqlite-editor.css")
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>SQLite Visual Editor</title>
  <link href="${styleUri}" rel="stylesheet" />
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async refreshRemoteD1Snapshot(
    remote: NonNullable<SqliteUriContext["remoteD1"]>
  ): Promise<void> {
    await materializeRemoteD1Database({
      databaseId: remote.databaseId,
      databaseName: remote.databaseName,
      forceRefresh: true,
    });
  }
}

class SqliteDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri) {}
  dispose(): void {}
}

type SqliteUriContext = {
  remoteD1?: {
    databaseId: string;
    databaseName: string;
  };
};

function parseUriContext(uri: vscode.Uri): SqliteUriContext | undefined {
  if (!uri.query) {
    return undefined;
  }

  const query = new URLSearchParams(uri.query);
  if (query.get("cbeRemoteD1") !== "1") {
    return undefined;
  }

  const databaseId = (query.get("cbeRemoteD1Id") || "").trim();
  const databaseName = (query.get("cbeRemoteD1Name") || "").trim();
  if (!databaseId || !databaseName) {
    return undefined;
  }

  return {
    remoteD1: {
      databaseId,
      databaseName,
    },
  };
}

function isTransientSqliteOpenError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error || "")
  ).toLowerCase();

  return (
    message.includes("malformed") ||
    message.includes("disk image is malformed") ||
    message.includes("not a database") ||
    message.includes("unable to open database file")
  );
}

function isMissingRowIdError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error || "")
  ).toLowerCase();
  return message.includes("no such column: rowid");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSqlLiteral(value: SqliteValue): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (value instanceof Uint8Array) {
    const bytes = Array.from(value)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `X'${bytes}'`;
  }

  const text = String(value).replace(/'/g, "''");
  return `'${text}'`;
}

function isMutatingSqlQuery(sql: string): boolean {
  const statement = sql.trim().toLowerCase();
  return (
    statement.startsWith("insert ") ||
    statement.startsWith("update ") ||
    statement.startsWith("delete ") ||
    statement.startsWith("create ") ||
    statement.startsWith("drop ") ||
    statement.startsWith("alter ") ||
    statement.startsWith("replace ")
  );
}

function normalizeSqliteRowValues(
  row: Record<string, unknown>
): Record<string, SqliteValue> {
  const normalized: Record<string, SqliteValue> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizeSqliteValue(value);
  }
  return normalized;
}

function normalizeSqliteValue(value: unknown): SqliteValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return JSON.stringify(value);
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildRemoteRowPredicate(
  rowIdentity?: Record<string, SqliteValue>
): string | undefined {
  if (!rowIdentity) {
    return undefined;
  }

  const entries = Object.entries(rowIdentity)
    .filter(([column]) => column.trim().length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return undefined;
  }

  return entries
    .map(([column, value]) => {
      const quotedColumn = quoteIdentifier(column);
      if (value === null || value === undefined) {
        return `${quotedColumn} IS NULL`;
      }
      return `${quotedColumn} = ${toSqlLiteral(value)}`;
    })
    .join(" AND ");
}
