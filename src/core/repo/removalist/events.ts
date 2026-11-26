// Load and unload check (plan §8, Phase 3). Every scan or tick is an append-only job_events row; the counters and
// the missing list are always worked out from those rows, so nothing can drift and a reload loses nothing.
import { type Ctx, newId, num, optionalText, str, write } from '../core';
import { jobNumber } from './jobs';
import { listJobPieces, type JobPiece } from './pieces';

export type Direction = 'load' | 'unload';
export type MissingReason = 'left_on_purpose' | 'customer_taking' | 'not_found' | 'other';
export const MISSING_REASONS: readonly MissingReason[] = ['left_on_purpose', 'customer_taking', 'not_found', 'other'];

export type ScanOutcome =
  /** Counted now. `notLoaded`: unloading a box that was never marked as loaded (counted anyway, flagged). */
  | { kind: 'counted'; boxId: string; isPiece: boolean; seq: number; done: number; total: number; notLoaded?: boolean }
  | { kind: 'already'; boxId: string; isPiece: boolean; seq: number; done: number; total: number }
  /** A box of another job of this business: loud warning, recorded as wrong_job_scan. */
  | { kind: 'otherJob'; isPiece: boolean; seq: number; jobNumber: string; labelName: string }
  /** A box on this phone that isn't in any job (a Home or Seller list, or a loose Removalist box). */
  | { kind: 'notInJob' }
  /** Not a label of this phone (another BoxTap user's label, or a spare label). */
  | { kind: 'unknown' };

const doneEvents = (d: Direction) => (d === 'load' ? `('loaded','manual_loaded')` : `('unloaded','manual_unloaded')`);

function jobWorkspace(ctx: Ctx, jobId: string): string {
  const ws = ctx.db.selectValue(`SELECT workspace_id FROM jobs WHERE id=? AND deleted_at IS NULL`, [jobId]);
  if (ws == null) throw new Error('job not found');
  return String(ws);
}

/** Boxes done in this direction: box id -> 'scan' | 'manual'. */
function doneMap(ctx: Ctx, jobId: string, d: Direction): Map<string, 'scan' | 'manual'> {
  const rows = ctx.db.selectObjects(`SELECT location_id, event FROM job_events WHERE job_id=? AND event IN ${doneEvents(d)} ORDER BY at`, [jobId]);
  const m = new Map<string, 'scan' | 'manual'>();
  for (const r of rows) if (!m.has(String(r.location_id))) m.set(String(r.location_id), String(r.event).startsWith('manual') ? 'manual' : 'scan');
  return m;
}

/**
 * What this check expects: loading expects every live box and piece of the job; unloading expects what was loaded
 * (scanned or ticked), compared against the load check.
 */
function expected(ctx: Ctx, jobId: string, d: Direction): JobPiece[] {
  const all = listJobPieces(ctx, jobId);
  if (d === 'load') return all;
  const loaded = doneMap(ctx, jobId, 'load');
  return all.filter((p) => loaded.has(p.id));
}

function counts(ctx: Ctx, jobId: string, d: Direction) {
  const exp = expected(ctx, jobId, d);
  const done = doneMap(ctx, jobId, d);
  return { done: exp.filter((p) => done.has(p.id)).length, total: exp.length };
}

function addEvent(ctx: Ctx, workspaceId: string, jobId: string, locationId: string | null, event: string, d: Direction, reason: string | null = null, note: string | null = null) {
  ctx.db.exec({
    sql: `INSERT INTO job_events (id,workspace_id,job_id,location_id,event,direction,reason,at,note) VALUES (?,?,?,?,?,?,?,?,?)`,
    bind: [newId(), workspaceId, jobId, locationId, event, d, reason, ctx.now(), note],
  });
}

/** One scanned label code during a load or unload check. Never throws for a bad code: the screen shows the outcome. */
export function recordScan(ctx: Ctx, jobId: string, d: Direction, code: string): ScanOutcome {
  const workspaceId = jobWorkspace(ctx, jobId);
  const [box] = ctx.db.selectObjects(
    `SELECT l.id, l.workspace_id, l.job_id, l.is_piece, l.job_seq FROM labels lb JOIN locations l ON l.id = lb.location_id
      WHERE lb.code=? AND lb.retired_at IS NULL AND l.deleted_at IS NULL`, [code]);
  if (!box) return { kind: 'unknown' };
  const isPiece = num(box.is_piece) === 1;
  const seq = num(box.job_seq ?? 0);
  if (box.job_id == null || String(box.workspace_id) !== workspaceId) return { kind: 'notInJob' };
  if (String(box.job_id) !== jobId) {
    const [other] = ctx.db.selectObjects(`SELECT number, customer_label_name FROM jobs WHERE id=?`, [String(box.job_id)]);
    write(ctx, () => addEvent(ctx, workspaceId, jobId, String(box.id), 'wrong_job_scan', d));
    return { kind: 'otherJob', isPiece, seq, jobNumber: jobNumber(num(other?.number ?? 0)), labelName: String(other?.customer_label_name ?? '') };
  }
  const boxId = String(box.id);
  if (doneMap(ctx, jobId, d).has(boxId)) return { kind: 'already', boxId, isPiece, seq, ...counts(ctx, jobId, d) };
  const notLoaded = d === 'unload' && !doneMap(ctx, jobId, 'load').has(boxId);
  write(ctx, () => addEvent(ctx, workspaceId, jobId, boxId, d === 'load' ? 'loaded' : 'unloaded', d));
  return { kind: 'counted', boxId, isPiece, seq, ...counts(ctx, jobId, d), ...(notLoaded ? { notLoaded } : {}) };
}

/** Manual tick for a damaged or unreadable label. A second tick changes nothing. */
export function manualTick(ctx: Ctx, jobId: string, d: Direction, boxId: string): void {
  const workspaceId = jobWorkspace(ctx, jobId);
  if (ctx.db.selectValue(`SELECT job_id FROM locations WHERE id=? AND deleted_at IS NULL`, [boxId]) !== jobId) throw new RangeError('box is not in this job');
  if (doneMap(ctx, jobId, d).has(boxId)) return;
  write(ctx, () => addEvent(ctx, workspaceId, jobId, boxId, d === 'load' ? 'manual_loaded' : 'manual_unloaded', d));
}

export interface CheckRow { piece: JobPiece; done: 'scan' | 'manual' | null; missing: { reason: MissingReason; note: string | null } | null }
export interface CheckState { direction: Direction; done: number; total: number; rows: CheckRow[]; finished: boolean }

/** The checklist for the screen: every expected box with how it was done, and the counter. */
export function checkState(ctx: Ctx, jobId: string, d: Direction): CheckState {
  const exp = expected(ctx, jobId, d);
  const done = doneMap(ctx, jobId, d);
  const acks = new Map(ctx.db.selectObjects(`SELECT location_id, reason, note FROM job_events WHERE job_id=? AND direction=? AND event='missing_ack' ORDER BY at`, [jobId, d])
    .map((r) => [String(r.location_id), { reason: r.reason as MissingReason, note: str(r.note) }]));
  const rows = exp.map((p) => ({ piece: p, done: done.get(p.id) ?? null, missing: done.has(p.id) ? null : acks.get(p.id) ?? null }));
  const status = String(ctx.db.selectValue(`SELECT status FROM jobs WHERE id=?`, [jobId]));
  const finished = d === 'load' ? ['loaded', 'delivered', 'closed'].includes(status) : ['delivered', 'closed'].includes(status);
  return { direction: d, done: rows.filter((r) => r.done).length, total: rows.length, rows, finished };
}

export class MissingReasonError extends Error {
  name = 'MissingReasonError';
  constructor(public readonly boxIds: string[]) { super('missing_reason_needed'); }
}

/**
 * Finishes a check. Every expected box not done needs a reason (Other needs a note too); each is recorded as
 * missing_ack. Then the job moves on: load -> Loaded, unload -> Delivered (never backwards, never past Closed).
 */
export function finishCheck(ctx: Ctx, jobId: string, d: Direction, reasons: Record<string, { reason: MissingReason; note?: string | null }>): void {
  const workspaceId = jobWorkspace(ctx, jobId);
  const state = checkState(ctx, jobId, d);
  const open = state.rows.filter((r) => !r.done && !r.missing);
  const lacking = open.filter((r) => {
    const x = reasons[r.piece.id];
    return !x || !MISSING_REASONS.includes(x.reason) || (x.reason === 'other' && !x.note?.trim());
  }).map((r) => r.piece.id);
  if (lacking.length) throw new MissingReasonError(lacking);
  write(ctx, () => {
    for (const r of open) {
      const x = reasons[r.piece.id]!;
      addEvent(ctx, workspaceId, jobId, r.piece.id, 'missing_ack', d, x.reason, optionalText(x.note, 'note', 200));
    }
    const next = d === 'load' ? 'loaded' : 'delivered';
    const from = d === 'load' ? `('booked','packing')` : `('booked','packing','loaded')`;
    ctx.db.exec({ sql: `UPDATE jobs SET status=?, updated_at=? WHERE id=? AND status IN ${from}`, bind: [next, ctx.now(), jobId] });
  });
}

/** Loaded / unloaded counts for the job screen. */
export function checkCounts(ctx: Ctx, jobId: string): { load: { done: number; total: number }; unload: { done: number; total: number } } {
  return { load: counts(ctx, jobId, 'load'), unload: counts(ctx, jobId, 'unload') };
}
