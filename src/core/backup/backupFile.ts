// "Back up now" and "Restore from a backup file" (API_CONTRACTS §6, ADR-016).
import type { Db } from '../db/client';
import { SCHEMA_VERSION } from '../db/schema';
import {
  createKeyMaterial, decryptBlob, encryptFile, importBackupKey, readHeader, rewrapBackupKey, unwrapBackupKey, type WrappedKey,
} from './crypto';
import { pack, unpackStream } from './pack';
import { loadBackupKey, saveBackupKey } from './keystore';
import type { RestoreResult } from '../db/protocol';
import { readPhotoFile, removeOrphans, writePhotoFile } from '../photos/store';
import { makeThumb } from '../photos/encode';
import type { Entry } from './pack';
import type { Photo } from '../repo/photos';

interface StoredWrapped { keyId: string; wrapped: WrappedKey }

/** Setup for "New to BoxTap": make the key, keep only the wrapped blob and a non-extractable copy. */
export async function setUpBackupKey(db: Db, recoveryCode: string): Promise<void> {
  const km = await createKeyMaterial(recoveryCode);
  await saveBackupKey({ keyId: km.keyId, cryptoKey: await importBackupKey(km.raw) });
  km.raw.fill(0);
  await db.setSetting('backup_key', JSON.stringify({ keyId: km.keyId, wrapped: km.wrapped } satisfies StoredWrapped));
}

/** True if the code opens this device's backup key (checked before asking for a new code). */
export async function checkRecoveryCode(db: Db, code: string): Promise<boolean> {
  const stored = await db.getSetting('backup_key');
  if (!stored) return false;
  try {
    (await unwrapBackupKey((JSON.parse(stored) as StoredWrapped).wrapped, code)).fill(0);
    return true;
  } catch {
    return false;
  }
}

/** Change recovery code (B7): the old code re-wraps the same key; nothing else changes. */
export async function changeRecoveryCode(db: Db, oldCode: string, newCode: string): Promise<void> {
  const stored = await db.getSetting('backup_key');
  if (!stored) throw new Error('Backups are not set up on this device yet');
  const s = JSON.parse(stored) as StoredWrapped;
  const wrapped = await rewrapBackupKey(s.wrapped, oldCode, newCode);
  await db.setSetting('backup_key', JSON.stringify({ keyId: s.keyId, wrapped } satisfies StoredWrapped));
}

/**
 * New recovery code when the old one is lost (B7): a new backup key. Old backups need the old code, so the
 * Drive link is closed; connecting again then offers "Start a new backup folder" (the old folder is kept, renamed).
 */
export async function replaceRecoveryCode(db: Db, newCode: string): Promise<void> {
  await setUpBackupKey(db, newCode);
  if (await db.getDriveLink()) await db.setDriveLink(null);
}

export async function hasBackupKey(db: Db): Promise<boolean> {
  return !!(await db.getSetting('backup_key')) && !!(await loadBackupKey());
}

/** Builds an encrypted .btbak file of the whole database (photos join when Phase 1 photos land). */
export async function createBackupFile(db: Db): Promise<File> {
  const stored = await db.getSetting('backup_key');
  const key = await loadBackupKey();
  if (!stored || !key) throw new Error('Backups are not set up on this device yet');
  const { keyId, wrapped } = JSON.parse(stored) as StoredWrapped;
  if (keyId !== key.keyId) throw new Error('Backup key mismatch on this device');
  const snapshot = await db.exportSnapshot();
  const photos = await db.allLivePhotos();
  // Full-size photos go in the file; thumbnails are rebuilt on restore. Photos are read one at a time.
  async function* entries(): AsyncGenerator<Entry> {
    const included: { id: string; file: string; sha256: string | null }[] = [];
    yield { name: 'db.sqlite', data: snapshot };
    for (const p of photos) {
      const blob = await readPhotoFile(p.fileName);
      if (!blob) continue; // not on this device (e.g. still downloading after a restore)
      included.push({ id: p.id, file: p.fileName, sha256: p.sha256 });
      yield { name: p.fileName, data: new Uint8Array(await blob.arrayBuffer()) };
    }
    yield { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify({ format: 1, photos: included })) };
  }
  const parts: BlobPart[] = [];
  for await (const c of encryptFile('BTBAK2', { app_version: __APP_VERSION__, schema_version: SCHEMA_VERSION },
    { cryptoKey: key.cryptoKey, keyId, wrapped }, pack(entries()))) {
    parts.push(new Uint8Array(c));
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = new File(parts, `BoxTap-backup-${stamp}.btbak`, { type: 'application/octet-stream' });
  return file;
}

/** Share sheet on phones, download elsewhere (W6: falls back to download). */
export async function deliverFile(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // iPhone: after a long wait the tap no longer counts, so sharing is refused. Offer a button to tap instead
      // of a download, which in the home-screen app opens a viewer with no way back (review finding 17).
      if ((e as Error).name === 'NotAllowedError') {
        window.dispatchEvent(new CustomEvent('boxtap:share-file', { detail: file }));
        return 'shared';
      }
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/**
 * Restores a .btbak with the recovery code. Nothing on the device changes unless the code is right and the
 * file is valid (critical tests 9 and 10). The backup key from the file becomes this device's key.
 */
export async function restoreBackupFile(db: Db, file: Blob, recoveryCode: string): Promise<RestoreResult> {
  // Read the backup in 1 MB pieces (review finding 13). The database comes first in the file: it is validated and
  // swapped in (crash-safe, with a safety copy) before any photo is written; photos then go straight to storage.
  const { header } = readHeader(new Uint8Array(await file.slice(0, 10 + 64 * 1024).arrayBuffer()));
  let result: RestoreResult | null = null;
  let byFile = new Map<string, Photo>();
  await unpackStream(decryptBlob(file, recoveryCode, { maxSchema: SCHEMA_VERSION }), async (e) => {
    if (e.name === 'db.sqlite') {
      result = await db.restore(e.data);
      byFile = new Map((await db.allLivePhotos()).map((p) => [p.fileName, p]));
      return;
    }
    const p = byFile.get(e.name);
    if (!result || !p) return;
    const blob = new Blob([new Uint8Array(e.data)], { type: p.mime });
    await writePhotoFile(p.fileName, blob);
    await writePhotoFile(p.thumbName, await makeThumb(blob)).catch(() => {});
  });
  if (!result) throw new Error('This backup has no database in it');
  await removeOrphans(new Set([...byFile.values()].flatMap((p) => [p.fileName, p.thumbName])));
  const wrapped: WrappedKey = { kdf: header.kdf, ...header.wrapped_key_by_recovery };
  const raw = await unwrapBackupKey(wrapped, recoveryCode);
  await saveBackupKey({ keyId: header.key_id, cryptoKey: await importBackupKey(raw) });
  raw.fill(0);
  await db.setSetting('backup_key', JSON.stringify({ keyId: header.key_id, wrapped } satisfies StoredWrapped));
  return result;
}
