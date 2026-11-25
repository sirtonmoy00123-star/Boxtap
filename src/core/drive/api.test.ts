import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDrive } from './fakeDrive';
import { DriveApi, DriveError } from './api';

let fake: FakeDrive;
let api: DriveApi;
beforeEach(() => {
  fake = new FakeDrive();
  api = new DriveApi(() => fake.token, fake.fetch);
});

describe('Drive API client', () => {
  it('creates and finds the BoxTap Backup folder, ignoring trashed ones (audit B9)', async () => {
    const f = await api.createFolder('BoxTap Backup');
    expect((await api.findFolders('BoxTap Backup')).map((x) => x.id)).toEqual([f.id]);
    await api.setTrashed(f.id, true);
    expect(await api.findFolders('BoxTap Backup')).toEqual([]);
    expect((await api.getFile(f.id)).trashed).toBe(true);
  });

  it('uploads with a reserved id and treats a 409 retry as done: no duplicates (critical test 37)', async () => {
    const folder = await api.createFolder('BoxTap Backup');
    const [id] = await api.generateIds(1);
    fake.failNext = { status: 503, afterCommit: true }; // file written, reply lost
    await expect(api.upload({ id: id!, name: 'p.btph', parent: folder.id, appProperties: { photo_ref: 'r1' }, bytes: new Uint8Array([1, 2, 3]) })).rejects.toBeInstanceOf(DriveError);
    const again = await api.upload({ id: id!, name: 'p.btph', parent: folder.id, appProperties: { photo_ref: 'r1' }, bytes: new Uint8Array([1, 2, 3]) });
    expect(again.alreadyExisted).toBe(true);
    expect((await api.listChildren(folder.id)).length).toBe(1);
  });

  it('round-trips binary content and appProperties', async () => {
    const folder = await api.createFolder('BoxTap Backup');
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i & 255);
    const [id] = await api.generateIds(1);
    await api.upload({ id: id!, name: 's-x.btdb', parent: folder.id, appProperties: { snapshot_seq: '4', generation: '1' }, bytes });
    const [child] = await api.listChildren(folder.id);
    expect(child!.appProperties).toEqual({ snapshot_seq: '4', generation: '1' });
    expect(await api.download(id!)).toEqual(bytes);
  });

  it('classifies errors: token ended, storage full, rate limit, other 403, missing file', async () => {
    const stale = new DriveApi(() => 'expired-token', fake.fetch);
    await expect(stale.findFolders('x')).rejects.toMatchObject({ kind: 'auth' });
    await expect(new DriveApi(() => null, fake.fetch).findFolders('x')).rejects.toMatchObject({ kind: 'auth' });
    fake.quotaBytes = 2;
    const folder = await api.createFolder('BoxTap Backup');
    const [id] = await api.generateIds(1);
    await expect(api.upload({ id: id!, name: 'a', parent: folder.id, appProperties: {}, bytes: new Uint8Array(10) })).rejects.toMatchObject({ kind: 'quota' });
    fake.failNext = { status: 403, reason: 'userRateLimitExceeded' };
    await expect(api.findFolders('x')).rejects.toMatchObject({ kind: 'rate' });
    fake.failNext = { status: 429 };
    await expect(api.findFolders('x')).rejects.toMatchObject({ kind: 'rate' });
    fake.failNext = { status: 403, reason: 'insufficientPermissions' };
    await expect(api.findFolders('x')).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(api.getFile('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('never puts the token anywhere but the Authorization header', async () => {
    const seen: string[] = [];
    const spy = new DriveApi(() => fake.token, async (u, init) => { seen.push(String(u), String(init?.body ?? '')); return fake.fetch(u, init); });
    await spy.createFolder('BoxTap Backup');
    expect(seen.join(' ')).not.toContain(fake.token);
  });

  it('escapes quotes in queries', async () => {
    await api.createFolder("Mia's BoxTap");
    expect(await api.findFolders("Mia's BoxTap")).toHaveLength(1);
  });
});
