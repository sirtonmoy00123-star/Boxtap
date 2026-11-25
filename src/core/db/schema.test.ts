import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from './testDb';
import { SCHEMA_VERSION } from './schema';

const now = '2026-11-25T00:00:00.000Z';

function seedWorkspace(db: TestDb, id = 'ws1', type = 'seller') {
  db.exec(`INSERT INTO workspaces (id,type,name,country,currency,created_at,updated_at)
           VALUES ('${id}','${type}','Test','BD','BDT','${now}','${now}')`);
  db.exec(`INSERT INTO locations (id,workspace_id,number,created_at,updated_at)
           VALUES ('loc-${id}','${id}',1,'${now}','${now}')`);
  db.exec(`INSERT INTO items (id,workspace_id,location_id,name,created_at,updated_at)
           VALUES ('it-${id}','${id}','loc-${id}','Gold ring','${now}','${now}')`);
}
function move(db: TestDb, id: string, item: string, onHand: number, reserved: number, reason: string, reverses: string | null = null) {
  db.exec(`INSERT INTO stock_movements (id,workspace_id,item_id,on_hand_delta,reserved_delta,reason,reverses_id,happened_at)
           VALUES ('${id}','ws1','${item}',${onHand},${reserved},'${reason}',${reverses ? `'${reverses}'` : 'NULL'},'${now}')`);
}
const onHand = (db: TestDb) => db.selectValue(`SELECT on_hand FROM items WHERE id='it-ws1'`);

describe('schema', () => {
  let db: TestDb;
  beforeEach(async () => { db = await openTestDb(); });

  it('sets user_version to the schema version', () => {
    expect(db.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION);
  });

  it('applies stock movements to item totals via trigger', () => {
    seedWorkspace(db);
    move(db, 'm1', 'it-ws1', 10, 0, 'opening');
    move(db, 'm2', 'it-ws1', -3, 0, 'sold');
    expect(onHand(db)).toBe(7);
  });

  it('rejects a sold movement with a positive delta', () => {
    seedWorkspace(db);
    expect(() => move(db, 'm1', 'it-ws1', 3, 0, 'sold')).toThrow(/CHECK/);
  });

  it('keeps the ledger append-only (no update, no delete)', () => {
    seedWorkspace(db);
    move(db, 'm1', 'it-ws1', 10, 0, 'opening');
    expect(() => db.exec(`UPDATE stock_movements SET note='x'`)).toThrow(/ledger_is_append_only/);
    expect(() => db.exec(`DELETE FROM stock_movements`)).toThrow(/ledger_is_append_only/);
  });

  it('allows erasing a workspace that was soft-deleted first (audit B8)', () => {
    seedWorkspace(db);
    move(db, 'm1', 'it-ws1', 10, 0, 'opening');
    db.exec(`UPDATE workspaces SET deleted_at='${now}' WHERE id='ws1'`);
    db.exec(`DELETE FROM workspaces WHERE id='ws1'`);
    expect(db.selectValue('SELECT count(*) FROM stock_movements')).toBe(0);
  });

  it('blocks erasing a live workspace with a ledger', () => {
    seedWorkspace(db);
    move(db, 'm1', 'it-ws1', 10, 0, 'opening');
    expect(() => db.exec(`DELETE FROM workspaces WHERE id='ws1'`)).toThrow(/soft_deleted_first/);
    expect(db.selectValue('SELECT count(*) FROM stock_movements')).toBe(1);
  });

  it('requires undo to reference the reversed movement', () => {
    seedWorkspace(db);
    move(db, 'm1', 'it-ws1', 10, 0, 'opening');
    expect(() => move(db, 'm2', 'it-ws1', -10, 0, 'undo')).toThrow(/CHECK/);
    move(db, 'm3', 'it-ws1', -10, 0, 'undo', 'm1');
    expect(onHand(db)).toBe(0);
  });

  it('finds items by trigram search, including the box label', () => {
    seedWorkspace(db);
    const hits = db.selectValues(`SELECT item_id FROM item_search WHERE item_search MATCH 'ring'`);
    expect(hits).toEqual(['it-ws1']);
    db.exec(`UPDATE items SET name='Silver chain' WHERE id='it-ws1'`);
    expect(db.selectValues(`SELECT item_id FROM item_search WHERE item_search MATCH 'ring'`)).toEqual([]);
    expect(db.selectValues(`SELECT item_id FROM item_search WHERE item_search MATCH 'chain'`)).toEqual(['it-ws1']);
  });

  it('removes soft-deleted items from search', () => {
    seedWorkspace(db);
    db.exec(`UPDATE items SET deleted_at='${now}' WHERE id='it-ws1'`);
    expect(db.selectValues(`SELECT item_id FROM item_search WHERE item_search MATCH 'ring'`)).toEqual([]);
  });

  it('requires a photo to belong to exactly one of box or item', () => {
    seedWorkspace(db);
    expect(() => db.exec(`INSERT INTO photos (id,workspace_id,location_id,item_id,file_name,thumb_name,mime,bytes,created_at,updated_at)
      VALUES ('p1','ws1','loc-ws1','it-ws1','a','b','image/webp',10,'${now}','${now}')`)).toThrow(/CHECK/);
  });

  it('passes quick_check', () => {
    expect(db.selectValue('PRAGMA quick_check')).toBe('ok');
  });
});
