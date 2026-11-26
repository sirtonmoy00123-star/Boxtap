// Schema v6 (Removalist): the v5 -> v6 rebuild migration, and the protection triggers (plan §4.3, §4.4).
import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { rawTestDb, openTestDb, type TestDb } from './testDb';
import { applyMigration, MIGRATIONS, SCHEMA_VERSION } from './schema';
import { migrate, type SqlDb } from './migrate';
import { v6, V6_TRIGGERS } from './schemaV6';
import * as R from '../repo';
import { exportSnapshot, validateImport, ImportRejectedError } from '../backup/snapshot';

const T0 = '2026-11-25T00:00:00.000Z';
const sha = (c: string) => c.repeat(64).slice(0, 64);

/** A database at exactly v5, as a phone running the previous build has it (foreign keys on). */
async function v5Db(given?: TestDb): Promise<TestDb> {
  const db = given ?? await rawTestDb();
  db.exec('PRAGMA foreign_keys = ON');
  for (let v = 0; v < 5; v++) {
    db.transaction(() => { applyMigration(db, v); db.exec(`PRAGMA user_version = ${v + 1}`); });
  }
  return db;
}

/** Fills a v5 database with Home and Seller data: boxes, items, photos, ledger, orders, variants, labels, bin. */
function seedV5(db: TestDb) {
  const ctx: R.Ctx = { db: db as unknown as SqlDb, now: () => T0 };
  const home = R.createWorkspace(ctx, { type: 'home', name: 'Our move', country: 'AU', currency: 'AUD', language: 'en' });
  const room = R.createRoom(ctx, home.id, 'Kitchen');
  const b1 = R.createBox(ctx, home.id, { name: 'Pots', roomId: room.id, isFragile: true, moveStatus: 'packed' });
  const b2 = R.createBox(ctx, home.id, { name: 'Books' });
  R.addItem(ctx, { workspaceId: home.id, locationId: b1.id, name: 'Kettle', valueEstimateMinor: 4500 });
  R.addPhoto(ctx, { workspaceId: home.id, locationId: b1.id, itemId: null, mime: 'image/webp', bytes: 1200, sha256: sha('a') });
  R.deleteBox(ctx, b2.id);
  R.createSpareLabels(ctx, home.id, 2);

  const shop = R.createWorkspace(ctx, { type: 'seller', name: 'Shop', country: 'BD', currency: 'BDT', language: 'bn' });
  const shelf = R.createBox(ctx, shop.id, { name: 'Shelf A' });
  const ring = R.addItem(ctx, { workspaceId: shop.id, locationId: shelf.id, name: 'Gold ring', salePriceMinor: 99900 });
  R.recordStock(ctx, ring.id, 'restock', 10);
  R.recordStock(ctx, ring.id, 'sold', 2);
  const v = R.addVariant(ctx, ring.id, 'Size 7');
  R.recordStock(ctx, v.id, 'restock', 3);
  const order = R.createOrder(ctx, shop.id, { customer: 'Rahim', phone: '01700000000' });
  R.addOrderLine(ctx, order.id, ring.id, 1);
  R.addPhoto(ctx, { workspaceId: shop.id, locationId: null, itemId: ring.id, mime: 'image/jpeg', bytes: 900, sha256: sha('b') });
  db.exec(`INSERT INTO entitlements (id,source,plan,starts_at,ends_at,verified_at,raw_signed) VALUES ('lk_1','licence_key','seller_pro','2026-11-01','2026-12-01','${T0}','BTK1.x.y')`);
  return { home, shop, ring };
}

const tables = (db: TestDb) => db.selectValues(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'item_search%' ORDER BY name`).map(String);
const cols = (db: TestDb, t: string) => db.selectValues(`SELECT name FROM pragma_table_info('${t}') ORDER BY cid`).map(String);
function dump(db: TestDb, only?: Map<string, string[]>) {
  const out: Record<string, unknown[]> = {};
  for (const t of only ? [...only.keys()] : tables(db)) {
    const c = only?.get(t) ?? cols(db, t);
    out[t] = db.selectArrays(`SELECT ${c.map((x) => `"${x}"`).join(',')} FROM "${t}" ORDER BY ${c.map((x) => `"${x}"`).join(',')}`);
  }
  return out;
}
const triggerSql = (db: TestDb) => Object.fromEntries(db.selectArrays(`SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name`) as [string, string][]);

describe('v5 -> v6 migration (plan §4.4)', () => {
  it('keeps every row and every column value of a full v5 database', async () => {
    const db = await v5Db();
    seedV5(db);
    const before = new Map(tables(db).map((t) => [t, cols(db, t)]));
    const data = dump(db, before);
    const trig = triggerSql(db);
    const ledger = db.selectArrays(`SELECT id, on_hand, reserved FROM items ORDER BY id`);
    const search = db.selectArrays(`SELECT item_id, name, location_label FROM item_search ORDER BY item_id`);

    expect(migrate(db as unknown as SqlDb)).toBe(5);
    expect(db.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION);

    expect(dump(db, before)).toEqual(data);
    expect(db.selectArrays(`SELECT id, on_hand, reserved FROM items ORDER BY id`)).toEqual(ledger);
    expect(db.selectArrays(`SELECT item_id, name, location_label FROM item_search ORDER BY item_id`)).toEqual(search);
    expect(db.selectValue('SELECT count(*) FROM pragma_foreign_key_check')).toBe(0);
    expect(db.selectValue('PRAGMA foreign_keys')).toBe(1);
    expect(db.selectValue('PRAGMA integrity_check')).toBe('ok');
    // Old triggers are all there, with the same SQL (sm_no_delete and ws_no_live_delete were dropped and re-created).
    const after = triggerSql(db);
    for (const [name, sql] of Object.entries(trig)) expect(after[name]).toBe(sql);
    // New columns have their defaults.
    expect(db.selectValues(`SELECT DISTINCT is_piece FROM locations`)).toEqual([0]);
    expect(db.selectValue(`SELECT count(*) FROM locations WHERE job_id IS NOT NULL OR job_seq IS NOT NULL OR volume_item_id IS NOT NULL`)).toBe(0);
    expect(db.selectValue(`SELECT count(*) FROM rooms WHERE job_id IS NOT NULL`)).toBe(0);
  });

  it('old rules still work after the migration (ledger append-only, live workspace delete guard, new types allowed)', async () => {
    const db = await v5Db();
    const { shop } = seedV5(db);
    migrate(db as unknown as SqlDb);
    expect(() => db.exec(`UPDATE stock_movements SET note='x'`)).toThrow(/ledger_is_append_only/);
    expect(() => db.exec(`DELETE FROM stock_movements`)).toThrow(/ledger_is_append_only/);
    expect(() => db.exec(`DELETE FROM workspaces WHERE id='${shop.id}'`)).toThrow(/soft_deleted_first/);
    expect(db.selectValue(`SELECT count(*) FROM stock_movements`)).toBeGreaterThan(0);
    db.exec(`INSERT INTO workspaces (id,type,name,country,currency,created_at,updated_at) VALUES ('r1','removalist','Movers','AU','AUD','${T0}','${T0}')`);
    db.exec(`INSERT INTO entitlements (id,source,plan,starts_at,ends_at,verified_at,raw_signed) VALUES ('lk_2','licence_key','removalist_pro','a','b','c','d')`);
    expect(() => db.exec(`INSERT INTO workspaces (id,type,name,country,currency,created_at,updated_at) VALUES ('x','office','X','AU','AUD','${T0}','${T0}')`)).toThrow(/CHECK/);
  });

  it('the same rebuild with foreign keys ON would cascade-delete the data; migrate() does not', async () => {
    const naive = await v5Db();
    seedV5(naive);
    expect(naive.selectValue('SELECT count(*) FROM locations')).toBeGreaterThan(0);
    // What a plain migration inside a transaction would do (SQLite ignores foreign_keys=OFF inside one).
    naive.transaction(() => v6(naive as unknown as Parameters<typeof v6>[0]));
    expect(naive.selectValue('SELECT count(*) FROM workspaces')).toBe(2);
    expect(naive.selectValue('SELECT count(*) FROM locations')).toBe(0);
    expect(naive.selectValue('SELECT count(*) FROM stock_movements')).toBe(0);

    const safe = await v5Db();
    seedV5(safe);
    const boxes = safe.selectValue('SELECT count(*) FROM locations');
    migrate(safe as unknown as SqlDb);
    expect(safe.selectValue('SELECT count(*) FROM locations')).toBe(boxes);
    expect(safe.selectValue('SELECT count(*) FROM stock_movements')).toBeGreaterThan(0);
  });

  it('a v6 migration that fails part-way changes nothing and leaves foreign keys on', async () => {
    const db = await v5Db();
    seedV5(db);
    const before = new Map(tables(db).map((t) => [t, cols(db, t)]));
    const data = dump(db, before);
    db.exec('CREATE TABLE trucks (x)'); // makes v6's CREATE TABLE trucks fail after workspaces was rebuilt
    expect(() => migrate(db as unknown as SqlDb)).toThrow(/trucks/);
    expect(db.selectValue('PRAGMA user_version')).toBe(5);
    expect(db.selectValue('PRAGMA foreign_keys')).toBe(1);
    expect(dump(db, before)).toEqual(data);
    expect(String(db.selectValue(`SELECT sql FROM sqlite_master WHERE name='workspaces'`))).toContain(`'home','seller')`);
  });

  it('a fresh v6 database and a migrated v5 one have the same schema', async () => {
    const fresh = await openTestDb();
    const old = await v5Db();
    migrate(old as unknown as SqlDb);
    const schema = (d: TestDb) => d.selectValues(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name`).map(String);
    expect(schema(old)).toEqual(schema(fresh));
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(6);
  });

  it('a v5 backup restores into v6 with its data', async () => {
    const sqlite3 = await sqlite3InitModule();
    const db = await v5Db(new sqlite3.oo1.DB(':memory:', 'c') as unknown as TestDb);
    seedV5(db);
    const bytes = sqlite3.capi.sqlite3_js_db_export(db);
    const v = validateImport(sqlite3, bytes);
    expect(v.fromVersion).toBe(5);
    expect(v.counts.boxes).toBe(2); // one Home box is in the Bin
  });
});

// ---------------------------------------------------------------------------------------------------

let db: TestDb;
let clock: string;
let ctx: R.Ctx;
beforeEach(async () => {
  db = await openTestDb();
  clock = T0;
  ctx = { db: db as unknown as SqlDb, now: () => clock };
});

/** A Removalist job with one piece, a pickup condition record with a photo, and a second piece. */
function jobWithCondition() {
  const ws = R.createRemovalistWorkspace(ctx, { language: 'en', country: 'AU', volumeUnit: 'm3', name: 'Fast Movers', phone: '0400 000 000' });
  const job = R.createJob(ctx, ws.id, { customerName: 'Ayesha Khan' });
  const piece = R.createBox(ctx, ws.id, { name: 'Sofa' });
  const other = R.createBox(ctx, ws.id, { name: 'Box' });
  db.exec(`UPDATE locations SET job_id='${job.id}', is_piece=1, job_seq=1 WHERE id='${piece.id}'`);
  db.exec(`UPDATE locations SET job_id='${job.id}', is_piece=0, job_seq=1 WHERE id='${other.id}'`);
  const photo = R.addPhoto(ctx, { workspaceId: ws.id, locationId: piece.id, itemId: null, mime: 'image/webp', bytes: 1000, sha256: sha('c') });
  db.exec(`INSERT INTO condition_records (id,workspace_id,job_id,location_id,stage,tags,created_at) VALUES ('cr1','${ws.id}','${job.id}','${piece.id}','pickup','["scratched"]','${T0}')`);
  db.exec(`INSERT INTO condition_photos (photo_id,record_id,captured_at,source,sha256) VALUES ('${photo.id}','cr1','${T0}','camera','${sha('c')}')`);
  const lock = () => db.exec(`INSERT INTO stage_locks (job_id,stage,locked_at,report_hash) VALUES ('${job.id}','pickup','${T0}','${sha('d')}')`);
  return { ws, job, piece, other, photo, lock };
}

describe('v6 protection triggers (plan §4.3)', () => {
  it('all v6 triggers exist', () => {
    const names = db.selectValues(`SELECT name FROM sqlite_master WHERE type='trigger'`).map(String);
    expect(V6_TRIGGERS.length).toBeGreaterThanOrEqual(17);
    for (const t of V6_TRIGGERS) expect(names).toContain(t);
  });

  it('job_events cannot be updated or deleted while the job is live', () => {
    const { ws, job, piece } = jobWithCondition();
    db.exec(`INSERT INTO job_events (id,workspace_id,job_id,location_id,event,direction,at) VALUES ('e1','${ws.id}','${job.id}','${piece.id}','loaded','load','${T0}')`);
    expect(() => db.exec(`UPDATE job_events SET note='x'`)).toThrow(/job_events_append_only/);
    expect(() => db.exec(`DELETE FROM job_events`)).toThrow(/job_events_append_only/);
    expect(() => db.exec(`DELETE FROM jobs WHERE id='${job.id}'`)).toThrow(/job_must_be_binned_first/);
    expect(db.selectValue('SELECT count(*) FROM job_events')).toBe(1);
  });

  it('a locked condition record and its photo cannot change; amendments can be added', () => {
    const { ws, job, piece, photo, lock } = jobWithCondition();
    lock();
    expect(() => db.exec(`UPDATE condition_records SET note='changed' WHERE id='cr1'`)).toThrow(/stage_locked/);
    expect(() => db.exec(`DELETE FROM condition_records WHERE id='cr1'`)).toThrow(/stage_locked/);
    expect(() => db.exec(`UPDATE condition_photos SET source='library'`)).toThrow(/stage_locked/);
    expect(() => db.exec(`DELETE FROM condition_photos`)).toThrow(/stage_locked/);
    expect(() => db.exec(`DELETE FROM photos WHERE id='${photo.id}'`)).toThrow(/stage_locked/);
    expect(() => db.exec(`UPDATE photos SET deleted_at='${T0}' WHERE id='${photo.id}'`)).toThrow(/stage_locked/);
    expect(() => db.exec(`UPDATE photos SET sha256='${sha('e')}' WHERE id='${photo.id}'`)).toThrow(/stage_locked/);
    expect(() => db.exec(`UPDATE stage_locks SET customer_refused=1`)).toThrow(/stage_locked/);
    expect(() => db.exec(`DELETE FROM stage_locks`)).toThrow(/stage_locked/);
    // A plain new record in the locked stage is refused; an amendment with a note is accepted, and can carry a photo.
    const ins = (id: string, amend: number, note: string | null) => db.exec(`INSERT INTO condition_records (id,workspace_id,job_id,location_id,stage,note,is_amendment,created_at)
      VALUES ('${id}','${ws.id}','${job.id}','${piece.id}','pickup',${note == null ? 'NULL' : `'${note}'`},${amend},'${T0}')`);
    expect(() => ins('cr2', 0, 'new')).toThrow(/stage_locked_amend_only/);
    ins('cr3', 1, 'Scratch found on the left arm');
    const p2 = R.addPhoto(ctx, { workspaceId: ws.id, locationId: piece.id, itemId: null, mime: 'image/webp', bytes: 1000, sha256: sha('f') });
    db.exec(`INSERT INTO condition_photos (photo_id,record_id,captured_at,source,sha256) VALUES ('${p2.id}','cr3','${T0}','camera','${sha('f')}')`);
    const p3 = R.addPhoto(ctx, { workspaceId: ws.id, locationId: piece.id, itemId: null, mime: 'image/webp', bytes: 1000, sha256: sha('9') });
    expect(() => db.exec(`INSERT INTO condition_photos (photo_id,record_id,captured_at,source,sha256) VALUES ('${p3.id}','cr1','${T0}','camera','${sha('9')}')`)).toThrow(/stage_locked_amend_only/);
    // The delivery stage is not locked: it stays editable.
    db.exec(`INSERT INTO condition_records (id,workspace_id,job_id,location_id,stage,created_at) VALUES ('cr4','${ws.id}','${job.id}','${piece.id}','delivery','${T0}')`);
    db.exec(`UPDATE condition_records SET note='ok' WHERE id='cr4'`);
  });

  it('Drive sync columns of a locked photo stay writable (backups keep working)', () => {
    const { photo, lock } = jobWithCondition();
    lock();
    R.setPhotoDriveRef(ctx, photo.id, 'ref-1', 'file-1');
    db.exec(`UPDATE photos SET drive_file_id='file-2', updated_at='${T0}' WHERE id='${photo.id}'`);
    expect(db.selectValue(`SELECT drive_file_id FROM photos WHERE id='${photo.id}'`)).toBe('file-2');
  });

  it('a signed job can only be archived; its boxes and pieces cannot be binned or moved', () => {
    const { job, piece, other, lock } = jobWithCondition();
    lock();
    expect(() => R.binJob(ctx, job.id)).toThrow(R.JobSignedError);
    expect(() => db.exec(`UPDATE jobs SET deleted_at='${T0}' WHERE id='${job.id}'`)).toThrow(/job_signed_archive_only/);
    expect(() => R.deleteBox(ctx, other.id)).toThrow(/job_signed_archive_only/);
    expect(() => db.exec(`UPDATE locations SET job_id=NULL WHERE id='${piece.id}'`)).toThrow(/job_signed_archive_only/);
    expect(() => db.exec(`DELETE FROM locations WHERE id='${piece.id}'`)).toThrow(/job_signed_archive_only/);
    R.archiveJob(ctx, job.id, true);
    expect(R.getJob(ctx, job.id)?.archivedAt).toBe(T0);
  });

  it('Erase all data still works with locked records, photos, events and sign-offs', () => {
    const { ws, job, piece, lock } = jobWithCondition();
    lock();
    db.exec(`INSERT INTO signoffs (id,job_id,stage,signer_role,signer_name,signed_at,report_hash) VALUES ('s1','${job.id}','pickup','customer','A Khan','${T0}','${sha('d')}')`);
    db.exec(`INSERT INTO job_events (id,workspace_id,job_id,location_id,event,direction,at) VALUES ('e1','${ws.id}','${job.id}','${piece.id}','loaded','load','${T0}')`);
    const files = R.eraseAll(ctx);
    expect(files.length).toBe(2);
    for (const t of ['workspaces', 'jobs', 'locations', 'photos', 'condition_records', 'condition_photos', 'stage_locks', 'signoffs', 'job_events', 'business_profile', 'volume_catalogue']) {
      expect(db.selectValue(`SELECT count(*) FROM ${t}`)).toBe(0);
    }
  });

  it('the Bin purge skips lock-protected photos and still purges everything else', () => {
    const { ws, photo, lock } = jobWithCondition();
    lock();
    // A binned photo in a live Home list, and an unrelated binned box in the Removalist workspace.
    const box = R.createBox(ctx, ws.id, { name: 'Spare' });
    R.addPhoto(ctx, { workspaceId: ws.id, locationId: box.id, itemId: null, mime: 'image/webp', bytes: 10, sha256: sha('1') });
    R.deleteBox(ctx, box.id);
    clock = '2027-01-30T00:00:00.000Z';
    const r = R.purgeBin(ctx);
    expect(r.boxes).toBe(1);
    expect(r.photos).toBe(1);
    expect(db.selectValue(`SELECT count(*) FROM photos WHERE id='${photo.id}'`)).toBe(1);
  });
});

describe('restore check covers the v6 triggers', () => {
  it('refuses a backup with a new trigger removed', async () => {
    const sqlite3 = await sqlite3InitModule();
    const live = new sqlite3.oo1.DB(':memory:', 'c');
    migrate(live as unknown as SqlDb);
    const lctx: R.Ctx = { db: live as unknown as SqlDb, now: () => T0 };
    R.createRemovalistWorkspace(lctx, { language: 'en', country: 'AU', volumeUnit: 'm3', name: 'Movers', phone: '1' });
    expect(validateImport(sqlite3, exportSnapshot(sqlite3, live)).counts.boxes).toBe(0);
    for (const name of ['job_events_no_update', 'photos_locked_update', 'jobs_locked_no_bin']) {
      const copy = new sqlite3.oo1.DB(':memory:', 'c');
      const bytes = sqlite3.capi.sqlite3_js_db_export(live);
      const p = sqlite3.wasm.allocFromTypedArray(bytes);
      copy.checkRc(sqlite3.capi.sqlite3_deserialize(copy, 'main', p, bytes.length, bytes.length, sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE));
      copy.exec(`DROP TRIGGER ${name}`);
      expect(() => validateImport(sqlite3, sqlite3.capi.sqlite3_js_db_export(copy))).toThrow(ImportRejectedError);
      copy.close();
    }
  });
});
