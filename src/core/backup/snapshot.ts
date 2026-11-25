// Consistent database copies for backups, and validation of untrusted copies before restore.
// API_CONTRACTS §6.1 (A5/B6) and §6.2 rule 4.
import type sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { applyMigration, SCHEMA_VERSION } from '../db/schema';
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
  // Tables compare by their columns (name, type, not-null, default, key), because the same table can be stored as
  // different CREATE text (a column added by ALTER vs inline). Triggers, indexes and views compare by exact SQL.
  return db.selectObjects(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT IN ('sqlite_sequence','sqlite_stat1','sqlite_stat4') ORDER BY type, name`)
    .map((r) => {
      const isPlainTable = r.type === 'table' && !/^\s*CREATE\s+VIRTUAL/i.test(String(r.sql ?? ''));
      if (!isPlainTable) return `${r.type}|${r.name}|${r.tbl_name}|${norm(r.sql)}`;
      const cols = db.selectObjects(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?) ORDER BY name`, [String(r.name)])
        .map((c) => `${c.name}:${norm(c.type)}:${c.notnull}:${norm(c.dflt_value)}:${c.pk}`).join(',');
      return `table|${r.name}|${cols}`;
    });
}

function referenceSchema(sqlite3: Sqlite3, version: number, extra?: (ref: DB) => void): string[] {
  const ref = new sqlite3.oo1.DB(':memory:', 'c');
  try {
    for (let v = 0; v < version; v++) applyMigration(ref, v);
    extra?.(ref);
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
    const got = schemaOf(db);
    const same = (want: string[]) => want.length === got.length && want.every((w, i) => w === got[i]);
    // v1 also existed with photos.drive_file_id inline (a build on 2026-11-25; review finding 6).
    const variants = [referenceSchema(sqlite3, version)];
    if (version === 1) variants.push(referenceSchema(sqlite3, 1, (ref) => ref.exec('ALTER TABLE photos ADD COLUMN drive_file_id TEXT')));
    if (!variants.some(same)) throw new ImportRejectedError('unexpected database schema');
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
