/// <reference lib="webworker" />
// The only place SQLite runs in the browser (ADR-003). OPFS `opfs-sahpool` needs no COOP/COEP headers.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { migrate, type SqlDb } from './migrate';
import { SCHEMA_VERSION } from './schema';
import { createService, BlockedError, type Service } from '../service/service';
import type { OpenInfo, Request, Response } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const DB_FILE = '/boxtap.sqlite3';
let service: Service | undefined;
let db: { close(): void } | undefined;
let pool: { pauseVfs(): unknown } | undefined;

async function open(): Promise<OpenInfo> {
  const sqlite3 = await sqlite3InitModule();
  let handle;
  let persistent = true;
  try {
    const p = await sqlite3.installOpfsSAHPoolVfs({ name: 'boxtap-pool', initialCapacity: 12 });
    await p.reserveMinimumCapacity(12); // live DB, journal, VACUUM INTO target, safety copies (DATABASE_SCHEMA §2)
    pool = p;
    handle = new p.OpfsSAHPoolDb(DB_FILE);
  } catch (e) {
    // Ruling (build): no OPFS (old browser or some private windows). Run in memory and tell the UI,
    // which shows the "your boxes will be deleted" banner. The IndexedDB driver is a later addition.
    console.warn('OPFS unavailable, using memory', e);
    persistent = false;
    handle = new sqlite3.oo1.DB(':memory:', 'c');
  }
  db = handle;
  const migratedFrom = migrate(handle as unknown as SqlDb);
  service = createService({ db: handle as unknown as SqlDb, now: () => new Date().toISOString() });
  return { persistent, schemaVersion: SCHEMA_VERSION, migratedFrom, sqliteVersion: sqlite3.version.libVersion };
}

function close() {
  db?.close();
  db = undefined;
  service = undefined;
  pool?.pauseVfs(); // release the OPFS access handles so another tab can take over (audit B13a)
}

self.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  let res: Response;
  try {
    let value: unknown;
    if (req.type === 'open') value = await open();
    else if (req.type === 'close') value = close();
    else {
      if (!service) throw new Error('database is not open');
      const fn = service[req.method] as (...a: unknown[]) => unknown;
      if (typeof fn !== 'function') throw new Error(`unknown method ${String(req.method)}`);
      value = fn(...req.args);
    }
    res = { id: req.id, ok: true, value };
  } catch (e) {
    const err = e as Error;
    res = { id: req.id, ok: false, error: { name: err.name, message: err.message, reason: e instanceof BlockedError ? e.reason : undefined } };
  }
  self.postMessage(res);
};
