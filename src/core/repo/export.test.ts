import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from '../db/testDb';
import type { SqlDb } from '../db/migrate';
import { createService, type Service } from '../service/service';

let db: TestDb;
let svc: Service;
beforeEach(async () => {
  db = await openTestDb();
  svc = createService({ db: db as unknown as SqlDb, now: () => '2026-11-25T00:00:00.000Z' });
});

describe('CSV export (C-13, never blocked)', () => {
  it('lists every live item with its box, room and flags, escaping commas, quotes and formulas', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const room = svc.createRoom(ws.id, 'Kitchen, upstairs');
    const box = svc.createBox(ws.id, { name: 'Box "A"', roomId: room.id, isFragile: true, moveStatus: 'moved' });
    svc.addItem({ workspaceId: ws.id, locationId: box.id, name: '=SUM(1)', valueEstimateMinor: 1250 });
    svc.createBox(ws.id, { name: 'Empty' });
    const csv = svc.exportCsv(ws.id);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('box_number,box_name,room,where,fragile,open_first,move_status,item,alt_name,notes,value');
    expect(lines[1]).toBe(`1,"Box ""A""","Kitchen, upstairs",,yes,no,moved,'=SUM(1),,,12.50`);
    expect(lines[2]).toBe('2,Empty,,,no,no,,,,,');
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM so Excel reads Bangla correctly
  });
});

describe('move status and arrival check', () => {
  it('counts boxes by move status', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    svc.createBox(ws.id, { moveStatus: 'packed' });
    svc.createBox(ws.id, { moveStatus: 'moved' });
    const b = svc.createBox(ws.id, {});
    svc.updateBox(b.id, { moveStatus: 'unpacked' });
    expect(svc.moveSummary(ws.id)).toEqual({ total: 3, packed: 1, moved: 1, unpacked: 1, none: 0 });
  });
});

describe('erase all data (C-13)', () => {
  it('removes every workspace, including Seller ledgers, and the Drive link', () => {
    const ws = svc.createWorkspace({ type: 'seller', name: 'S', country: 'BD', currency: 'BDT', language: 'bn' });
    const box = svc.createBox(ws.id, {});
    const it1 = svc.addItem({ workspaceId: ws.id, locationId: box.id, name: 'Ring' });
    db.exec(`INSERT INTO stock_movements (id,workspace_id,item_id,on_hand_delta,reason,happened_at) VALUES ('m1','${ws.id}','${it1.id}',2,'opening','x')`);
    svc.eraseAll();
    for (const t of ['workspaces', 'locations', 'items', 'stock_movements', 'labels', 'photos', 'drive_link', 'drive_outbox', 'rooms']) {
      expect(db.selectValue(`SELECT count(*) FROM ${t}`), t).toBe(0);
    }
  });
});
