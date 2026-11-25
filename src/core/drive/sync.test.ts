import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDrive } from './fakeDrive';
import { DriveApi } from './api';
import { DriveSync, type SyncHost, type LinkState } from './sync';
import { createKeyMaterial, importBackupKey, newRecoveryCode, WrongCodeError, type KeyMaterial } from '../backup/crypto';
import type { Totals } from './rules';

const FAST = { alg: 'argon2id' as const, m: 1024, t: 1, p: 1 };

class Host implements SyncHost {
  link: LinkState | null = null;
  change = 1;
  db: Uint8Array = new TextEncoder().encode('database v1');
  restored: Uint8Array | null = null;
  totalsNow: Totals = { boxes: 10, items: 40, onHand: 0, photos: 0 };
  constructor(public key: { cryptoKey: CryptoKey; keyId: string; wrapped: KeyMaterial['wrapped'] } | null, public deviceName: string) {}
  appVersion = '0.1.0';
  schemaVersion = 1;
  async exportSnapshot() { return this.db.slice(); }
  async changeSeq() { return this.change; }
  async totals() { return this.totalsNow; }
  async getLink() { return this.link; }
  async setLink(l: LinkState | null) { this.link = l ? { ...l } : null; }
  async applyRestore(bytes: Uint8Array) { this.restored = bytes; this.db = bytes; return { boxes: 1, items: 2, fromVersion: 1, ledgerRepaired: 0 }; }
  async adoptKey(k: { cryptoKey: CryptoKey; keyId: string; wrapped: KeyMaterial['wrapped'] }) { this.key = k; }
}

async function device(name: string, km?: KeyMaterial, code?: string) {
  const c = code ?? newRecoveryCode();
  const k = km ?? await createKeyMaterial(c, FAST);
  return { code: c, km: k, host: new Host({ cryptoKey: await importBackupKey(k.raw), keyId: k.keyId, wrapped: k.wrapped }, name) };
}

let fake: FakeDrive;
let api: DriveApi;
beforeEach(() => { fake = new FakeDrive(); api = new DriveApi(() => fake.token, fake.fetch); });

const names = () => [...fake.files.values()].map((f) => f.name);

describe('Drive sync engine', () => {
  it('connect on a fresh Drive creates the layout, takes the lock and uploads a first snapshot (critical test 24)', async () => {
    const A = await device('Mia phone');
    const sync = new DriveSync(api, A.host);
    expect(await sync.inspect()).toEqual({ kind: 'create' });
    await sync.connect('mia@example.com');
    expect(A.host.link).toMatchObject({ generation: 1, status: 'ok' });
    expect(await sync.snapshotNow()).toBe('uploaded');
    expect(names()).toEqual(expect.arrayContaining(['BoxTap Backup', 'README.txt', 'device.lock', 'snapshots', 'photos']));
  });

  it('nothing in Drive names or properties reveals user text or the device name (critical test 29)', async () => {
    const A = await device('Mia phone');
    A.host.db = new TextEncoder().encode('Grandma necklace in Box 12');
    const sync = new DriveSync(api, A.host);
    await sync.connect('mia@example.com');
    await sync.snapshotNow();
    const visible = JSON.stringify([...fake.files.values()].map((f) => ({ n: f.name, p: f.appProperties })));
    expect(visible).not.toMatch(/Grandma|necklace|Mia/);
    const content = [...fake.files.values()].map((f) => new TextDecoder().decode(f.data)).join(' ');
    expect(content).not.toMatch(/Grandma|Mia phone/);
  });

  it('skips the upload when nothing changed, and uploads again after a change', async () => {
    const A = await device('A');
    const sync = new DriveSync(api, A.host);
    await sync.connect('a@x');
    await sync.snapshotNow();
    expect(await sync.snapshotNow()).toBe('up_to_date');
    A.host.change = 5;
    expect(await sync.snapshotNow()).toBe('uploaded');
    expect(A.host.link!.lastSnapshotSeq).toBe(2);
  });

  it('a new phone that connects to a Drive with a backup is offered restore and cannot write there (critical test 31)', async () => {
    const A = await device('A');
    const sa = new DriveSync(api, A.host);
    await sa.connect('a@x');
    await sa.snapshotNow();
    const B = await device('B'); // set up as "new": different key
    const sb = new DriveSync(api, B.host);
    const d = await sb.inspect();
    expect(d).toMatchObject({ kind: 'offer_restore', sameKey: false });
    await expect(sb.connect('a@x')).rejects.toThrow(/existing backup/);
    expect(B.host.link).toBeNull();
  });

  it('"Start a new backup folder" renames the old folder and leaves it untouched', async () => {
    const A = await device('A');
    const sa = new DriveSync(api, A.host);
    await sa.connect('a@x');
    await sa.snapshotNow();
    const before = fake.files.size;
    const B = await device('B');
    const sb = new DriveSync(api, B.host);
    await sb.connect('a@x', { startNewFolder: true, now: '2026-11-25T00:00:00Z' });
    expect(names()).toContain('BoxTap Backup (old 2026-11-25)');
    expect(fake.files.size).toBeGreaterThan(before);
  });

  it('restore on a new device with the code, then the old device stops syncing (critical tests 26, 27)', async () => {
    const A = await device('A');
    A.host.db = new TextEncoder().encode('the real data');
    const sa = new DriveSync(api, A.host);
    await sa.connect('a@x');
    await sa.snapshotNow();

    const B = await device('B');
    const sb = new DriveSync(api, B.host);
    const d = await sb.inspect();
    if (d.kind !== 'offer_restore') throw new Error('expected restore offer');
    await sb.restore(d.folderId, A.code, 'a@x');
    expect(new TextDecoder().decode(B.host.restored!)).toBe('the real data');
    expect(B.host.link).toMatchObject({ generation: 2, lastSnapshotSeq: 1, keyId: A.km.keyId });
    expect(B.host.key!.keyId).toBe(A.km.keyId);

    A.host.change = 9;
    expect(await sa.snapshotNow()).toBe('lock_lost');
    expect(A.host.link!.status).toBe('lock_lost');
    B.host.change = 99;
    expect(await sb.snapshotNow()).toBe('uploaded');
  });

  it('a brand-new phone with no backup key yet can find and restore the backup', async () => {
    const A = await device('A');
    const sa = new DriveSync(api, A.host);
    await sa.connect('a@x');
    await sa.snapshotNow();
    const fresh = new Host(null, 'New phone');
    const sf = new DriveSync(api, fresh);
    await expect(sf.connect('a@x')).rejects.toThrow(/existing backup|recovery code/);
    const d = await sf.inspect();
    if (d.kind !== 'offer_restore') throw new Error('expected restore offer');
    await sf.restore(d.folderId, A.code, 'a@x');
    expect(fresh.key!.keyId).toBe(A.km.keyId);
    fresh.change = 50;
    expect(await sf.snapshotNow()).toBe('uploaded');
  });

  it('a wrong recovery code on Drive restore changes nothing (critical test 30)', async () => {
    const A = await device('A');
    const sa = new DriveSync(api, A.host);
    await sa.connect('a@x');
    await sa.snapshotNow();
    const B = await device('B');
    const sb = new DriveSync(api, B.host);
    const d = await sb.inspect();
    if (d.kind !== 'offer_restore') throw new Error('expected restore offer');
    await expect(sb.restore(d.folderId, newRecoveryCode(), 'a@x')).rejects.toBeInstanceOf(WrongCodeError);
    expect(B.host.restored).toBeNull();
    expect(B.host.link).toBeNull();
  });

  it('deletes its own snapshot if it lost the lock during the upload (audit B5)', async () => {
    const A = await device('A');
    const sa = new DriveSync(api, A.host);
    await sa.connect('a@x');
    await sa.snapshotNow();
    const lockId = A.host.link!.lockFileId;
    A.host.change = 7;
    const snapsBefore = [...fake.files.values()].filter((f) => f.name.endsWith('.btdb')).length;
    sa.beforeFinalLockCheck = async () => { fake.files.get(lockId)!.appProperties = { generation: '2', device_id: 'other' }; };
    expect(await sa.snapshotNow()).toBe('lock_lost');
    expect([...fake.files.values()].filter((f) => f.name.endsWith('.btdb')).length).toBe(snapsBefore);
  });

  it('notices a trashed folder and never reports backed up (critical test 36)', async () => {
    const A = await device('A');
    const sa = new DriveSync(api, A.host);
    await sa.connect('a@x');
    await api.setTrashed(A.host.link!.folderId, true);
    A.host.change = 3;
    expect(await sa.snapshotNow()).toBe('folder_trashed');
    expect(A.host.link!.status).toBe('folder_trashed');
  });

  it('a token that ended asks for a tap instead of failing (B3)', async () => {
    const A = await device('A');
    const sa = new DriveSync(api, A.host);
    await sa.connect('a@x');
    const expired = new DriveSync(new DriveApi(() => 'expired-token', fake.fetch), A.host);
    A.host.change = 3;
    expect(await expired.snapshotNow()).toBe('needs_signin');
    expect(A.host.link!.status).toBe('needs_signin');
    expect(await sa.snapshotNow()).toBe('uploaded'); // after the tap, a fresh token works again
  });

  it('marks "Before big change" when totals more than halve, and prunes old snapshots', async () => {
    const A = await device('A');
    const sa = new DriveSync(api, A.host);
    await sa.connect('a@x');
    for (let i = 0; i < 20; i++) { A.host.change += 1; await sa.snapshotNow(); }
    A.host.totalsNow = { ...A.host.totalsNow, boxes: 2 };
    A.host.change += 1;
    await sa.snapshotNow();
    const snaps = [...fake.files.values()].filter((f) => f.name.endsWith('.btdb'));
    expect(snaps.length).toBeLessThan(21);
    expect(snaps.some((f) => f.appProperties.before_big_change === '1')).toBe(true);
  });

  it('disconnect forgets the link but leaves the files (the user owns them)', async () => {
    const A = await device('A');
    const sa = new DriveSync(api, A.host);
    await sa.connect('a@x');
    const n = fake.files.size;
    await sa.disconnect();
    expect(A.host.link).toBeNull();
    expect(fake.files.size).toBe(n);
  });
});
