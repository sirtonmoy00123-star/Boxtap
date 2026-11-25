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

  it('a binned box frees a slot, but restoring it over the limit is blocked', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'Move', country: 'AU', currency: 'AUD', language: 'en' });
    const first = svc.createBox(ws.id, {});
    for (let i = 0; i < 11; i++) svc.createBox(ws.id, {});
    svc.deleteBox(first.id);
    svc.createBox(ws.id, {});
    expect(() => svc.restoreBox(first.id)).toThrow(BlockedError);
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
