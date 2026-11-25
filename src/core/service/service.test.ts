import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb } from '../db/testDb';
import type { SqlDb } from '../db/migrate';
import { createService, BlockedError, type Service } from './service';

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
