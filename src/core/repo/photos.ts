// Photos (C-10, G1) and the Drive photo queue (API_CONTRACTS §6.1, audit B10). Image bytes live in OPFS files;
// these rows hold names, size, type and the plain-photo hash.
import { type Ctx, newId, num, str, write } from './core';

export interface Photo {
  id: string; workspaceId: string; locationId: string | null; itemId: string | null;
  fileName: string; thumbName: string; mime: 'image/webp' | 'image/jpeg'; bytes: number; sha256: string | null;
  driveRef: string | null; driveFileId: string | null; createdAt: string; deletedAt: string | null;
}
export interface PhotoInput {
  workspaceId: string; locationId: string | null; itemId: string | null;
  mime: 'image/webp' | 'image/jpeg'; bytes: number; sha256: string;
  /** Optional: keep the id when the caller already wrote the files under it. */
  id?: string;
}

const toPhoto = (r: Record<string, unknown>): Photo => ({
  id: String(r.id), workspaceId: String(r.workspace_id), locationId: str(r.location_id), itemId: str(r.item_id),
  fileName: String(r.file_name), thumbName: String(r.thumb_name), mime: r.mime as Photo['mime'], bytes: num(r.bytes),
  sha256: str(r.sha256), driveRef: str(r.drive_ref), driveFileId: str(r.drive_file_id), createdAt: String(r.created_at),
  deletedAt: str(r.deleted_at),
});

export const photoFiles = (id: string, mime: Photo['mime']) => {
  const ext = mime === 'image/webp' ? 'webp' : 'jpg';
  return { fileName: `photos/${id}.${ext}`, thumbName: `photos/${id}.thumb.${ext}` };
};

export function addPhoto(ctx: Ctx, p: PhotoInput): Photo {
  if ((p.locationId == null) === (p.itemId == null)) throw new RangeError('a photo belongs to exactly one box or item');
  if (!/^[0-9a-f]{64}$/.test(p.sha256)) throw new RangeError('sha256 must be 64 hex characters');
  const id = p.id ?? newId();
  const t = ctx.now();
  const f = photoFiles(id, p.mime);
  write(ctx, () => {
    ctx.db.exec({
      sql: `INSERT INTO photos (id,workspace_id,location_id,item_id,file_name,thumb_name,mime,bytes,sha256,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      bind: [id, p.workspaceId, p.locationId, p.itemId, f.fileName, f.thumbName, p.mime, p.bytes, p.sha256, t, t],
    });
    ctx.db.exec({ sql: `INSERT OR REPLACE INTO drive_outbox (photo_id,op,attempts,next_try_at) VALUES (?, 'upload', 0, ?)`, bind: [id, t] });
  });
  return getPhoto(ctx, id)!;
}

export function getPhoto(ctx: Ctx, id: string): Photo | undefined {
  const [r] = ctx.db.selectObjects(`SELECT * FROM photos WHERE id=?`, [id]);
  return r ? toPhoto(r) : undefined;
}

export function listPhotos(ctx: Ctx, parent: { locationId?: string; itemId?: string }): Photo[] {
  const [col, val] = parent.locationId ? ['location_id', parent.locationId] : ['item_id', parent.itemId];
  // Condition photos (Removalist) belong to the condition report, not to the box's own photo strip.
  return ctx.db.selectObjects(`SELECT * FROM photos WHERE ${col}=? AND deleted_at IS NULL AND id NOT IN (SELECT photo_id FROM condition_photos) ORDER BY created_at`, [val]).map(toPhoto);
}

export interface ItemThumb { photoId: string; thumbName: string; fileName: string }

/** First live photo of each live item in a box, keyed by item id (thumbnails in the contents list). */
export function itemThumbs(ctx: Ctx, boxId: string): Record<string, ItemThumb> {
  const rows = ctx.db.selectObjects(
    `SELECT p.item_id, p.id, p.thumb_name, p.file_name FROM photos p JOIN items i ON i.id = p.item_id
      WHERE i.location_id = ? AND i.deleted_at IS NULL AND p.deleted_at IS NULL
      ORDER BY p.item_id, p.created_at, p.id`, [boxId]);
  const out: Record<string, ItemThumb> = {};
  for (const r of rows) {
    const k = String(r.item_id);
    out[k] ??= { photoId: String(r.id), thumbName: String(r.thumb_name), fileName: String(r.file_name) };
  }
  return out;
}

/** Every live photo (for backups and the restore download queue). */
export function allLivePhotos(ctx: Ctx): Photo[] {
  return ctx.db.selectObjects(`SELECT * FROM photos WHERE deleted_at IS NULL ORDER BY created_at`).map(toPhoto);
}

export function deletePhoto(ctx: Ctx, id: string): void {
  const t = ctx.now();
  write(ctx, () => ctx.db.exec({ sql: `UPDATE photos SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`, bind: [t, t, id] }));
}

export function setPhotoDriveRef(ctx: Ctx, id: string, ref: string, fileId: string): void {
  ctx.db.exec({ sql: `UPDATE photos SET drive_ref=?, drive_file_id=? WHERE id=?`, bind: [ref, fileId, id] });
}

/** The Drive file id doubles as the random photo_ref. Null: no Drive copy ("This photo wasn't backed up"). */
export function setPhotoDriveFile(ctx: Ctx, id: string, fileId: string | null): void {
  // A change (review finding 1): the next Drive snapshot must carry which photos are in Drive, or a restore
  // would show them as "not backed up".
  write(ctx, () => ctx.db.exec({ sql: `UPDATE photos SET drive_ref=?, drive_file_id=? WHERE id=?`, bind: [fileId, fileId, id] }));
}

/** Queue uploads for live photos that have no Drive copy and no queued work (after connect or a file restore). */
export function queueMissingUploads(ctx: Ctx): number {
  ctx.db.exec({
    sql: `INSERT INTO drive_outbox (photo_id,op,attempts,next_try_at)
          SELECT p.id, 'upload', 0, ? FROM photos p
           WHERE p.deleted_at IS NULL AND p.drive_file_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM drive_outbox o WHERE o.photo_id = p.id)`,
    bind: [ctx.now()],
  });
  return ctx.db.changes();
}

// Drive outbox ------------------------------------------------------------------------------------------

export interface OutboxRow { photoId: string; op: 'upload' | 'delete' | 'download'; driveFileId: string | null; attempts: number }

// Uploads of binned photos wait (they may be restored) without blocking the queue (review finding 10).
const NOT_BINNED_UPLOAD = `NOT (o.op = 'upload' AND EXISTS (SELECT 1 FROM photos p WHERE p.id = o.photo_id AND p.deleted_at IS NOT NULL))`;

export function outboxDue(ctx: Ctx, nowIso: string, limit = 50): OutboxRow[] {
  return ctx.db.selectObjects(`SELECT o.* FROM drive_outbox o WHERE o.next_try_at <= ? AND ${NOT_BINNED_UPLOAD} ORDER BY o.next_try_at LIMIT ?`, [nowIso, limit])
    .map((r) => ({ photoId: String(r.photo_id), op: r.op as OutboxRow['op'], driveFileId: str(r.drive_file_id), attempts: num(r.attempts) }));
}

export const outboxCount = (ctx: Ctx, op?: OutboxRow['op']): number =>
  num(ctx.db.selectValue(`SELECT count(*) FROM drive_outbox o WHERE (? IS NULL OR o.op = ?) AND ${NOT_BINNED_UPLOAD}`, [op ?? null, op ?? null]));

/** Store the id reserved with files.generateIds before the first attempt, so a retry reuses it. */
export function outboxReserve(ctx: Ctx, photoId: string, driveFileId: string): void {
  ctx.db.exec({ sql: `UPDATE drive_outbox SET drive_file_id=? WHERE photo_id=?`, bind: [driveFileId, photoId] });
}

export function outboxDone(ctx: Ctx, photoId: string): void {
  ctx.db.exec({ sql: `DELETE FROM drive_outbox WHERE photo_id=?`, bind: [photoId] });
}

/** Backoff 30 s, doubling, capped at 1 h. */
export function outboxFailed(ctx: Ctx, photoId: string, error: string): void {
  const [r] = ctx.db.selectObjects(`SELECT attempts FROM drive_outbox WHERE photo_id=?`, [photoId]);
  if (!r) return;
  const attempts = num(r.attempts) + 1;
  const delay = Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);
  const next = new Date(Date.parse(ctx.now()) + delay).toISOString();
  ctx.db.exec({ sql: `UPDATE drive_outbox SET attempts=?, next_try_at=?, last_error=? WHERE photo_id=?`, bind: [attempts, next, error.slice(0, 200), photoId] });
}

/**
 * When a binned photo is purged: remove its Drive copy if it has one (files.delete, not trash).
 * Ruling (build): queued at purge time rather than after every older snapshot expires (§6.1). A snapshot
 * restored from before the purge then shows "This photo wasn't backed up" for that photo.
 */
export function queueDriveDelete(ctx: Ctx, photoId: string, driveFileId: string | null): void {
  if (!driveFileId) {
    outboxDone(ctx, photoId); // never uploaded: just drop any pending upload
    return;
  }
  ctx.db.exec({ sql: `INSERT OR REPLACE INTO drive_outbox (photo_id,op,drive_file_id,attempts,next_try_at) VALUES (?, 'delete', ?, 0, ?)`, bind: [photoId, driveFileId, ctx.now()] });
}

/** After a restore: queue downloads for live photos that have a Drive copy. */
export function queuePhotoDownloads(ctx: Ctx): number {
  ctx.db.exec({
    sql: `INSERT OR REPLACE INTO drive_outbox (photo_id,op,drive_file_id,attempts,next_try_at)
          SELECT p.id, 'download', p.drive_file_id, 0, ? FROM photos p
           WHERE p.deleted_at IS NULL AND p.drive_file_id IS NOT NULL`,
    bind: [ctx.now()],
  });
  return ctx.db.changes();
}
