import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";

export interface ManualSqliteDatabase {
  id: string;
  label: string;
  dbPath: string;
  addedAt: string;
}

const STORAGE_KEY = "cloudflareBindingsExplorer.manualSqliteDatabases";

export function getManualSqliteDatabases(store: vscode.Memento): ManualSqliteDatabase[] {
  const entries = store.get<ManualSqliteDatabase[]>(STORAGE_KEY, []);
  return entries
    .filter((entry) => entry && typeof entry.dbPath === "string" && typeof entry.id === "string")
    .map((entry) => ({
      ...entry,
      dbPath: path.resolve(entry.dbPath),
      label: entry.label || path.basename(entry.dbPath),
    }));
}

export async function addManualSqliteDatabase(
  store: vscode.Memento,
  payload: { dbPath: string; label?: string }
): Promise<ManualSqliteDatabase> {
  const normalizedPath = path.resolve(payload.dbPath);
  const entries = getManualSqliteDatabases(store);
  const existing = entries.find((entry) => entry.dbPath === normalizedPath);

  if (existing) {
    if (payload.label && payload.label.trim()) {
      const updated = entries.map((entry) =>
        entry.id === existing.id
          ? { ...entry, label: payload.label!.trim() }
          : entry
      );
      await store.update(STORAGE_KEY, updated);
      return { ...existing, label: payload.label.trim() };
    }
    return existing;
  }

  const entry: ManualSqliteDatabase = {
    id: randomUUID(),
    label: payload.label?.trim() || path.basename(normalizedPath),
    dbPath: normalizedPath,
    addedAt: new Date().toISOString(),
  };

  await store.update(STORAGE_KEY, [...entries, entry]);
  return entry;
}

export async function removeManualSqliteDatabase(
  store: vscode.Memento,
  id: string
): Promise<boolean> {
  const entries = getManualSqliteDatabases(store);
  const nextEntries = entries.filter((entry) => entry.id !== id);
  if (nextEntries.length === entries.length) {
    return false;
  }
  await store.update(STORAGE_KEY, nextEntries);
  return true;
}

export function getManualSqliteDatabaseById(
  store: vscode.Memento,
  id: string
): ManualSqliteDatabase | undefined {
  return getManualSqliteDatabases(store).find((entry) => entry.id === id);
}
