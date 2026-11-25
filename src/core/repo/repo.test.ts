import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from '../db/testDb';
import type { SqlDb } from '../db/migrate';
import * as R from './index';
import { isLabelCode, LABEL_ALPHABET } from './labels';

let db: TestDb;
let clock: string;
let ctx: R.Ctx;

beforeEach(async () => {
  db = await openTestDb();
  clock = '2026-11-25T00:00:00.000Z';
  ctx = { db: db as unknown as SqlDb, now: () => clock };
});

const home = () => R.createWorkspace(ctx, { type: 'home', name: 'Our move', country: 'AU', currency: 'AUD', language: 'en' });

describe('workspaces and boxes', () => {
  it('numbers boxes 1, 2, 3 within a workspace and gives each a label', () => {
    const ws = home();
    const a = R.createBox(ctx, ws.id, { name: 'Kitchen 1' });
    const b = R.createBox(ctx, ws.id, {});
    expect([a.number, b.number]).toEqual([1, 2]);
    expect(isLabelCode(a.labelCode)).toBe(true);
    expect(R.boxByLabel(ctx, a.labelCode)?.id).toBe(a.id);
  });

  it('keeps workspaces apart', () => {
    const w1 = home();
    const w2 = home();
    R.createBox(ctx, w1.id, {});
    expect(R.createBox(ctx, w2.id, {}).number).toBe(1);
    expect(R.listBoxes(ctx, w2.id)).toHaveLength(1);
  });

  it('bumps change_seq on every write', () => {
    const before = R.changeSeq(ctx);
    const ws = home();
    R.createBox(ctx, ws.id, {});
    expect(R.changeSeq(ctx)).toBeGreaterThan(before + 1);
  });

  it('updates box fields and keeps search labels in step', () => {
    const ws = home();
    const box = R.createBox(ctx, ws.id, {});
    R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Kettle' });
    R.updateBox(ctx, box.id, { name: 'Kitchen', spot: 'Garage shelf', isFragile: true });
    const got = R.getBox(ctx, box.id)!;
    expect(got.name).toBe('Kitchen');
    expect(got.isFragile).toBe(true);
    expect(R.search(ctx, ws.id, 'garage').map((h) => h.itemName)).toEqual(['Kettle']);
  });
});

describe('rooms', () => {
  it('deleting a room leaves its boxes with no room', () => {
    const ws = home();
    const room = R.createRoom(ctx, ws.id, 'Kitchen');
    const box = R.createBox(ctx, ws.id, { roomId: room.id });
    R.deleteRoom(ctx, room.id);
    expect(R.listRooms(ctx, ws.id)).toEqual([]);
    expect(R.getBox(ctx, box.id)!.roomId).toBeNull();
  });
});

describe('items and the 30-day bin', () => {
  it('deleting a box bins its items, and restoring brings both back', () => {
    const ws = home();
    const box = R.createBox(ctx, ws.id, {});
    R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Blender' });
    R.deleteBox(ctx, box.id);
    expect(R.listBoxes(ctx, ws.id)).toEqual([]);
    expect(R.search(ctx, ws.id, 'blender')).toEqual([]);
    expect(R.listBin(ctx, ws.id).boxes.map((b) => b.id)).toEqual([box.id]);
    R.restoreBox(ctx, box.id);
    expect(R.listItems(ctx, box.id).map((i) => i.name)).toEqual(['Blender']);
    expect(R.search(ctx, ws.id, 'blender')).toHaveLength(1);
  });

  it('restoring a box does not revive items deleted separately before it', () => {
    const ws = home();
    const box = R.createBox(ctx, ws.id, {});
    const it1 = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Old toaster' });
    R.deleteItem(ctx, it1.id);
    clock = '2026-11-26T00:00:00.000Z';
    R.deleteBox(ctx, box.id);
    R.restoreBox(ctx, box.id);
    expect(R.listItems(ctx, box.id)).toEqual([]);
  });

  it('purges bin rows older than 30 days, keeping newer ones', () => {
    const ws = home();
    const old = R.createBox(ctx, ws.id, {});
    R.addItem(ctx, { workspaceId: ws.id, locationId: old.id, name: 'Lamp' });
    R.deleteBox(ctx, old.id);
    clock = '2026-12-20T00:00:00.000Z';
    const recent = R.createBox(ctx, ws.id, {});
    R.deleteBox(ctx, recent.id);
    clock = '2026-12-26T00:00:00.000Z';
    const result = R.purgeBin(ctx);
    expect(result.boxes).toBe(1);
    expect(R.getBox(ctx, old.id)).toBeUndefined();
    expect(R.listBin(ctx, ws.id).boxes.map((b) => b.id)).toEqual([recent.id]);
    expect(db.selectValue(`SELECT count(*) FROM labels WHERE location_id='${old.id}'`)).toBe(0);
  });

  it('rejects an empty or too-long item name', () => {
    const ws = home();
    const box = R.createBox(ctx, ws.id, {});
    expect(() => R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: '  ' })).toThrow(/name/);
    expect(() => R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'x'.repeat(121) })).toThrow(/name/);
  });
});

describe('search (C-07)', () => {
  it('finds by 3+ letters, by 1-2 letters, and by box number words', () => {
    const ws = home();
    const box = R.createBox(ctx, ws.id, { name: 'Bathroom' });
    R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Hair dryer' });
    R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'TV remote' });
    expect(R.search(ctx, ws.id, 'dryer').map((h) => h.itemName)).toEqual(['Hair dryer']);
    expect(R.search(ctx, ws.id, 'tv').map((h) => h.itemName)).toEqual(['TV remote']);
    expect(R.search(ctx, ws.id, 'bathroom')).toHaveLength(2);
    expect(R.search(ctx, ws.id, 'Box 1')).toHaveLength(2);
  });

  it('matches Bangla typed in different normal forms, and survives FTS syntax characters', () => {
    const ws = R.createWorkspace(ctx, { type: 'seller', name: 'দোকান', country: 'BD', currency: 'BDT', language: 'bn' });
    const box = R.createBox(ctx, ws.id, {});
    R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'সোনার আংটি' });
    expect(R.search(ctx, ws.id, 'আংটি'.normalize('NFD'))).toHaveLength(1);
    expect(R.search(ctx, ws.id, '"AND OR* (')).toEqual([]);
  });

  it('answers 400 items in under a second', () => {
    const ws = home();
    for (let b = 0; b < 20; b++) {
      const box = R.createBox(ctx, ws.id, { name: `Room ${b}` });
      for (let i = 0; i < 20; i++) R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: `Thing ${b}-${i} cable` });
    }
    const t = performance.now();
    const hits = R.search(ctx, ws.id, 'cable');
    expect(performance.now() - t).toBeLessThan(1000);
    expect(hits.length).toBeGreaterThanOrEqual(50);
  });
});

describe('labels', () => {
  it('makes 10-character Crockford codes from the documented alphabet', () => {
    const ws = home();
    const codes = R.createSpareLabels(ctx, ws.id, 30);
    expect(new Set(codes).size).toBe(30);
    for (const c of codes) {
      expect(c).toHaveLength(10);
      expect([...c].every((ch) => LABEL_ALPHABET.includes(ch))).toBe(true);
    }
  });

  it('a spare label can be stuck on a box later', () => {
    const ws = home();
    const [code] = R.createSpareLabels(ctx, ws.id, 1);
    const box = R.createBox(ctx, ws.id, {});
    R.assignLabel(ctx, code!, box.id);
    expect(R.boxByLabel(ctx, code!)?.id).toBe(box.id);
  });

  it('a label from another workspace cannot be assigned', () => {
    const w1 = home();
    const w2 = home();
    const [code] = R.createSpareLabels(ctx, w1.id, 1);
    const box = R.createBox(ctx, w2.id, {});
    expect(() => R.assignLabel(ctx, code!, box.id)).toThrow(/label/);
  });
});

describe('counts', () => {
  it('counts live boxes, items and photos on a parent', () => {
    const ws = home();
    const box = R.createBox(ctx, ws.id, {});
    R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Mug' });
    R.createBox(ctx, ws.id, {});
    R.deleteBox(ctx, R.createBox(ctx, ws.id, {}).id);
    expect(R.counts(ctx, ws.id)).toEqual({ boxes: 2, items: 1 });
  });
});

describe('review findings 7 and 12', () => {
  it('a purged-but-kept box (seller stock history) keeps its label and is hidden from the bin', () => {
    const ws = R.createWorkspace(ctx, { type: 'seller', name: 'Shop', country: 'BD', currency: 'BDT', language: 'bn' });
    const box = R.createBox(ctx, ws.id, {});
    const it1 = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Ring' });
    db.exec(`INSERT INTO stock_movements (id,workspace_id,item_id,on_hand_delta,reason,happened_at) VALUES ('m1','${ws.id}','${it1.id}',3,'opening','${clock}')`);
    R.deleteBox(ctx, box.id);
    clock = '2027-01-30T00:00:00.000Z';
    R.purgeBin(ctx);
    expect(R.getBox(ctx, box.id)?.labelCode).toBe(box.labelCode);
    expect(R.listBin(ctx, ws.id).boxes).toEqual([]);
  });

  it('restoring an item whose box is binned does not revive its photos', () => {
    const ws = home();
    const box = R.createBox(ctx, ws.id, {});
    const it1 = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Lamp' });
    db.exec(`INSERT INTO photos (id,workspace_id,item_id,file_name,thumb_name,mime,bytes,created_at,updated_at) VALUES ('p1','${ws.id}','${it1.id}','a','b','image/webp',10,'${clock}','${clock}')`);
    R.deleteItem(ctx, it1.id);
    R.deleteBox(ctx, box.id);
    R.restoreItem(ctx, it1.id);
    expect(db.selectValue(`SELECT deleted_at IS NULL FROM photos WHERE id='p1'`)).toBe(0);
  });
});
