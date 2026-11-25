// Consistent database copies for backups, and validation of untrusted copies before restore.
// API_CONTRACTS §6.1 (A5/B6) and §6.2 rule 4.
import type sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { MIGRATIONS, SCHEMA_VERSION } from '../db/schema';
import { migrate, type SqlDb } from '../db/migrate';
import { repairLedger } from '../db/ledgerCheck';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type DB = InstanceType<Sqlite3['oo1']['DB']>;

export class ImportRejectedError extends Error { name = 'ImportRejectedError'; }

const DEVICE_LOCAL = `
  DELETE FROM drive_link; DELETE FROM drive_outbox; DELETE FROM backup_state; DELETE FROM time_guard;
  DELETE FROM meta WHERE key IN ('install_id','device_hint','restore_pending');`;

function deserialize(sqlite3: Sqlite3, bytes: Uint8Array): DB {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  const rc = sqlite3.capi.sqlite3_deserialize(db, 'main', p, bytes.length, bytes.length,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE);
  if (rc) {
    db.close();
    throw new ImportRejectedError('not a BoxTap database');
  }
  return db;
}

const exportBytes = (sqlite3: Sqlite3, db: DB): Uint8Array => sqlite3.capi.sqlite3_js_db_export(db);

/** A consistent copy of the live database with device-local rows removed. */
export function exportSnapshot(sqlite3: Sqlite3, live: DB): Uint8Array {
  const copy = deserialize(sqlite3, exportBytes(sqlite3, live));
  try {
    copy.exec(DEVICE_LOCAL);
    copy.exec('VACUUM');
    return exportBytes(sqlite3, copy);
  } finally {
    copy.close();
  }
}

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
function schemaOf(db: DB): string[] {
  // Every schema row counts (review finding 3): only SQLite's own bookkeeping tables are ignored, by exact name.
  return db.selectObjects(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT IN ('sqlite_sequence','sqlite_stat1','sqlite_stat4') ORDER BY type, name`)
    .map((r) => `${r.type}|${r.name}|${r.tbl_name}|${norm(r.sql)}`);
}

function referenceSchema(sqlite3: Sqlite3, version: number): string[] {
  const ref = new sqlite3.oo1.DB(':memory:', 'c');
  try {
    for (let v = 0; v < version; v++) ref.exec(MIGRATIONS[v]!);
    return schemaOf(ref);
  } finally {
    ref.close();
  }
}

export interface ValidatedImport {
  /** Migrated, checked database bytes ready to become the live database. */
  bytes: Uint8Array;
  fromVersion: number;
  counts: { boxes: number; items: number };
  ledgerRepaired: number;
}

/**
 * Validates an untrusted database copy: real SQLite, a known schema version, exactly the expected schema
 * for that version (so it cannot bring its own triggers), quick_check ok. Then migrates it, repairs the
 * ledger totals and removes device-local rows. Never touches the live database.
 */
export function validateImport(sqlite3: Sqlite3, bytes: Uint8Array): ValidatedImport {
  let db: DB;
  try {
    db = deserialize(sqlite3, bytes);
    db.exec('PRAGMA trusted_schema = OFF');
    db.selectValue('SELECT count(*) FROM sqlite_master');
  } catch (e) {
    if (e instanceof ImportRejectedError) throw e;
    throw new ImportRejectedError('not a BoxTap database');
  }
  try {
    const version = Number(db.selectValue('PRAGMA user_version'));
    if (version > SCHEMA_VERSION) throw new ImportRejectedError('this backup was made by a newer BoxTap; update BoxTap first');
    if (version < 1) throw new ImportRejectedError('not a BoxTap database');
    const want = referenceSchema(sqlite3, version);
    const got = schemaOf(db);
    if (want.length !== got.length || want.some((w, i) => w !== got[i])) throw new ImportRejectedError('unexpected database schema');
    if (db.selectValue('PRAGMA quick_check') !== 'ok') throw new ImportRejectedError('the backup database is damaged');
    if (db.selectValue('SELECT count(*) FROM pragma_foreign_key_check')) throw new ImportRejectedError('the backup database is damaged (broken links)');
    migrate(db as unknown as SqlDb);
    const ledgerRepaired = repairLedger(db as unknown as SqlDb);
    db.exec(DEVICE_LOCAL);
    const counts = {
      boxes: Number(db.selectValue('SELECT count(*) FROM locations WHERE deleted_at IS NULL')),
      items: Number(db.selectValue('SELECT count(*) FROM items WHERE deleted_at IS NULL')),
    };
    return { bytes: exportBytes(sqlite3, db), fromVersion: version, counts, ledgerRepaired };
  } finally {
    db.close();
  }
}
