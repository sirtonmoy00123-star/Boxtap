/// <reference lib="webworker" />
// The only place SQLite runs in the browser (ADR-003). OPFS `opfs-sahpool` needs no COOP/COEP headers.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { migrate, type SqlDb } from './migrate';
import { SCHEMA_VERSION } from './schema';
import { createService, BlockedError, type Service } from '../service/service';
import { exportSnapshot, validateImport } from '../backup/snapshot';
import type { OpenInfo, Request, Response, RestoreResult } from './protocol';
import { DEFAULT_CONFIG } from '../licensing/can';
import type { Plan } from '../licensing/licence';

// Ruling (build): paid plans (licence keys) are skipped for now (owner, 2026-11-25). A build setting unlocks the
// paid features for testing; it must stay unset for real customers. Free limits apply otherwise.
const PREVIEW = import.meta.env.VITE_PREVIEW_PAID_PLANS === '1';
const entitlement = () => ({ config: DEFAULT_CONFIG, plans: new Set<Plan>(PREVIEW ? ['move_pass', 'seller_pro'] : []) });

declare const self: DedicatedWorkerGlobalScope;

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type DB = InstanceType<Sqlite3['oo1']['DB']>;
type Pool = Awaited<ReturnType<Sqlite3['installOpfsSAHPoolVfs']>>;

const DB_FILE = '/boxtap.sqlite3';
/** Present only while a validated restore is being swapped in; its presence at start means "finish it". */
const RESTORE_FILE = '/restore.sqlite3';
/** The database as it was before the last restore (API_CONTRACTS §6: safety backup first). Kept until the next restore. */
const SAFETY_FILE = '/before-restore.sqlite3';

/** Errors that mean another tab still holds the storage handles: retry, never fall back to memory (review finding 1). */
const isHandleBusy = (e: unknown) => ['NoModificationAllowedError', 'InvalidStateError'].includes((e as Error)?.name)
  || /access handle|locked|busy/i.test(String((e as Error)?.message));

function memoryDb(reason: unknown): DB {
  // Ruling (build, narrowed after review): only when OPFS itself cannot work here (no API, or the browser's
  // OPFS fails outright, as in Playwright's Windows WebKit). The UI shows the "can't store data" banner.
  console.warn('OPFS unavailable, using memory', reason);
  persistent = false;
  return new sqlite3!.oo1.DB(':memory:', 'c');
}

let sqlite3: Sqlite3 | undefined;
let pool: Pool | undefined;
let db: DB | undefined;
let service: Service | undefined;
let persistent = true;

function attach(handle: DB): number {
  db = handle;
  const from = migrate(handle as unknown as SqlDb);
  service = createService({ db: handle as unknown as SqlDb, now: () => new Date().toISOString() }, entitlement);
  return from;
}

async function open(allowMemory: boolean): Promise<OpenInfo> {
  sqlite3 ??= await sqlite3InitModule();
  let handle: DB | undefined;
  const hasOpfs = typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
  if (!hasOpfs) {
    handle = memoryDb('no OPFS API');
  } else if (!pool) {
    try {
      pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'boxtap-pool', initialCapacity: 12, preserveOnInitFailure: true });
      await pool.reserveMinimumCapacity(12); // live DB, journal, restore copy, safety copy (DATABASE_SCHEMA §2)
    } catch (e) {
      if (!allowMemory || isHandleBusy(e)) throw e; // another tab still holds the files: the caller retries
      handle = memoryDb(e);
    }
  } else {
    await pool.unpauseVfs();
  }
  if (!handle) {
    // Review finding 2: from here on, failures must surface. Falling back to memory would hide the real data.
    if (pool!.getFileNames().includes(RESTORE_FILE)) {
      // A restore was interrupted after validation: finish the swap (idempotent), then drop the marker file.
      await pool!.importDb(DB_FILE, pool!.exportFile(RESTORE_FILE));
      pool!.unlink(RESTORE_FILE);
    }
    handle = new pool!.OpfsSAHPoolDb(DB_FILE);
  }
  const migratedFrom = attach(handle);
  return { persistent, schemaVersion: SCHEMA_VERSION, migratedFrom, sqliteVersion: sqlite3.version.libVersion };
}

function close() {
  db?.close();
  db = undefined;
  service = undefined;
  pool?.pauseVfs(); // release the OPFS access handles so another tab can take over (audit B13a)
}

/** Crash-safe restore (API_CONTRACTS §6.2 rule 5): validate a copy, park it, swap, reopen. */
async function restore(bytes: Uint8Array): Promise<RestoreResult> {
  if (!sqlite3 || !db) throw new Error('database is not open');
  const v = validateImport(sqlite3, bytes);
  if (persistent && pool) {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota != null && est.usage != null && est.quota - est.usage < v.bytes.length * 3) {
      throw new Error('Free up space on this device to restore');
    }
    const safety = sqlite3.capi.sqlite3_js_db_export(db);
    await pool.importDb(SAFETY_FILE, safety); // review finding 4: keep what was there
    await pool.importDb(RESTORE_FILE, v.bytes); // marker: a crash from here on finishes the swap at next start
    db.close();
    db = undefined;
    service = undefined;
    try {
      await pool.importDb(DB_FILE, v.bytes);
      pool.unlink(RESTORE_FILE);
      attach(new pool.OpfsSAHPoolDb(DB_FILE));
    } catch (e) {
      // Review finding 9: put the previous database back and stay usable.
      pool.unlink(RESTORE_FILE);
      await pool.importDb(DB_FILE, safety);
      attach(new pool.OpfsSAHPoolDb(DB_FILE));
      throw e;
    }
  } else {
    const mem = new sqlite3.oo1.DB(':memory:', 'c');
    const p = sqlite3.wasm.allocFromTypedArray(v.bytes);
    mem.checkRc(sqlite3.capi.sqlite3_deserialize(mem, 'main', p, v.bytes.length, v.bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE));
    db.close(); // only after the new copy is ready
    attach(mem);
  }
  return { ...v.counts, fromVersion: v.fromVersion, ledgerRepaired: v.ledgerRepaired };
}

self.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  let res: Response;
  const transfer: Transferable[] = [];
  try {
    let value: unknown;
    switch (req.type) {
      case 'open': value = await open(req.allowMemory); break;
      case 'close': close(); break;
      case 'exportSnapshot': {
        if (!sqlite3 || !db) throw new Error('database is not open');
        const bytes = exportSnapshot(sqlite3, db);
        transfer.push(bytes.buffer as ArrayBuffer);
        value = bytes;
        break;
      }
      case 'restore': value = await restore(req.bytes); break;
      case 'call': {
        if (!service) throw new Error('database is not open');
        const fn = service[req.method] as (...a: unknown[]) => unknown;
        if (typeof fn !== 'function') throw new Error(`unknown method ${String(req.method)}`);
        value = fn(...req.args);
        break;
      }
    }
    res = { id: req.id, ok: true, value };
  } catch (e) {
    const err = e as Error;
    res = { id: req.id, ok: false, error: { name: err.name, message: err.message, reason: e instanceof BlockedError ? e.reason : undefined } };
  }
  self.postMessage(res, transfer);
};
