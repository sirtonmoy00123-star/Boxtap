import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb } from '../db/testDb';
import type { SqlDb } from '../db/migrate';
import { createService, BlockedError, type Service } from './service';
import { DEFAULT_CONFIG } from '../licensing/can';

let svc: Service;
beforeEach(async () => {
  const db = await openTestDb();
  svc = createService({ db: db as unknown as SqlDb, now: () => '2026-11-25T00:00:00.000Z' });
});

describe('service gates writes with can()', () => {
  it('Home Free: box 13 is blocked with limit_boxes (critical test 12)', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'Move', country: 'AU', currency: 'AUD', language: 'en' });
    for (let i = 0; i < 12; i++) svc.createBox(ws.id, {});
    expect(() => svc.createBox(ws.id, {})).toThrow(BlockedError);
    try { svc.createBox(ws.id, {}); } catch (e) { expect((e as BlockedError).reason).toBe('limit_boxes'); }
    expect(svc.listBoxes(ws.id)).toHaveLength(12);
  });

  it('restoring from the bin is never blocked, even over the free limit (H-06, review finding 6)', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'Move', country: 'AU', currency: 'AUD', language: 'en' });
    const first = svc.createBox(ws.id, {});
    for (let i = 0; i < 11; i++) svc.createBox(ws.id, {});
    svc.deleteBox(first.id);
    svc.createBox(ws.id, {});
    svc.restoreBox(first.id);
    expect(svc.listBoxes(ws.id)).toHaveLength(13);
    expect(() => svc.createBox(ws.id, {})).toThrow(BlockedError);
  });

  it('Seller Free: item 51 is blocked with limit_items', () => {
    const ws = svc.createWorkspace({ type: 'seller', name: 'Shop', country: 'BD', currency: 'BDT', language: 'bn' });
    const box = svc.createBox(ws.id, {});
    for (let i = 0; i < 50; i++) svc.addItem({ workspaceId: ws.id, locationId: box.id, name: `Ring ${i}` });
    expect(() => svc.addItem({ workspaceId: ws.id, locationId: box.id, name: 'One more' })).toThrow(/limit_items/);
  });

  it('reading and searching are never blocked (H-06)', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'Move', country: 'AU', currency: 'AUD', language: 'en' });
    for (let i = 0; i < 12; i++) svc.createBox(ws.id, { name: `Box ${i}` });
    expect(svc.listBoxes(ws.id)).toHaveLength(12);
    expect(svc.search(ws.id, 'box')).toEqual([]);
  });
});

describe('drive link storage', () => {
  it('round-trips the link and clears it on disconnect; no token column exists', async () => {
    const link = {
      googleEmail: 'mia@example.com', folderId: 'f', snapshotsFolderId: 's', photosFolderId: 'p', lockFileId: 'l', deviceId: 'd_1',
      generation: 2, lastSnapshotSeq: 5, uploadedChangeSeq: 9, keyId: 'bk_1', status: 'ok' as const, lastSnapshotAt: null,
    };
    svc.setDriveLink(link);
    expect(svc.getDriveLink()).toEqual(link);
    svc.setDriveLink({ ...link, status: 'lock_lost' });
    expect(svc.getDriveLink()!.status).toBe('lock_lost');
    svc.setDriveLink(null);
    expect(svc.getDriveLink()).toBeNull();
    const db = await openTestDb();
    const cols = db.selectValues(`SELECT name FROM pragma_table_info('drive_link')`).map(String);
    expect(cols.some((c) => /token/i.test(c))).toBe(false);
  });
});

describe('Pro features need Seller Pro', () => {
  it('reports, orders and cost need the plan; with it they work', async () => {
    const free = svc;
    const ws = free.createWorkspace({ type: 'seller', name: 'S', country: 'BD', currency: 'BDT', language: 'bn' });
    expect(() => free.salesReport(ws.id, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')).toThrow(/pro_only/);
    expect(() => free.createOrder(ws.id, { customer: 'A' })).toThrow(/pro_only/);
    const db = await openTestDb();
    const pro = createService({ db: db as unknown as SqlDb, now: () => '2026-11-25T00:00:00.000Z' },
      () => ({ config: DEFAULT_CONFIG, plans: new Set(['seller_pro'] as const) }));
    const w2 = pro.createWorkspace({ type: 'seller', name: 'S', country: 'BD', currency: 'BDT', language: 'bn' });
    expect(pro.salesReport(w2.id, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z').unitsSold).toBe(0);
    expect(pro.createOrder(w2.id, { customer: 'A' }).number).toBe(1);
  });
  it('stock still works for free sellers (only the extras are Pro)', () => {
    const ws = svc.createWorkspace({ type: 'seller', name: 'S', country: 'BD', currency: 'BDT', language: 'bn' });
    const box = svc.createBox(ws.id, {});
    const it = svc.addItem({ workspaceId: ws.id, locationId: box.id, name: 'Ring' });
    svc.recordStock(it.id, 'restock', 2);
    expect(svc.getItem(it.id)!.onHand).toBe(2);
  });
});

describe('daily self-check (DATABASE_SCHEMA §5)', () => {
  it('runs at most once a day: integrity check, ledger repair, bin purge; lists every photo file to keep', async () => {
    const db = await openTestDb();
    let clock = '2026-11-25T08:00:00.000Z';
    const s = createService({ db: db as unknown as SqlDb, now: () => clock });
    const ws = s.createWorkspace({ type: 'seller', name: 'S', country: 'BD', currency: 'BDT', language: 'bn' });
    const box = s.createBox(ws.id, {});
    const it = s.addItem({ workspaceId: ws.id, locationId: box.id, name: 'Ring' });
    s.recordStock(it.id, 'restock', 3);
    const p = s.addPhoto({ workspaceId: ws.id, locationId: box.id, itemId: null, mime: 'image/webp', bytes: 10, sha256: 'b'.repeat(64) });
    s.deletePhoto(p.id); // binned photos keep their files until the purge
    const first = s.dailyCheck();
    expect(first).toMatchObject({ ran: true, integrityOk: true, ledgerRepaired: 0 });
    expect(first.keepFiles).toEqual(expect.arrayContaining([p.fileName, p.thumbName]));
    expect(s.dailyCheck().ran).toBe(false);
    clock = '2026-11-26T08:00:00.000Z';
    expect(s.dailyCheck().ran).toBe(true);
  });
});

describe('lists on one device (C-02)', () => {
  it('changes a list language and name, and keeps lists apart', () => {
    const home = svc.createWorkspace({ type: 'home', name: 'Move', country: 'AU', currency: 'AUD', language: 'en' });
    const shop = svc.createWorkspace({ type: 'seller', name: 'Shop', country: 'BD', currency: 'BDT', language: 'en' });
    svc.setWorkspaceLanguage(shop.id, 'bn');
    svc.renameWorkspace(home.id, 'Our move');
    expect(svc.listWorkspaces().map((w) => [w.name, w.language])).toEqual([['Our move', 'en'], ['Shop', 'bn']]);
    expect(() => svc.setWorkspaceLanguage(shop.id, 'fr' as 'en')).toThrow();
  });
});
