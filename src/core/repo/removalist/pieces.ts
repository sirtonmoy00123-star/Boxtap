// Boxes and furniture pieces inside a job (plan §3 C1/C2, Phase 2). Each is a normal `locations` row (so the box
// screen, items, photos, labels and the Bin all work as in Home mode) with job_id, is_piece and job_seq set.
// job_seq restarts per job and per kind ("Box 1, Box 2…", "Piece 1, Piece 2…"); the workspace-wide number stays internal.
import { type Ctx, newId, num, requireText, str, write } from '../core';
import { createBox, type Box, type BoxInput, type Room } from '../places';
import { jobNumber } from './jobs';

export interface JobBoxInput extends BoxInput { isPiece?: boolean; volumeItemId?: string | null }
export interface JobPiece extends Box { volumeItemId: string | null; roomName: string | null }

const jobOf = (ctx: Ctx, jobId: string) => {
  const [r] = ctx.db.selectObjects(`SELECT workspace_id, deleted_at FROM jobs WHERE id=?`, [jobId]);
  if (!r || r.deleted_at != null) throw new Error('job not found');
  return String(r.workspace_id);
};

/** Next number for this kind in this job. Counts binned rows too: the unique index covers them. */
const nextSeq = (ctx: Ctx, jobId: string, isPiece: boolean) =>
  num(ctx.db.selectValue(`SELECT coalesce(max(job_seq), 0) + 1 FROM locations WHERE job_id=? AND is_piece=?`, [jobId, isPiece ? 1 : 0]));

/** A volume item of the same workspace and the right kind (box size for boxes, furniture type for pieces), or an error. */
function checkVolumeItem(ctx: Ctx, workspaceId: string, id: string | null | undefined, isPiece: boolean): string | null {
  if (id == null) return null;
  const kind = ctx.db.selectValue(`SELECT kind FROM volume_catalogue WHERE id=? AND workspace_id=? AND deleted_at IS NULL`, [id, workspaceId]);
  if (kind !== (isPiece ? 'furniture' : 'box')) throw new RangeError(isPiece ? 'not a furniture type' : 'not a box size');
  return id;
}

function addOne(ctx: Ctx, jobId: string, workspaceId: string, b: JobBoxInput): string {
  const isPiece = !!b.isPiece;
  // Boxes get a box size: the one given, else the business's default (Standard carton). Pieces only if chosen.
  const size = 'volumeItemId' in b ? b.volumeItemId : isPiece ? null
    : str(ctx.db.selectValue(`SELECT default_box_item_id FROM business_profile WHERE workspace_id=?`, [workspaceId]));
  const volumeItemId = checkVolumeItem(ctx, workspaceId, size, isPiece);
  if (b.roomId) checkRoom(ctx, jobId, b.roomId);
  const box = createBox(ctx, workspaceId, b);
  ctx.db.exec({
    sql: `UPDATE locations SET job_id=?, is_piece=?, job_seq=?, volume_item_id=? WHERE id=?`,
    bind: [jobId, isPiece ? 1 : 0, nextSeq(ctx, jobId, isPiece), volumeItemId, box.id],
  });
  return box.id;
}

/** Booked -> Packing when the first box or piece is added (plan §6). */
const startPacking = (ctx: Ctx, jobId: string) =>
  ctx.db.exec({ sql: `UPDATE jobs SET status='packing', updated_at=? WHERE id=? AND status='booked'`, bind: [ctx.now(), jobId] });

export function addJobBox(ctx: Ctx, jobId: string, b: JobBoxInput = {}): JobPiece {
  const workspaceId = jobOf(ctx, jobId);
  const id = write(ctx, () => { const id = addOne(ctx, jobId, workspaceId, b); startPacking(ctx, jobId); return id; });
  return getJobPiece(ctx, id)!;
}

/** Quick add: n numbered empty boxes (default box size) in one transaction, all or none. */
export function quickAddBoxes(ctx: Ctx, jobId: string, n = 10): JobPiece[] {
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new RangeError('n must be 1-100');
  const workspaceId = jobOf(ctx, jobId);
  const ids = write(ctx, () => {
    const out = Array.from({ length: n }, () => addOne(ctx, jobId, workspaceId, {}));
    startPacking(ctx, jobId);
    return out;
  });
  return ids.map((id) => getJobPiece(ctx, id)!);
}

const PIECE_SELECT = `SELECT l.*, r.name AS room_name,
    (SELECT code FROM labels WHERE location_id=l.id AND retired_at IS NULL ORDER BY created_at LIMIT 1) AS label_code
  FROM locations l LEFT JOIN rooms r ON r.id = l.room_id AND r.deleted_at IS NULL`;

function toPiece(r: Record<string, unknown>): JobPiece {
  return {
    id: String(r.id), workspaceId: String(r.workspace_id), number: num(r.number), name: str(r.name), kind: r.kind as Box['kind'],
    roomId: str(r.room_id), spot: str(r.spot), colour: str(r.colour), isFragile: num(r.is_fragile) === 1, openFirst: num(r.open_first) === 1,
    moveStatus: (r.move_status as Box['moveStatus']) ?? null, notes: str(r.notes), labelCode: String(r.label_code ?? ''),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at), deletedAt: str(r.deleted_at),
    jobId: str(r.job_id), isPiece: num(r.is_piece) === 1, jobSeq: r.job_seq == null ? null : num(r.job_seq),
    volumeItemId: str(r.volume_item_id), roomName: str(r.room_name),
  };
}

export function getJobPiece(ctx: Ctx, id: string): JobPiece | undefined {
  const [r] = ctx.db.selectObjects(`${PIECE_SELECT} WHERE l.id=?`, [id]);
  return r ? toPiece(r) : undefined;
}

/** Live boxes first, then furniture pieces, each by their number in the job. */
export function listJobPieces(ctx: Ctx, jobId: string): JobPiece[] {
  return ctx.db.selectObjects(`${PIECE_SELECT} WHERE l.job_id=? AND l.deleted_at IS NULL ORDER BY l.is_piece, l.job_seq`, [jobId]).map(toPiece);
}

export function pieceCounts(ctx: Ctx, jobId: string): { boxes: number; pieces: number } {
  const [r] = ctx.db.selectObjects(`SELECT sum(is_piece=0) AS boxes, sum(is_piece=1) AS pieces FROM locations WHERE job_id=? AND deleted_at IS NULL`, [jobId]);
  return { boxes: num(r?.boxes ?? 0), pieces: num(r?.pieces ?? 0) };
}

/** Box size (boxes) or furniture type (pieces); null clears it. */
export function setPieceVolumeItem(ctx: Ctx, boxId: string, volumeItemId: string | null): void {
  const [r] = ctx.db.selectObjects(`SELECT workspace_id, is_piece, job_id FROM locations WHERE id=?`, [boxId]);
  if (!r || r.job_id == null) throw new Error('not a job box');
  const id = checkVolumeItem(ctx, String(r.workspace_id), volumeItemId, num(r.is_piece) === 1);
  write(ctx, () => ctx.db.exec({ sql: `UPDATE locations SET volume_item_id=?, updated_at=? WHERE id=?`, bind: [id, ctx.now(), boxId] }));
}

// Rooms of a job (destination rooms; rooms.job_id) ------------------------------------------------

function checkRoom(ctx: Ctx, jobId: string, roomId: string) {
  if (ctx.db.selectValue(`SELECT job_id FROM rooms WHERE id=? AND deleted_at IS NULL`, [roomId]) !== jobId) throw new RangeError('room is not in this job');
}

export function listJobRooms(ctx: Ctx, jobId: string): Room[] {
  return ctx.db.selectObjects(`SELECT * FROM rooms WHERE job_id=? AND deleted_at IS NULL ORDER BY sort_order, name`, [jobId])
    .map((r) => ({ id: String(r.id), workspaceId: String(r.workspace_id), name: String(r.name), colour: String(r.colour), sortOrder: num(r.sort_order) }));
}

export function createJobRoom(ctx: Ctx, jobId: string, name: string): Room {
  const workspaceId = jobOf(ctx, jobId);
  const id = newId();
  const t = ctx.now();
  write(ctx, () => ctx.db.exec({
    sql: `INSERT INTO rooms (id,workspace_id,job_id,name,sort_order,created_at,updated_at)
          VALUES (?,?,?,?,(SELECT coalesce(max(sort_order),0)+1 FROM rooms WHERE job_id=?),?,?)`,
    bind: [id, workspaceId, jobId, requireText(name, 'name', 60), jobId, t, t],
  }));
  return listJobRooms(ctx, jobId).find((r) => r.id === id)!;
}

/** Moves a job box into one of its job's rooms (or none). */
export function setPieceRoom(ctx: Ctx, boxId: string, roomId: string | null): void {
  const jobId = str(ctx.db.selectValue(`SELECT job_id FROM locations WHERE id=?`, [boxId]));
  if (!jobId) throw new Error('not a job box');
  if (roomId) checkRoom(ctx, jobId, roomId);
  write(ctx, () => ctx.db.exec({ sql: `UPDATE locations SET room_id=?, updated_at=? WHERE id=?`, bind: [roomId, ctx.now(), boxId] }));
}

// Labels ------------------------------------------------------------------------------------------

export interface JobLabel {
  code: string; isPiece: boolean; seq: number; /** live boxes (or pieces) of this kind in the job, at print time */ of: number;
  name: string | null; room: string | null; fragile: boolean; openFirst: boolean;
}
export interface JobLabelSet { businessName: string; jobNumber: string; labelName: string; labels: JobLabel[]; sheet: string }

const printedKey = (jobId: string) => `job_labels_printed:${jobId}`;

/**
 * Label data for a job: every live box and piece, or only `ids`. "Box 12 of 45" uses the totals at print time.
 * Ruling (Phase 2): the totals at the last print are kept in meta (no schema change), so the job screen can warn
 * that older labels show an older total.
 */
export function jobLabels(ctx: Ctx, jobId: string, ids?: readonly string[]): JobLabelSet {
  const [j] = ctx.db.selectObjects(`SELECT j.number, j.customer_label_name, b.name AS business, b.label_sheet
      FROM jobs j JOIN business_profile b ON b.workspace_id = j.workspace_id WHERE j.id=?`, [jobId]);
  if (!j) throw new Error('job not found');
  const all = listJobPieces(ctx, jobId);
  const totals = { box: all.filter((p) => !p.isPiece).length, piece: all.filter((p) => p.isPiece).length };
  const pick = ids ? all.filter((p) => ids.includes(p.id)) : all;
  return {
    businessName: String(j.business), jobNumber: jobNumber(num(j.number)), labelName: String(j.customer_label_name), sheet: String(j.label_sheet),
    labels: pick.map((p) => ({
      code: p.labelCode, isPiece: p.isPiece, seq: p.jobSeq ?? 0, of: p.isPiece ? totals.piece : totals.box,
      name: p.name, room: p.roomName, fragile: p.isFragile, openFirst: p.openFirst,
    })),
  };
}

/** Call after the label PDF was made: remembers the totals printed on it. */
export function markJobLabelsPrinted(ctx: Ctx, jobId: string): void {
  const c = pieceCounts(ctx, jobId);
  ctx.db.exec({ sql: `INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, bind: [printedKey(jobId), JSON.stringify(c)] });
}

/** Totals on the last printed labels, or null if never printed. Stale = the job has more or fewer now. */
export function jobLabelsStatus(ctx: Ctx, jobId: string): { printed: { boxes: number; pieces: number } | null; stale: boolean } {
  const raw = ctx.db.selectValue(`SELECT value FROM meta WHERE key=?`, [printedKey(jobId)]);
  if (raw == null) return { printed: null, stale: false };
  let printed: { boxes: number; pieces: number };
  try { printed = JSON.parse(String(raw)) as { boxes: number; pieces: number }; } catch { return { printed: null, stale: false }; }
  const now = pieceCounts(ctx, jobId);
  return { printed, stale: (printed.boxes > 0 && printed.boxes !== now.boxes) || (printed.pieces > 0 && printed.pieces !== now.pieces) };
}
