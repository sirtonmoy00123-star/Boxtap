// Google Drive backup engine (ADR-020, ADR-022; API_CONTRACTS §6.1 and §6.2). Runs only in the tab holding the
// Web Lock, only while the app is open and a token is held. The device stays the main store.
import { DriveApi, DriveError, type DriveFile } from './api';
import { connectDecision, isBigChange, lockState, newest, toPrune, type ConnectDecision, type Lock, type Snap, type Totals } from './rules';
import { decryptFile, encryptFile, importBackupKey, readHeader, unwrapBackupKey, type WrappedKey } from '../backup/crypto';
import { pack, unpack } from '../backup/pack';
import { bytesToHex } from '../util/encoding';
import type { RestoreResult } from '../db/protocol';

export const ROOT_NAME = 'BoxTap Backup';
const README = 'Encrypted BoxTap backup. Restore at boxtap.app with your 12-word recovery code.\n';

export type LinkStatus = 'ok' | 'needs_signin' | 'quota_full' | 'lock_lost' | 'disconnected' | 'folder_trashed' | 'folder_missing';
export interface LinkState {
  googleEmail: string; folderId: string; snapshotsFolderId: string; photosFolderId: string; lockFileId: string;
  deviceId: string; generation: number; lastSnapshotSeq: number; uploadedChangeSeq: number; keyId: string;
  status: LinkStatus; lastSnapshotAt: string | null;
}

export interface BackupKey { cryptoKey: CryptoKey; keyId: string; wrapped: WrappedKey }

/** What the engine needs from the app. Implemented over the DB worker in the browser, faked in tests. */
export interface SyncHost {
  /** Null on a new device until a restore adopts the key from the backup. */
  key: BackupKey | null;
  appVersion: string;
  schemaVersion: number;
  deviceName: string;
  exportSnapshot(): Promise<Uint8Array>;
  changeSeq(): Promise<number>;
  totals(): Promise<Totals>;
  getLink(): Promise<LinkState | null>;
  setLink(l: LinkState | null): Promise<void>;
  applyRestore(dbBytes: Uint8Array): Promise<RestoreResult>;
  adoptKey(k: BackupKey): Promise<void>;
}

export type SnapshotOutcome = 'uploaded' | 'up_to_date' | 'lock_lost' | 'needs_signin' | 'quota_full' | 'folder_trashed' | 'folder_missing' | 'offline' | 'not_connected';

const randomHex = (n: number) => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));

async function collect(it: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for await (const c of it) parts.push(new Uint8Array(c));
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
async function gzip(bytes: Uint8Array, mode: 'compress' | 'decompress'): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(mode === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function* once(b: Uint8Array) { yield b; }

function toSnap(f: DriveFile): Snap | null {
  const p = f.appProperties ?? {};
  if (!p.snapshot_seq || !p.generation) return null;
  return {
    id: f.id, generation: Number(p.generation), seq: Number(p.snapshot_seq), deviceId: p.device_id ?? '', keyId: p.key_id ?? '',
    schemaVersion: Number(p.schema_version ?? 0), modifiedTime: f.modifiedTime ?? new Date(0).toISOString(), beforeBigChange: p.before_big_change === '1',
  };
}
const totalsOf = (f: DriveFile | undefined): Totals | null => {
  const p = f?.appProperties;
  return p?.t_boxes ? { boxes: Number(p.t_boxes), items: Number(p.t_items), onHand: Number(p.t_on_hand), photos: Number(p.t_photos) } : null;
};

export class DriveSync {
  /** Test hook: runs between upload and the final lock check. */
  beforeFinalLockCheck: (() => Promise<void>) | null = null;

  constructor(private readonly api: DriveApi, private readonly host: SyncHost) {}

  private key(): BackupKey {
    if (!this.host.key) throw new Error('Set up backups (recovery code) before connecting Google Drive');
    return this.host.key;
  }

  private async subfolders(folderId: string) {
    const kids = await this.api.listChildren(folderId);
    const find = (n: string) => kids.find((k) => k.name === n);
    return { snapshots: find('snapshots'), photos: find('photos'), lock: find('device.lock'), kids };
  }

  async listSnapshots(snapshotsFolderId: string): Promise<{ snaps: Snap[]; files: DriveFile[] }> {
    const files = (await this.api.listChildren(snapshotsFolderId)).filter((f) => f.name.endsWith('.btdb'));
    return { snaps: files.map(toSnap).filter((s): s is Snap => !!s), files };
  }

  /** Step 1 of Connect (audit B2): look before writing anything. */
  async inspect(): Promise<ConnectDecision> {
    const folders = await this.api.findFolders(ROOT_NAME);
    const seen = [];
    for (const f of folders) {
      const sub = await this.subfolders(f.id);
      seen.push({ id: f.id, snapshots: sub.snapshots ? (await this.listSnapshots(sub.snapshots.id)).snaps : [] });
    }
    return connectDecision(seen, this.host.key?.keyId ?? '');
  }

  private async lockBytes(deviceId: string, generation: number): Promise<Uint8Array> {
    const body = new TextEncoder().encode(JSON.stringify({ device_id: deviceId, device_name: this.host.deviceName, generation, taken_at: new Date().toISOString() }));
    return collect(encryptFile('BTLK1', { app_version: this.host.appVersion, schema_version: this.host.schemaVersion }, this.key(), once(body)));
  }

  private async readLock(lockFileId: string): Promise<Lock | null> {
    try {
      const f = await this.api.getFile(lockFileId);
      if (f.trashed) return null;
      const p = f.appProperties ?? {};
      return p.device_id ? { deviceId: p.device_id, generation: Number(p.generation) } : null;
    } catch (e) {
      if (e instanceof DriveError && e.kind === 'not_found') return null;
      throw e;
    }
  }

  private async takeLock(lockFileId: string | undefined, parent: string, deviceId: string, generation: number): Promise<string> {
    const bytes = await this.lockBytes(deviceId, generation);
    const props = { generation: String(generation), device_id: deviceId };
    if (lockFileId) {
      await this.api.overwrite(lockFileId, props, bytes);
      return lockFileId;
    }
    const [id] = await this.api.generateIds(1);
    await this.api.upload({ id: id!, name: 'device.lock', parent, appProperties: props, bytes });
    return id!;
  }

  private async layout(folderId: string) {
    const sub = await this.subfolders(folderId);
    const snapshots = sub.snapshots ?? await this.api.createFolder('snapshots', folderId);
    const photos = sub.photos ?? await this.api.createFolder('photos', folderId);
    if (!sub.kids.some((k) => k.name === 'README.txt')) {
      const [id] = await this.api.generateIds(1);
      await this.api.upload({ id: id!, name: 'README.txt', parent: folderId, appProperties: {}, bytes: new TextEncoder().encode(README) });
    }
    return { snapshots: snapshots.id, photos: photos.id, lock: sub.lock?.id };
  }

  /**
   * Connect when inspect() said create/use, or the user chose "Start a new backup folder". Never writes into a
   * folder that holds snapshots (audit B2); that folder is renamed and left alone.
   */
  async connect(googleEmail: string, opts: { startNewFolder?: boolean; now?: string } = {}): Promise<void> {
    const key = this.key();
    const d = await this.inspect();
    let folderId: string;
    if (d.kind === 'offer_restore') {
      if (!opts.startNewFolder) throw new Error('This Google Drive has an existing backup. Restore it, or start a new backup folder.');
      await this.api.rename(d.folderId, `${ROOT_NAME} (old ${(opts.now ?? new Date().toISOString()).slice(0, 10)})`);
      folderId = (await this.api.createFolder(ROOT_NAME)).id;
    } else {
      folderId = d.kind === 'use' ? d.folderId : (await this.api.createFolder(ROOT_NAME)).id;
    }
    const l = await this.layout(folderId);
    const deviceId = `d_${randomHex(8)}`;
    const lockFileId = await this.takeLock(l.lock, folderId, deviceId, 1);
    await this.host.setLink({
      googleEmail, folderId, snapshotsFolderId: l.snapshots, photosFolderId: l.photos, lockFileId, deviceId,
      generation: 1, lastSnapshotSeq: 0, uploadedChangeSeq: 0, keyId: key.keyId, status: 'ok', lastSnapshotAt: null,
    });
  }

  private async setStatus(link: LinkState, status: LinkStatus) {
    if (link.status !== status) await this.host.setLink({ ...link, status });
  }

  /** One snapshot cycle (§6.1 upload rules, §6.2 rules 2 and 8). Safe to call often: it skips when nothing changed. */
  async snapshotNow(): Promise<SnapshotOutcome> {
    const link = await this.host.getLink();
    if (!link) return 'not_connected';
    if (link.status === 'lock_lost') return 'lock_lost';
    try {
      const folder = await this.api.getFile(link.folderId);
      if (folder.trashed) { await this.setStatus(link, 'folder_trashed'); return 'folder_trashed'; }
      const change = await this.host.changeSeq();
      const { snaps, files } = await this.listSnapshots(link.snapshotsFolderId);
      const lockBefore = await this.readLock(link.lockFileId);
      if (lockState(lockBefore, link.deviceId, link.generation, snaps) !== 'ok') { await this.setStatus(link, 'lock_lost'); return 'lock_lost'; }
      if (snaps.some((s) => s.keyId !== link.keyId)) { await this.setStatus(link, 'lock_lost'); return 'lock_lost'; } // never mix keys
      if (change <= link.uploadedChangeSeq && link.lastSnapshotSeq > 0) { await this.setStatus(link, 'ok'); return 'up_to_date'; }

      const totals = await this.host.totals();
      const mine = snaps.filter((s) => s.generation === link.generation);
      const prev = newest(mine);
      const prevTotals = totalsOf(files.find((f) => f.id === prev?.id));
      if (prev && prevTotals && isBigChange(prevTotals, totals)) {
        await this.api.setProperties(prev.id, { before_big_change: '1' }); // keep the copy from before the drop for 30 days
      }

      const db = await this.host.exportSnapshot();
      const payload = await gzip(await collect(pack([{ name: 'db.sqlite', data: db }, { name: 'manifest.json', data: new TextEncoder().encode('{"format":1,"photos":[]}') }])), 'compress');
      const bytes = await collect(encryptFile('BTDB1', { app_version: this.host.appVersion, schema_version: this.host.schemaVersion }, this.key(), once(payload)));
      const seq = link.lastSnapshotSeq + 1;
      const [id] = await this.api.generateIds(1);
      await this.api.upload({
        id: id!, name: `s-${randomHex(12)}.btdb`, parent: link.snapshotsFolderId,
        appProperties: {
          snapshot_seq: String(seq), generation: String(link.generation), device_id: link.deviceId, key_id: link.keyId,
          schema_version: String(this.host.schemaVersion), before_big_change: '0',
          t_boxes: String(totals.boxes), t_items: String(totals.items), t_on_hand: String(totals.onHand), t_photos: String(totals.photos),
        },
        bytes,
      });
      if (this.beforeFinalLockCheck) await this.beforeFinalLockCheck();
      const lockAfter = await this.readLock(link.lockFileId);
      if (lockState(lockAfter, link.deviceId, link.generation, []) !== 'ok') {
        await this.api.remove(id!); // lost the lock meanwhile: take back our snapshot (§6.2 rule 2)
        await this.setStatus(link, 'lock_lost');
        return 'lock_lost';
      }
      const now = new Date().toISOString();
      const after = await this.listSnapshots(link.snapshotsFolderId);
      for (const pid of toPrune(after.snaps, link.generation, now)) if (pid !== id) await this.api.remove(pid);
      await this.host.setLink({ ...link, lastSnapshotSeq: seq, uploadedChangeSeq: change, status: 'ok', lastSnapshotAt: now });
      return 'uploaded';
    } catch (e) {
      if (!(e instanceof DriveError)) throw e;
      const map: Partial<Record<DriveError['kind'], SnapshotOutcome>> = { auth: 'needs_signin', quota: 'quota_full', not_found: 'folder_missing', network: 'offline' };
      const out = map[e.kind];
      if (!out) throw e;
      if (out !== 'offline') await this.setStatus(link, out as LinkStatus);
      return out;
    }
  }

  /**
   * Restore from Drive (§6.1 Restore, §6.2 rules 4-5): newest by (generation, seq), decrypt with the recovery code,
   * hand the database to the app's validated, crash-safe restore, then take the lock with generation + 1.
   * Nothing changes on the device if the code is wrong.
   */
  async restore(folderId: string, recoveryCode: string, googleEmail: string, snapshotId?: string): Promise<RestoreResult> {
    const sub = await this.subfolders(folderId);
    if (!sub.snapshots) throw new Error('This BoxTap backup folder has no snapshots');
    const { snaps } = await this.listSnapshots(sub.snapshots.id);
    const pick = snapshotId ? snaps.find((s) => s.id === snapshotId) : newest(snaps);
    if (!pick) throw new Error('This BoxTap backup folder has no snapshots');
    const file = await this.api.download(pick.id);
    const { header } = readHeader(file);
    const plain = await collect(decryptFile(file, recoveryCode, { maxSchema: this.host.schemaVersion }));
    const entries = await unpack(await gzip(plain, 'decompress'));
    const dbEntry = entries.find((e) => e.name === 'db.sqlite');
    if (!dbEntry) throw new Error('This snapshot has no database in it');
    const result = await this.host.applyRestore(dbEntry.data);

    const wrapped: WrappedKey = { kdf: header.kdf, ...header.wrapped_key_by_recovery };
    const raw = await unwrapBackupKey(wrapped, recoveryCode);
    const key: BackupKey = { cryptoKey: await importBackupKey(raw), keyId: header.key_id, wrapped };
    raw.fill(0);
    await this.host.adoptKey(key);

    const lock = sub.lock ? await this.readLock(sub.lock.id) : null;
    const generation = Math.max(lock?.generation ?? 0, ...snaps.map((s) => s.generation)) + 1;
    const deviceId = `d_${randomHex(8)}`;
    const l = await this.layout(folderId);
    const lockFileId = await this.takeLock(l.lock, folderId, deviceId, generation);
    await this.host.setLink({
      googleEmail, folderId, snapshotsFolderId: l.snapshots, photosFolderId: l.photos, lockFileId, deviceId, generation,
      lastSnapshotSeq: pick.seq, uploadedChangeSeq: await this.host.changeSeq(), keyId: key.keyId, status: 'ok', lastSnapshotAt: null,
    });
    return result;
  }

  /** Stops syncing and forgets the folder. Files stay in the user's Drive. */
  async disconnect(): Promise<void> {
    await this.host.setLink(null);
  }
}
