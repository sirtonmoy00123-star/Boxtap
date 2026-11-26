import { applyMigration, isRebuild, MIGRATIONS, PRAGMAS, SCHEMA_VERSION } from './schema';

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

export class MigrationBrokeLinksError extends Error { name = 'MigrationBrokeLinksError'; }

const brokenLinks = (db: SqlDb) => Number(db.selectValue('SELECT count(*) FROM pragma_foreign_key_check'));

/**
 * Runs pending migrations, each in its own transaction. Returns the version migrated from.
 * A rebuild step (schema.ts, Migration) runs with foreign keys OFF, set outside the transaction because SQLite
 * ignores the switch inside one; it commits only if it left no new broken link (foreign_key_check).
 */
export function migrate(db: SqlDb): number {
  applyPragmas(db);
  const from = Number(db.selectValue('PRAGMA user_version') ?? 0);
  if (from > SCHEMA_VERSION) throw new FutureSchemaError(from);
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const rebuild = isRebuild(MIGRATIONS[v]!);
    if (rebuild) db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.transaction((tx) => {
        const before = rebuild ? brokenLinks(tx) : 0;
        applyMigration(tx, v);
        if (rebuild && brokenLinks(tx) > before) throw new MigrationBrokeLinksError(`migration to v${v + 1} broke links; nothing was changed`);
        tx.exec(`PRAGMA user_version = ${v + 1}`);
      });
    } finally {
      if (rebuild) db.exec('PRAGMA foreign_keys = ON');
    }
  }
  return from;
}
