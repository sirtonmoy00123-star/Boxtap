import { describe, it, expect } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { pack, unpack } from './pack';
import { exportSnapshot, validateImport, ImportRejectedError } from './snapshot';
import { migrate, type SqlDb } from '../db/migrate';
import { SCHEMA_VERSION } from '../db/schema';
import * as R from '../repo';

const sqlite3 = await sqlite3InitModule();

function liveDb() {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  migrate(db as unknown as SqlDb);
  const ctx = { db: db as unknown as SqlDb, now: () => '2026-11-25T00:00:00.000Z' };
  const ws = R.createWorkspace(ctx, { type: 'home', name: 'Move', country: 'AU', currency: 'AUD', language: 'en' });
  const box = R.createBox(ctx, ws.id, { name: 'Kitchen' });
  R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Kettle' });
  db.exec(`INSERT INTO meta (key,value) VALUES ('install_id','dev-1'),('device_hint','Mia phone')`);
  db.exec(`INSERT INTO time_guard (id,max_seen_at) VALUES (1,'2026-11-25T00:00:00Z')`);
  db.exec(`INSERT INTO drive_link (id,google_email,folder_id,device_id,key_id,connected_at) VALUES (1,'a@b.c','f1','d1','bk_1','x')`);
  return db;
}

describe('pack (backup container)', () => {
  it('round-trips named entries', async () => {
    const files = [{ name: 'db.sqlite', data: new Uint8Array([1, 2, 3]) }, { name: 'photos/a.webp', data: new Uint8Array(70000).fill(7) }];
    const out: Uint8Array[] = [];
    for await (const c of pack(files)) out.push(c);
    const got = await unpack(await new Blob(out.map((c) => new Uint8Array(c))).bytes());
    expect(got.map((f) => f.name)).toEqual(['db.sqlite', 'photos/a.webp']);
    expect(got[1]!.data).toEqual(files[1]!.data);
  });
  it('rejects path tricks in names', async () => {
    const out: Uint8Array[] = [];
    for await (const c of pack([{ name: '../evil', data: new Uint8Array(1) }])) out.push(c);
    await expect(unpack(await new Blob(out.map((c) => new Uint8Array(c))).bytes())).rejects.toThrow(/name/);
  });
});

describe('snapshot export and import validation', () => {
  it('empties device-local tables and device fields in the copy (audit A5/B6)', () => {
    const db = liveDb();
    const snap = exportSnapshot(sqlite3, db);
    const copy = validateImport(sqlite3, snap);
    const check = new sqlite3.oo1.DB(':memory:', 'c');
    const p = sqlite3.wasm.allocFromTypedArray(copy.bytes);
    check.checkRc(sqlite3.capi.sqlite3_deserialize(check, 'main', p, copy.bytes.length, copy.bytes.length, sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE));
    expect(check.selectValue('SELECT count(*) FROM drive_link')).toBe(0);
    expect(check.selectValue('SELECT count(*) FROM time_guard')).toBe(0);
    expect(check.selectValue(`SELECT count(*) FROM meta WHERE key IN ('install_id','device_hint')`)).toBe(0);
    expect(check.selectValue('SELECT name FROM items')).toBe('Kettle');
    expect(copy.counts).toEqual({ boxes: 1, items: 1 });
  });

  it('refuses a file that is not SQLite', () => {
    expect(() => validateImport(sqlite3, new TextEncoder().encode('hello world, not a database at all'))).toThrow(ImportRejectedError);
  });

  it('refuses a database from a newer schema version', () => {
    const db = liveDb();
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => validateImport(sqlite3, exportSnapshot(sqlite3, db))).toThrow(/newer/);
  });

  it('refuses a database that brings its own trigger (untrusted schema, audit B6)', () => {
    const db = liveDb();
    db.exec(`CREATE TRIGGER evil AFTER INSERT ON items BEGIN DELETE FROM locations; END;`);
    expect(() => validateImport(sqlite3, exportSnapshot(sqlite3, db))).toThrow(/schema/);
  });

  it('repairs stock totals that disagree with the ledger (DATABASE_SCHEMA §5.2)', () => {
    const db = liveDb();
    db.exec(`DROP TRIGGER sm_apply`);
    const itemId = String(db.selectValue('SELECT id FROM items'));
    const wsId = String(db.selectValue('SELECT id FROM workspaces'));
    db.exec(`INSERT INTO stock_movements (id,workspace_id,item_id,on_hand_delta,reason,happened_at) VALUES ('m1','${wsId}','${itemId}',5,'opening','x')`);
    // Recreate the trigger so the schema matches again; the cached total is now wrong (0 instead of 5).
    db.exec(`CREATE TRIGGER sm_apply AFTER INSERT ON stock_movements BEGIN
  UPDATE items SET on_hand = on_hand + NEW.on_hand_delta,
                   reserved = reserved + NEW.reserved_delta,
                   updated_at = max(updated_at, NEW.happened_at)
   WHERE id = NEW.item_id;
END`);
    const r = validateImport(sqlite3, exportSnapshot(sqlite3, db));
    expect(r.ledgerRepaired).toBe(1);
  });
});
