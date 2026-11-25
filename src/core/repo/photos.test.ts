import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from '../db/testDb';
import type { SqlDb } from '../db/migrate';
import * as R from './index';
import { createService, BlockedError, type Service } from '../service/service';

let db: TestDb;
let clock: string;
let ctx: R.Ctx;
let svc: Service;
beforeEach(async () => {
  db = await openTestDb();
  clock = '2026-11-25T00:00:00.000Z';
  ctx = { db: db as unknown as SqlDb, now: () => clock };
  svc = createService(ctx);
});

const photo = (over: Partial<R.PhotoInput> = {}): R.PhotoInput =>
  ({ workspaceId: '', locationId: null, itemId: null, mime: 'image/webp', bytes: 1000, sha256: 'ab'.repeat(32), ...over });

describe('photos', () => {
  it('adds a box photo with file names from its id, lists it, and queues a Drive upload', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const box = svc.createBox(ws.id, {});
    const p = svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id }));
    expect(p.fileName).toBe(`photos/${p.id}.webp`);
    expect(p.thumbName).toBe(`photos/${p.id}.thumb.webp`);
    expect(svc.listPhotos({ locationId: box.id }).map((x) => x.id)).toEqual([p.id]);
    expect(R.outboxDue(ctx, clock).map((o) => [o.photoId, o.op])).toEqual([[p.id, 'upload']]);
  });

  it('uses .jpg names when the browser could only make JPEG (Safari, audit B12)', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const box = svc.createBox(ws.id, {});
    expect(svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id, mime: 'image/jpeg' })).fileName).toMatch(/\.jpg$/);
  });

  it('Home Free allows 1 photo per box (can add_photo)', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const box = svc.createBox(ws.id, {});
    svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id }));
    expect(() => svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id }))).toThrow(BlockedError);
  });

  it('rejects oversized photos and a photo with no parent', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const box = svc.createBox(ws.id, {});
    expect(() => svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id, bytes: 700_000 }))).toThrow();
    expect(() => svc.addPhoto(photo({ workspaceId: ws.id }))).toThrow();
  });

  it('deleting a photo bins it and frees the slot', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const box = svc.createBox(ws.id, {});
    const p = svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id }));
    svc.deletePhoto(p.id);
    expect(svc.listPhotos({ locationId: box.id })).toEqual([]);
    svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id }));
  });

  it('purging a binned photo returns its files and queues a Drive delete only if it was uploaded', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const box = svc.createBox(ws.id, {});
    const p = svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id }));
    R.outboxDone(ctx, p.id);
    R.setPhotoDriveRef(ctx, p.id, 'ref123', 'file-1');
    svc.deleteBox(box.id);
    clock = '2027-01-01T00:00:00.000Z';
    const res = svc.purgeBin();
    expect(res.photoFiles).toEqual([p.fileName, p.thumbName]);
    expect(R.outboxDue(ctx, clock).map((o) => [o.op, o.driveFileId])).toEqual([['delete', 'file-1']]);
  });

  it('outbox backs off after a failure, 30 s doubling up to 1 h', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const box = svc.createBox(ws.id, {});
    const p = svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id }));
    R.outboxFailed(ctx, p.id, 'offline');
    expect(R.outboxDue(ctx, clock)).toEqual([]);
    expect(R.outboxDue(ctx, '2026-11-25T00:00:31.000Z')).toHaveLength(1);
    for (let i = 0; i < 12; i++) R.outboxFailed(ctx, p.id, 'offline');
    expect(R.outboxDue(ctx, '2026-11-25T00:59:00.000Z')).toEqual([]);
    expect(R.outboxDue(ctx, '2026-11-25T01:00:01.000Z')).toHaveLength(1);
  });

  it('remembers a reserved Drive file id across retries (audit B10)', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const box = svc.createBox(ws.id, {});
    const p = svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id }));
    R.outboxReserve(ctx, p.id, 'gen42');
    R.outboxFailed(ctx, p.id, 'x');
    expect(R.outboxDue(ctx, '2026-11-26T00:00:00.000Z')[0]!.driveFileId).toBe('gen42');
  });

  it('after a restore, photos with a Drive copy are queued for download', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const box = svc.createBox(ws.id, {});
    const p = svc.addPhoto(photo({ workspaceId: ws.id, locationId: box.id }));
    R.setPhotoDriveRef(ctx, p.id, 'ref1', 'f1');
    db.exec('DELETE FROM drive_outbox');
    expect(R.queuePhotoDownloads(ctx)).toBe(1);
    expect(R.outboxDue(ctx, clock).map((o) => o.op)).toEqual(['download']);
  });

  it('renames a room (so a typo can be fixed)', () => {
    const ws = svc.createWorkspace({ type: 'home', name: 'M', country: 'AU', currency: 'AUD', language: 'en' });
    const r = svc.createRoom(ws.id, 'Garadge');
    svc.renameRoom(r.id, 'Garage');
    expect(svc.listRooms(ws.id).map((x) => x.name)).toEqual(['Garage']);
  });
});
