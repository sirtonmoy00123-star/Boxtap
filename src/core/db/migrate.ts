import { MIGRATIONS, PRAGMAS, SCHEMA_VERSION } from './schema';

/** Minimal surface of the sqlite-wasm oo1.DB used by core code (also satisfied by the OPFS pool DB). */
export interface SqlDb {
  exec(sql: string | { sql: string; bind?: unknown[] }): unknown;
  selectValue(sql: string, bind?: unknown[]): unknown;
  selectValues(sql: string, bind?: unknown[]): unknown[];
  selectObjects(sql: string, bind?: unknown[]): Record<string, unknown>[];
  transaction<T>(fn: (db: SqlDb) => T): T;
  savepoint<T>(fn: (db: SqlDb) => T): T;
  changes(): number;
}

export class FutureSchemaError extends Error {
  constructor(public readonly found: number) {
    super(`schema_version ${found} is newer than this app (${SCHEMA_VERSION}); update BoxTap first`);
  }
}

export function applyPragmas(db: SqlDb): void {
  db.exec(PRAGMAS);
}

/** Runs pending migrations, each in its own transaction. Returns the version migrated from. */
export function migrate(db: SqlDb): number {
  applyPragmas(db);
  const from = Number(db.selectValue('PRAGMA user_version') ?? 0);
  if (from > SCHEMA_VERSION) throw new FutureSchemaError(from);
  for (let v = from; v < SCHEMA_VERSION; v++) {
    db.transaction((tx) => {
      tx.exec(MIGRATIONS[v]!);
      tx.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return from;
}
