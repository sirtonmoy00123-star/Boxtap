import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDrive } from './fakeDrive';
import { DriveApi } from './api';
import { PhotoSync, type PhotoHost, type QueueRow } from './photoSync';
import { createKeyMaterial, importBackupKey, newRecoveryCode } from '../backup/crypto';
import type { BackupKey } from './sync';

interface P { id: string; fileName: string; deleted: boolean; driveFileId: string | null }

class Host implements PhotoHost {
  photos = new Map<string, P>();
  files = new Map<string, Uint8Array>();
  queue = new Map<string, QueueRow & { nextTry: number }>();
  wifi = true;
  now = 0;
  constructor(public key: BackupKey | null) {}
  appVersion = '0.1.0';
  schemaVersion = 1;
  addLocal(id: string, bytes: Uint8Array) {
    this.photos.set(id, { id, fileName: `photos/${id}.webp`, deleted: false, driveFileId: null });
    this.files.set(`photos/${id}.webp`, bytes);
    this.queue.set(id, { photoId: id, op: 'upload', driveFileId: null, attempts: 0, nextTry: 0 });
  }
  async due() { return [...this.queue.values()].filter((q) => q.nextTry <= this.now); }
  async reserve(photoId: string, fileId: string) { this.queue.get(photoId)!.driveFileId = fileId; }
  async done(photoId: string) { this.queue.delete(photoId); }
  async failed(photoId: string) { const q = this.queue.get(photoId); if (q) { q.attempts++; q.nextTry = this.now + 30; } }
  async photo(id: string) { const p = this.photos.get(id); return p ? { id: p.id, fileName: p.fileName, deleted: p.deleted, mime: 'image/webp' as const } : null; }
  async readFile(name: string) { return this.files.get(name) ?? null; }
  async writePhoto(id: string, bytes: Uint8Array) { this.files.set(this.photos.get(id)!.fileName, bytes); }
  async setDriveFile(id: string, fileId: string | null) { this.photos.get(id)!.driveFileId = fileId; }
  async mayUploadPhotos() { return this.wifi; }
}

let fake: FakeDrive;
let api: DriveApi;
let key: BackupKey;
const folder = async () => (await api.createFolder('photos')).id;
beforeEach(async () => {
  fake = new FakeDrive();
  api = new DriveApi(() => fake.token, fake.fetch);
  const km = await createKeyMaterial(newRecoveryCode(), { alg: 'argon2id', m: 1024, t: 1, p: 1 });
  key = { cryptoKey: await importBackupKey(km.raw), keyId: km.keyId, wrapped: km.wrapped };
});

const bytes = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * seed) & 255);

describe('Drive photo queue (audit B10, critical tests 25 and 37)', () => {
  it('uploads queued photos encrypted, with random names and no user data', async () => {
    const h = new Host(key);
    h.addLocal('p1', bytes(5000));
    const ps = new PhotoSync(api, h, await folder());
    expect(await ps.run()).toMatchObject({ uploaded: 1 });
    const f = [...fake.files.values()].find((x) => x.name.endsWith('.btph'))!;
    expect(f.name).not.toContain('p1');
    // No 64-byte run of the photo appears in what was uploaded (it is encrypted).
    const plain = bytes(5000).subarray(1000, 1064);
    const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex(f.data).includes(hex(plain))).toBe(false);
    expect(h.photos.get('p1')!.driveFileId).toBe(f.id);
    expect(h.queue.size).toBe(0);
  });

  it('a lost reply after upload does not make a duplicate on retry', async () => {
    const h = new Host(key);
    h.addLocal('p1', bytes(100));
    const ps = new PhotoSync(api, h, await folder());
    let calls = 0;
    const flaky = new DriveApi(() => fake.token, async (u, init) => {
      if (String(u).includes('/upload/') && calls++ === 0) { fake.failNext = { status: 503, afterCommit: true }; }
      return fake.fetch(u, init);
    });
    const first = await new PhotoSync(flaky, h, ps.folderId).run();
    expect(first.failed).toBe(1);
    h.now = 100;
    await ps.run();
    expect([...fake.files.values()].filter((x) => x.name.endsWith('.btph'))).toHaveLength(1);
    expect(h.queue.size).toBe(0);
  });

  it('resumes after the app was closed half-way: remaining uploads go, nothing twice', async () => {
    const h = new Host(key);
    for (let i = 0; i < 6; i++) h.addLocal(`p${i}`, bytes(200, i + 1));
    const ps = new PhotoSync(api, h, await folder());
    await ps.run({ max: 2 });
    await ps.run();
    expect([...fake.files.values()].filter((x) => x.name.endsWith('.btph'))).toHaveLength(6);
  });

  it('waits for Wi-Fi when photo uploads are Wi-Fi only (Android default)', async () => {
    const h = new Host(key);
    h.addLocal('p1', bytes(100));
    h.wifi = false;
    const ps = new PhotoSync(api, h, await folder());
    expect(await ps.run()).toMatchObject({ uploaded: 0, waitingForWifi: true });
    expect(h.queue.size).toBe(1);
  });

  it('stops photo uploads when Google storage is full and reports it', async () => {
    const h = new Host(key);
    h.addLocal('p1', bytes(1000));
    fake.quotaBytes = 10;
    const ps = new PhotoSync(api, h, await folder());
    expect(await ps.run()).toMatchObject({ quotaFull: true });
    expect(h.queue.size).toBe(1);
  });

  it('deletes the Drive copy when a purged photo is queued for delete', async () => {
    const h = new Host(key);
    h.addLocal('p1', bytes(100));
    const ps = new PhotoSync(api, h, await folder());
    await ps.run();
    const fileId = h.photos.get('p1')!.driveFileId!;
    h.queue.set('p1', { photoId: 'p1', op: 'delete', driveFileId: fileId, attempts: 0, nextTry: 0 });
    await ps.run();
    expect(fake.files.has(fileId)).toBe(false);
  });

  it('after a restore, downloads and decrypts photos; one missing from Drive becomes "not backed up" (A7)', async () => {
    const a = new Host(key);
    a.addLocal('p1', bytes(3000, 3));
    const fid = await folder();
    await new PhotoSync(api, a, fid).run();
    const b = new Host(key);
    b.photos.set('p1', { id: 'p1', fileName: 'photos/p1.webp', deleted: false, driveFileId: a.photos.get('p1')!.driveFileId });
    b.photos.set('p2', { id: 'p2', fileName: 'photos/p2.webp', deleted: false, driveFileId: 'gone-forever' });
    b.queue.set('p1', { photoId: 'p1', op: 'download', driveFileId: b.photos.get('p1')!.driveFileId, attempts: 0, nextTry: 0 });
    b.queue.set('p2', { photoId: 'p2', op: 'download', driveFileId: 'gone-forever', attempts: 0, nextTry: 0 });
    const r = await new PhotoSync(api, b, fid).run();
    expect(r.downloaded).toBe(1);
    expect(b.files.get('photos/p1.webp')).toEqual(bytes(3000, 3));
    expect(b.photos.get('p2')!.driveFileId).toBeNull();
    expect(b.queue.size).toBe(0);
  });

  it('holds back uploads of binned photos (they may be restored from the bin)', async () => {
    const h = new Host(key);
    h.addLocal('p1', bytes(100));
    h.photos.get('p1')!.deleted = true;
    const ps = new PhotoSync(api, h, await folder());
    await ps.run();
    expect([...fake.files.values()].filter((x) => x.name.endsWith('.btph'))).toHaveLength(0);
    expect(h.queue.size).toBe(1);
  });
});
