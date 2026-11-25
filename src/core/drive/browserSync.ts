// Connects the Drive engine to the app: the DB worker as SyncHost, the in-memory token, and the schedule
// (2 minutes after the last change, at most every 15 minutes, and when the app goes to the background).
import type { Db } from '../db/client';
import { SCHEMA_VERSION } from '../db/schema';
import { loadBackupKey, saveBackupKey } from '../backup/keystore';
import { DriveApi } from './api';
import { currentToken } from './googleAuth';
import { DriveSync, type BackupKey, type LinkState, type SnapshotOutcome, type SyncHost } from './sync';
import type { WrappedKey } from '../backup/crypto';
import { PhotoSync, type PhotoHost, type PhotoRun } from './photoSync';
import { readPhotoFile, writePhotoFile } from '../photos/store';
import { makeThumb } from '../photos/encode';

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  return 'Computer';
}

export async function browserHost(db: Db): Promise<SyncHost> {
  const stored = await db.getSetting('backup_key');
  const k = await loadBackupKey();
  const key: BackupKey | null = stored && k ? { cryptoKey: k.cryptoKey, keyId: k.keyId, wrapped: (JSON.parse(stored) as { wrapped: WrappedKey }).wrapped } : null;
  const host: SyncHost = {
    key,
    appVersion: __APP_VERSION__,
    schemaVersion: SCHEMA_VERSION,
    deviceName: deviceName(),
    exportSnapshot: () => db.exportSnapshot(),
    changeSeq: () => db.changeSeq(),
    totals: () => db.driveTotals(),
    getLink: () => db.getDriveLink(),
    setLink: (l: LinkState | null) => db.setDriveLink(l),
    applyRestore: (bytes) => db.restore(bytes),
    adoptKey: async (nk) => {
      await saveBackupKey({ keyId: nk.keyId, cryptoKey: nk.cryptoKey });
      await db.setSetting('backup_key', JSON.stringify({ keyId: nk.keyId, wrapped: nk.wrapped }));
      host.key = nk;
    },
  };
  return host;
}

export const driveApi = (): DriveApi => new DriveApi(currentToken);

/** Android Chrome can tell mobile data from Wi-Fi; Safari can't (it gets "Pause photo uploads" later). */
function onMobileData(): boolean {
  const c = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  return c?.type === 'cellular' || !!c?.saveData;
}

async function photoHost(db: Db): Promise<PhotoHost> {
  const base = await browserHost(db);
  return {
    key: base.key, appVersion: base.appVersion, schemaVersion: base.schemaVersion,
    due: () => db.outboxDue(new Date().toISOString()),
    reserve: (id, fileId) => db.outboxReserve(id, fileId),
    done: (id) => db.outboxDone(id),
    failed: (id, err) => db.outboxFailed(id, err),
    photo: async (id) => {
      const p = await db.getPhoto(id);
      return p ? { id: p.id, fileName: p.fileName, deleted: p.deletedAt != null, mime: p.mime } : null;
    },
    readFile: async (name) => { const b = await readPhotoFile(name); return b ? new Uint8Array(await b.arrayBuffer()) : null; },
    writePhoto: async (id, bytes) => {
      const p = await db.getPhoto(id);
      if (!p) return;
      const blob = new Blob([new Uint8Array(bytes)], { type: p.mime });
      await writePhotoFile(p.fileName, blob);
      await writePhotoFile(p.thumbName, await makeThumb(blob)).catch(() => {});
    },
    setDriveFile: (id, fileId) => db.setPhotoDriveFile(id, fileId),
    // "Upload photos only on Wi-Fi" is on by default where the browser can tell (assumption 9); anyone can pause.
    mayUploadPhotos: async () => !onMobileData() && !(await db.photoUploadsPaused()),
  };
}

/** One pass over the photo queue, if Drive is connected and a token is held. */
export async function runPhotoQueue(db: Db): Promise<PhotoRun | null> {
  if (!currentToken()) return null;
  const link = await db.getDriveLink();
  if (!link || link.status === 'lock_lost' || link.status === 'folder_trashed') return null;
  const run = await new PhotoSync(driveApi(), await photoHost(db), link.photosFolderId).run({ max: 30 });
  if (run.quotaFull && link.status !== 'quota_full') await db.setDriveLink({ ...link, status: 'quota_full' });
  return run;
}

export async function makeSync(db: Db): Promise<DriveSync> {
  return new DriveSync(driveApi(), await browserHost(db));
}

const QUIET_MS = 2 * 60_000;
const MIN_GAP_MS = 15 * 60_000;

/**
 * Background schedule while the app is open. Runs only with a token (no pop-ups without a tap).
 * Returns a stop function. `onOutcome` lets the UI update its status chip.
 */
export function startSchedule(db: Db, onOutcome: (o: SnapshotOutcome) => void): () => void {
  let lastSeq = -1;
  let lastChangeAt = Date.now();
  let lastUpload = 0;
  let running = false;

  const run = async (force: boolean) => {
    if (running || !currentToken()) return;
    const link = await db.getDriveLink();
    if (!link || link.status === 'lock_lost') return;
    running = true;
    try {
      const out = await (await makeSync(db)).snapshotNow();
      if (out === 'uploaded') lastUpload = Date.now();
      onOutcome(out);
    } catch (e) {
      console.warn('drive sync failed', e);
    } finally {
      running = false;
    }
    void force;
  };

  const tick = async () => {
    const seq = await db.changeSeq().catch(() => lastSeq);
    if (seq !== lastSeq) { lastSeq = seq; lastChangeAt = Date.now(); }
    const quiet = Date.now() - lastChangeAt >= QUIET_MS;
    const gapOk = Date.now() - lastUpload >= MIN_GAP_MS;
    if (quiet && gapOk) await run(false);
    if (!running && currentToken()) {
      running = true;
      try { await runPhotoQueue(db); } catch (e) { console.warn('photo queue failed', e); } finally { running = false; }
    }
  };
  const timer = setInterval(() => void tick(), 30_000);
  const onHide = () => { if (document.visibilityState === 'hidden') void run(true); };
  document.addEventListener('visibilitychange', onHide);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onHide); };
}
