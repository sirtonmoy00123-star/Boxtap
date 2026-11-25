// The 30-day bin and its daily purge (DATABASE_SCHEMA §5 step 3).
import { type Ctx, daysBefore, num, str, write } from './core';

export interface BinBox { id: string; number: number; name: string | null; deletedAt: string }
export interface BinItem { id: string; name: string; boxNumber: number; deletedAt: string }

export function listBin(ctx: Ctx, workspaceId: string): { boxes: BinBox[]; items: BinItem[] } {
  // Boxes binned over 30 days ago that the purge had to keep (stock history) are archived: hidden, not restorable here.
  const cutoff = daysBefore(ctx.now(), 30);
  const boxes = ctx.db.selectObjects(`SELECT id, number, name, deleted_at FROM locations WHERE workspace_id=? AND deleted_at IS NOT NULL AND deleted_at >= ? ORDER BY deleted_at DESC`, [workspaceId, cutoff])
    .map((r) => ({ id: String(r.id), number: num(r.number), name: str(r.name), deletedAt: String(r.deleted_at) }));
  // Items binned on their own (their box is still live).
  const items = ctx.db.selectObjects(
    `SELECT i.id, i.name, l.number, i.deleted_at FROM items i JOIN locations l ON l.id=i.location_id
      WHERE i.workspace_id=? AND i.deleted_at IS NOT NULL AND l.deleted_at IS NULL ORDER BY i.deleted_at DESC`, [workspaceId])
    .map((r) => ({ id: String(r.id), name: String(r.name), boxNumber: num(r.number), deletedAt: String(r.deleted_at) }));
  return { boxes, items };
}

export interface PurgeResult { boxes: number; items: number; photos: number; photoFiles: string[] }

/**
 * Removes rows binned more than 30 days ago. One savepoint per box so one failure never blocks the rest.
 * Order: photos -> items without movements -> the box's labels (retired, unlinked) -> the box if nothing points at it.
 * Returns the photo file names the caller must delete from OPFS.
 */
export function purgeBin(ctx: Ctx): PurgeResult {
  const cutoff = daysBefore(ctx.now(), 30);
  const res: PurgeResult = { boxes: 0, items: 0, photos: 0, photoFiles: [] };

  const dropPhotos = (where: string, bind: unknown[]) => {
    const rows = ctx.db.selectObjects(`SELECT id, file_name, thumb_name FROM photos WHERE ${where}`, bind);
    for (const r of rows) res.photoFiles.push(String(r.file_name), String(r.thumb_name));
    if (rows.length) ctx.db.exec({ sql: `DELETE FROM photos WHERE ${where}`, bind });
    res.photos += rows.length;
  };
  const dropItems = (where: string, bind: unknown[]) => {
    const w = `${where} AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.item_id = items.id)`;
    dropPhotos(`item_id IN (SELECT id FROM items WHERE ${w})`, bind);
    ctx.db.exec({ sql: `DELETE FROM items WHERE ${w}`, bind });
    res.items += ctx.db.changes();
  };

  // Items binned on their own.
  try {
    write(ctx, () => {
      dropPhotos(`deleted_at IS NOT NULL AND deleted_at < ? AND item_id IS NOT NULL`, [cutoff]);
      dropItems(`deleted_at IS NOT NULL AND deleted_at < ?`, [cutoff]);
    });
  } catch (e) {
    console.warn('purge items failed', e);
  }

  const boxIds = ctx.db.selectValues(`SELECT id FROM locations WHERE deleted_at IS NOT NULL AND deleted_at < ?`, [cutoff]).map(String);
  for (const id of boxIds) {
    try {
      write(ctx, () => {
        dropPhotos(`location_id = ?`, [id]);
        dropItems(`location_id = ?`, [id]);
        const pointed = ctx.db.selectValue(`SELECT EXISTS (SELECT 1 FROM items WHERE location_id=?) OR EXISTS (SELECT 1 FROM photos WHERE location_id=?)`, [id, id]);
        if (!num(pointed)) {
          ctx.db.exec({ sql: `UPDATE labels SET location_id=NULL, retired_at=coalesce(retired_at, ?) WHERE location_id=?`, bind: [ctx.now(), id] });
          ctx.db.exec({ sql: `DELETE FROM locations WHERE id=?`, bind: [id] });
          res.boxes += 1;
        }
      });
    } catch (e) {
      console.warn('purge box failed', id, e);
    }
  }
  return res;
}
