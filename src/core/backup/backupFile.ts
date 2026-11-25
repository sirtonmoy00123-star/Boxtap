// "Back up now" and "Restore from a backup file" (API_CONTRACTS §6, ADR-016).
import type { Db } from '../db/client';
import { SCHEMA_VERSION } from '../db/schema';
import {
  createKeyMaterial, decryptFile, encryptFile, importBackupKey, readHeader, unwrapBackupKey, type WrappedKey,
} from './crypto';
import { pack, unpack } from './pack';
import { loadBackupKey, saveBackupKey } from './keystore';
import type { RestoreResult } from '../db/protocol';

interface StoredWrapped { keyId: string; wrapped: WrappedKey }

/** Setup for "New to BoxTap": make the key, keep only the wrapped blob and a non-extractable copy. */
export async function setUpBackupKey(db: Db, recoveryCode: string): Promise<void> {
  const km = await createKeyMaterial(recoveryCode);
  await saveBackupKey({ keyId: km.keyId, cryptoKey: await importBackupKey(km.raw) });
  km.raw.fill(0);
  await db.setSetting('backup_key', JSON.stringify({ keyId: km.keyId, wrapped: km.wrapped } satisfies StoredWrapped));
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
  const manifest = new TextEncoder().encode(JSON.stringify({ format: 1, photos: [] }));
  const parts: BlobPart[] = [];
  for await (const c of encryptFile('BTBAK2', { app_version: __APP_VERSION__, schema_version: SCHEMA_VERSION },
    { cryptoKey: key.cryptoKey, keyId, wrapped },
    pack([{ name: 'db.sqlite', data: snapshot }, { name: 'manifest.json', data: manifest }]))) {
    parts.push(new Uint8Array(c));
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = new File(parts, `BoxTap-backup-${stamp}.btbak`, { type: 'application/octet-stream' });
  await db.markBackedUp(new Date().toISOString());
  return file;
}

/** Share sheet on phones, download elsewhere (W6: falls back to download). */
export async function deliverFile(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'BoxTap backup' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
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
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { header } = readHeader(bytes);
  const parts: Uint8Array[] = [];
  for await (const c of decryptFile(bytes, recoveryCode, { maxSchema: SCHEMA_VERSION })) parts.push(c);
  const payload = new Uint8Array(await new Blob(parts.map((p) => new Uint8Array(p))).arrayBuffer());
  const entries = await unpack(payload);
  const dbEntry = entries.find((e) => e.name === 'db.sqlite');
  if (!dbEntry) throw new Error('This backup has no database in it');
  const result = await db.restore(dbEntry.data);
  const wrapped: WrappedKey = { kdf: header.kdf, ...header.wrapped_key_by_recovery };
  const raw = await unwrapBackupKey(wrapped, recoveryCode);
  await saveBackupKey({ keyId: header.key_id, cryptoKey: await importBackupKey(raw) });
  raw.fill(0);
  await db.setSetting('backup_key', JSON.stringify({ keyId: header.key_id, wrapped } satisfies StoredWrapped));
  return result;
}
