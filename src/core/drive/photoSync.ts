// Drive photo queue (API_CONTRACTS §6.1 upload rules, audit B10, A7). Photos upload once (they never change),
// encrypted with the backup key, under random names; ids are reserved before the first try so a retry after
// a lost reply finds a 409 instead of making a duplicate. Uploads, deletes and post-restore downloads share
// one persisted queue (drive_outbox), so closing the app mid-way just resumes next time.
import { DriveApi, DriveError } from './api';
import { decryptFile, encryptFile } from '../backup/crypto';
import type { BackupKey } from './sync';

export interface QueueRow { photoId: string; op: 'upload' | 'delete' | 'download'; driveFileId: string | null; attempts: number }

export interface PhotoHost {
  key: BackupKey | null;
  appVersion: string;
  schemaVersion: number;
  due(): Promise<QueueRow[]>;
  reserve(photoId: string, fileId: string): Promise<void>;
  done(photoId: string): Promise<void>;
  failed(photoId: string, error: string): Promise<void>;
  photo(id: string): Promise<{ id: string; fileName: string; deleted: boolean; mime: 'image/webp' | 'image/jpeg'; driveFileId: string | null } | null>;
  /** Queue a fresh upload (its Drive copy was found missing). */
  requeueUpload(id: string): Promise<void>;
  readFile(name: string): Promise<Uint8Array | null>;
  /** Writes the photo file and rebuilds its thumbnail. */
  writePhoto(id: string, bytes: Uint8Array): Promise<void>;
  /** Null clears it: the photo then shows "This photo wasn't backed up". */
  setDriveFile(id: string, fileId: string | null): Promise<void>;
  /** False on mobile data when "Upload photos only on Wi-Fi" is on (where the browser can tell). */
  mayUploadPhotos(): Promise<boolean>;
}

export interface PhotoRun { uploaded: number; deleted: number; downloaded: number; failed: number; waitingForWifi: boolean; quotaFull: boolean; needsSignin: boolean }

async function collect(it: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for await (const c of it) parts.push(new Uint8Array(c));
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
async function* once(b: Uint8Array) { yield b; }

export class PhotoSync {
  constructor(private readonly api: DriveApi, private readonly host: PhotoHost, readonly folderId: string) {}

  private key(): BackupKey {
    if (!this.host.key) throw new Error('no backup key on this device');
    return this.host.key;
  }

  /** Works through due queue rows. `max` limits how many rows this run handles. */
  async run(opts: { max?: number } = {}): Promise<PhotoRun> {
    const r: PhotoRun = { uploaded: 0, deleted: 0, downloaded: 0, failed: 0, waitingForWifi: false, quotaFull: false, needsSignin: false };
    const rows = (await this.host.due()).slice(0, opts.max ?? Infinity);
    const mayUpload = await this.host.mayUploadPhotos();
    for (const row of rows) {
      try {
        if (row.op === 'upload') {
          if (!mayUpload) { r.waitingForWifi = true; continue; }
          if (r.quotaFull) continue;
          if (await this.upload(row)) r.uploaded++;
        } else if (row.op === 'delete') {
          if (row.driveFileId) await this.api.remove(row.driveFileId); // permanent delete, not trash
          await this.host.done(row.photoId);
          r.deleted++;
        } else {
          if (await this.download(row)) r.downloaded++;
        }
      } catch (e) {
        if (e instanceof DriveError && e.kind === 'quota') { r.quotaFull = true; continue; } // snapshots continue
        if (e instanceof DriveError && e.kind === 'auth') { r.needsSignin = true; break; }
        r.failed++;
        await this.host.failed(row.photoId, (e as Error).message);
      }
    }
    return r;
  }

  /**
   * Weekly check (DATABASE_SCHEMA §5 step 5): list the Drive photos folder once and re-queue any live photo whose
   * Drive copy is gone (e.g. deleted in the Drive website). Drive files are never deleted here.
   */
  async checkPhotos(livePhotoIds: readonly string[]): Promise<{ missing: number }> {
    const inDrive = new Set((await this.api.listChildren(this.folderId)).map((f) => f.id));
    let missing = 0;
    for (const id of livePhotoIds) {
      const p = await this.host.photo(id);
      if (!p || p.deleted || !p.driveFileId || inDrive.has(p.driveFileId)) continue;
      await this.host.setDriveFile(id, null);
      await this.host.requeueUpload(id);
      missing++;
    }
    return { missing };
  }

  private async upload(row: QueueRow): Promise<boolean> {
    const p = await this.host.photo(row.photoId);
    if (!p) { await this.host.done(row.photoId); return false; } // purged
    if (p.deleted) return false; // in the bin: it may still be restored, so hold it back
    const plain = await this.host.readFile(p.fileName);
    if (!plain) throw new Error('photo file missing on this device');
    let fileId = row.driveFileId;
    if (!fileId) {
      [fileId] = await this.api.generateIds(1) as [string];
      await this.host.reserve(row.photoId, fileId);
    }
    const bytes = await collect(encryptFile('BTPH1', { app_version: this.host.appVersion, schema_version: this.host.schemaVersion }, this.key(), once(plain)));
    // The Drive-made id doubles as photo_ref: random, and unlike UUID v7 it doesn't reveal when it was taken.
    await this.api.upload({ id: fileId, name: `${fileId}.btph`, parent: this.folderId, appProperties: { photo_ref: fileId }, bytes });
    await this.host.setDriveFile(row.photoId, fileId);
    await this.host.done(row.photoId);
    return true;
  }

  private async download(row: QueueRow): Promise<boolean> {
    const p = await this.host.photo(row.photoId);
    if (!p || !row.driveFileId) { await this.host.done(row.photoId); return false; }
    let file: Uint8Array;
    try {
      file = await this.api.download(row.driveFileId);
    } catch (e) {
      if (e instanceof DriveError && e.kind === 'not_found') {
        // Audit A7: Drive doesn't have it; say so instead of waiting forever.
        await this.host.setDriveFile(row.photoId, null);
        await this.host.done(row.photoId);
        return false;
      }
      throw e;
    }
    const k = this.key();
    const plain = await collect(decryptFile(file, { cryptoKey: k.cryptoKey, keyId: k.keyId }, { maxSchema: this.host.schemaVersion }));
    await this.host.writePhoto(row.photoId, plain);
    await this.host.done(row.photoId);
    return true;
  }
}
