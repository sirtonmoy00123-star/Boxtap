// The 30-day bin and its daily purge (DATABASE_SCHEMA §5 step 3).
import { type Ctx, daysBefore, num, str, write } from './core';
import { queueDriveDelete } from './photos';
import { LOCKED_PHOTO } from '../db/schemaV6';
import { listBinJobs, type BinJob } from './removalist/jobs';

export interface BinBox { id: string; number: number; name: string | null; deletedAt: string }
export interface BinItem { id: string; name: string; boxNumber: number; deletedAt: string }

export function listBin(ctx: Ctx, workspaceId: string): { boxes: BinBox[]; items: BinItem[]; jobs: BinJob[] } {
  // Boxes binned over 30 days ago that the purge had to keep (stock history) are archived: hidden, not restorable here.
  const cutoff = daysBefore(ctx.now(), 30);
  const boxes = ctx.db.selectObjects(`SELECT id, number, name, deleted_at FROM locations WHERE workspace_id=? AND deleted_at IS NOT NULL AND deleted_at >= ?
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = locations.job_id AND j.deleted_at IS NOT NULL) ORDER BY deleted_at DESC`, [workspaceId, cutoff])
    .map((r) => ({ id: String(r.id), number: num(r.number), name: str(r.name), deletedAt: String(r.deleted_at) }));
  // Boxes and pieces of a binned job are restored with their job, so they are listed under it, not on their own.
  // Items binned on their own (their box is still live).
  const items = ctx.db.selectObjects(
    `SELECT i.id, i.name, l.number, i.deleted_at FROM items i JOIN locations l ON l.id=i.location_id
      WHERE i.workspace_id=? AND i.deleted_at IS NOT NULL AND l.deleted_at IS NULL ORDER BY i.deleted_at DESC`, [workspaceId])
    .map((r) => ({ id: String(r.id), name: String(r.name), boxNumber: num(r.number), deletedAt: String(r.deleted_at) }));
  return { boxes, items, jobs: listBinJobs(ctx, workspaceId) };
}

export interface PurgeResult { boxes: number; items: number; photos: number; jobs: number; photoFiles: string[] }

/**
 * Removes rows binned more than 30 days ago. One savepoint per box so one failure never blocks the rest.
 * Order: photos -> items without movements -> the box's labels (retired, unlinked) -> the box if nothing points at it.
 * Returns the photo file names the caller must delete from OPFS.
 */
export function purgeBin(ctx: Ctx): PurgeResult {
  const cutoff = daysBefore(ctx.now(), 30);
  const res: PurgeResult = { boxes: 0, items: 0, photos: 0, jobs: 0, photoFiles: [] };

  // Review finding 8: file names and counts from a savepoint are merged only after it commits.
  const step = (label: string, fn: (acc: PurgeResult) => void) => {
    const acc: PurgeResult = { boxes: 0, items: 0, photos: 0, jobs: 0, photoFiles: [] };
    try {
      write(ctx, () => fn(acc));
    } catch (e) {
      console.warn(label, e);
      return;
    }
    res.boxes += acc.boxes; res.items += acc.items; res.photos += acc.photos; res.jobs += acc.jobs; res.photoFiles.push(...acc.photoFiles);
  };
  // Lock-protected photos (condition photos of a signed stage) are never purged, so one of them can't fail a whole step.
  const dropPhotos = (acc: PurgeResult, whereIn: string, bind: unknown[]) => {
    const where = `(${whereIn}) AND NOT ${LOCKED_PHOTO('photos.id')}`;
    const rows = ctx.db.selectObjects(`SELECT id, file_name, thumb_name, drive_file_id FROM photos WHERE ${where}`, bind);
    for (const r of rows) {
      acc.photoFiles.push(String(r.file_name), String(r.thumb_name));
      queueDriveDelete(ctx, String(r.id), str(r.drive_file_id));
    }
    if (rows.length) ctx.db.exec({ sql: `DELETE FROM photos WHERE ${where}`, bind });
    acc.photos += rows.length;
  };
  const dropItems = (acc: PurgeResult, where: string, bind: unknown[]) => {
    const w = `${where} AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.item_id = items.id)`;
    dropPhotos(acc, `item_id IN (SELECT id FROM items WHERE ${w})`, bind);
    ctx.db.exec({ sql: `DELETE FROM items WHERE ${w}`, bind });
    acc.items += ctx.db.changes();
  };

  // Photos and items binned on their own.
  step('purge items failed', (acc) => {
    dropPhotos(acc, `deleted_at IS NOT NULL AND deleted_at < ?`, [cutoff]);
    dropItems(acc, `deleted_at IS NOT NULL AND deleted_at < ?`, [cutoff]);
  });

  // Boxes of a job with a sign-off are lock-protected (they can't be binned anyway): never purged.
  const boxIds = ctx.db.selectValues(`SELECT id FROM locations WHERE deleted_at IS NOT NULL AND deleted_at < ?
      AND NOT EXISTS (SELECT 1 FROM stage_locks s WHERE s.job_id = locations.job_id)`, [cutoff]).map(String);
  for (const id of boxIds) {
    step(`purge box ${id} failed`, (acc) => {
      dropPhotos(acc, `location_id = ?`, [id]);
      dropItems(acc, `location_id = ?`, [id]);
      const pointed = ctx.db.selectValue(`SELECT EXISTS (SELECT 1 FROM items WHERE location_id=?) OR EXISTS (SELECT 1 FROM photos WHERE location_id=?)`, [id, id]);
      if (!num(pointed)) {
        ctx.db.exec({ sql: `UPDATE labels SET location_id=NULL, retired_at=coalesce(retired_at, ?) WHERE location_id=?`, bind: [ctx.now(), id] });
        ctx.db.exec({ sql: `DELETE FROM locations WHERE id=?`, bind: [id] });
        acc.boxes += 1;
      }
    });
  }

  // Removalist jobs binned over 30 days ago, with whatever the box loop left of their pieces. Deleting the job
  // cascades to its pieces, rooms, events and condition records; a signed job is never binned, and is skipped here too.
  const jobIds = ctx.db.selectValues(`SELECT id FROM jobs WHERE deleted_at IS NOT NULL AND deleted_at < ?
      AND NOT EXISTS (SELECT 1 FROM stage_locks s WHERE s.job_id = jobs.id)`, [cutoff]).map(String);
  for (const id of jobIds) {
    step(`purge job ${id} failed`, (acc) => {
      const pieces = `SELECT id FROM locations WHERE job_id = ?`;
      dropPhotos(acc, `location_id IN (${pieces})`, [id]);
      dropItems(acc, `location_id IN (${pieces})`, [id]);
      acc.boxes += num(ctx.db.selectValue(`SELECT count(*) FROM locations WHERE job_id = ?`, [id]));
      ctx.db.exec({ sql: `UPDATE labels SET location_id=NULL, retired_at=coalesce(retired_at, ?) WHERE location_id IN (${pieces})`, bind: [ctx.now(), id] });
      ctx.db.exec({ sql: `DELETE FROM jobs WHERE id=?`, bind: [id] });
      acc.jobs += 1;
    });
  }
  return res;
}
