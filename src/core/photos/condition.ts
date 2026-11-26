// Condition photos (Removalist Phase 4): caption burned in, shrunk, hashed, saved, then recorded with its time and
// source. Files are removed again if the row can't be written, as for other photos.
import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { WorkerError } from '../db/client';
import { photoFiles } from '../repo/photos';
import { processPhoto } from './encode';
import { removePhotoFile, writePhotoFile } from './store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The caption burned into a condition photo, always in English (Latin text any insurer can read; owner OK
 * 2026-11-26): "26 Nov 2026 14:32 · J-0042 · Box 7 · Pickup". Local time of the phone.
 */
export function conditionCaption(at: Date, jobNumber: string, isPiece: boolean, seq: number, stage: 'pickup' | 'delivery'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const when = `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()} ${p(at.getHours())}:${p(at.getMinutes())}`;
  return `${when} · ${jobNumber} · ${isPiece ? 'Piece' : 'Box'} ${seq} · ${stage === 'pickup' ? 'Pickup' : 'Delivery'}`;
}

export interface ConditionShot {
  workspaceId: string; jobId: string; boxId: string; stage: 'pickup' | 'delivery';
  file: Blob; source: 'camera' | 'library'; capturedAt: Date; caption: string; amendmentId?: string;
}

export async function addConditionPhotoFromFile(db: Db, s: ConditionShot) {
  const count = await db.conditionPhotoCount(s.jobId, s.boxId, s.stage);
  const ok = await db.check('add_condition_photo', s.workspaceId, count);
  if (!ok.allowed) throw new WorkerError('BlockedError', `blocked:${ok.reason}`, ok.reason);
  const p = await processPhoto(s.file, { caption: s.caption });
  const id = uuidv7();
  const names = photoFiles(id, p.mime);
  await writePhotoFile(names.fileName, p.full);
  try {
    await writePhotoFile(names.thumbName, p.thumb);
    return await db.addConditionPhoto({
      jobId: s.jobId, locationId: s.boxId, stage: s.stage, capturedAt: s.capturedAt.toISOString(), source: s.source,
      photo: { id, mime: p.mime, bytes: p.full.size, sha256: p.sha256 }, amendmentId: s.amendmentId,
    });
  } catch (e) {
    await removePhotoFile(names.fileName);
    await removePhotoFile(names.thumbName);
    throw e;
  }
}
