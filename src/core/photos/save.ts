// Adding a photo: check the limit first, shrink it, write the files, then the row. Files are removed again if
// the row can't be written, so a failure never leaves half a photo (W5: storage full rolls back cleanly).
import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { WorkerError } from '../db/client';
import { photoFiles, type Photo } from '../repo/photos';
import { processPhoto } from './encode';
import { readPhotoFile, removePhotoFile, writePhotoFile } from './store';

export async function addPhotoFromFile(db: Db, workspaceId: string, parent: { locationId?: string; itemId?: string }, file: Blob): Promise<Photo> {
  const count = (await db.listPhotos(parent)).length;
  const ok = await db.check('add_photo', workspaceId, count);
  if (!ok.allowed) throw new WorkerError('BlockedError', `blocked:${ok.reason}`, ok.reason);
  const p = await processPhoto(file);
  const id = uuidv7();
  const names = photoFiles(id, p.mime);
  await writePhotoFile(names.fileName, p.full);
  try {
    await writePhotoFile(names.thumbName, p.thumb);
    return await db.addPhoto({
      id, workspaceId, locationId: parent.locationId ?? null, itemId: parent.itemId ?? null,
      mime: p.mime, bytes: p.full.size, sha256: p.sha256,
    });
  } catch (e) {
    await removePhotoFile(names.fileName);
    await removePhotoFile(names.thumbName);
    throw e;
  }
}

/** Object URL for a photo or its thumbnail, or null if the file isn't on this device (yet). */
export async function photoUrl(name: string): Promise<string | null> {
  const b = await readPhotoFile(name);
  return b ? URL.createObjectURL(b) : null;
}
