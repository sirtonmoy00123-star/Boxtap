// Test helper: an in-memory SQLite (same WASM build as the browser) with the schema applied.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { migrate, type SqlDb } from './migrate';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
let sqlite3: Promise<Sqlite3> | undefined;

export type TestDb = InstanceType<Sqlite3['oo1']['DB']>;

export async function rawTestDb(): Promise<TestDb> {
  sqlite3 ??= sqlite3InitModule();
  const s = await sqlite3;
  return new s.oo1.DB(':memory:', 'c');
}

export async function openTestDb(): Promise<TestDb> {
  const db = await rawTestDb();
  migrate(db as unknown as SqlDb);
  return db;
}
