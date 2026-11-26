// Condition reports, sign-off and locks (plan §4.3, §8, Phase 4). One record per piece per stage (pickup, delivery),
// editable until the stage is signed; after that only amendment records can be added. The database triggers
// from schema v6 enforce the lock, so this file can't break it by mistake.
import { sha256 } from '@noble/hashes/sha2.js';
import { type Ctx, newId, num, optionalText, requireText, str, write } from '../core';
import { addPhoto, type PhotoInput } from '../photos';
import { canonicalJson } from '../../util/canonicalJson';
import { bytesToHex, utf8 } from '../../util/encoding';
import { jobNumber } from './jobs';
import { listJobPieces, type JobPiece } from './pieces';

export type Stage = 'pickup' | 'delivery';
export const STAGES: readonly Stage[] = ['pickup', 'delivery'];
export type ConditionTag = 'ok' | 'scratched' | 'dented' | 'chipped' | 'torn' | 'stained' | 'broken' | 'pre_existing' | 'other';
export const CONDITION_TAGS: readonly ConditionTag[] = ['ok', 'scratched', 'dented', 'chipped', 'torn', 'stained', 'broken', 'pre_existing', 'other'];
/** Tags that mean damage (everything but OK). "6 with existing damage" counts pieces with any of these. */
export const isDamage = (tag: ConditionTag): boolean => tag !== 'ok';

export interface ConditionPhoto { photoId: string; fileName: string; thumbName: string; capturedAt: string; source: 'camera' | 'library'; sha256: string; clockSuspect: boolean }
export interface ConditionRecord {
  id: string; jobId: string; locationId: string; stage: Stage; tags: ConditionTag[]; note: string | null;
  isAmendment: boolean; createdAt: string; createdBy: string | null; photos: ConditionPhoto[];
}

const hex = (b: Uint8Array | string) => bytesToHex(sha256(typeof b === 'string' ? utf8(b) : b));

function checkTags(tags: readonly string[]): ConditionTag[] {
  const out = [...new Set(tags)];
  for (const t of out) if (!CONDITION_TAGS.includes(t as ConditionTag)) throw new RangeError(`unknown condition tag ${t}`);
  return (out as ConditionTag[]).sort((a, b) => CONDITION_TAGS.indexOf(a) - CONDITION_TAGS.indexOf(b));
}

export const isLocked = (ctx: Ctx, jobId: string, stage: Stage): boolean =>
  num(ctx.db.selectValue(`SELECT EXISTS (SELECT 1 FROM stage_locks WHERE job_id=? AND stage=?)`, [jobId, stage])) === 1;

function pieceOfJob(ctx: Ctx, jobId: string, locationId: string): string {
  const [r] = ctx.db.selectObjects(`SELECT workspace_id, job_id FROM locations WHERE id=? AND deleted_at IS NULL`, [locationId]);
  if (!r || r.job_id !== jobId) throw new RangeError('piece is not in this job');
  return String(r.workspace_id);
}

function photosOf(ctx: Ctx, recordIds: string[]): Map<string, ConditionPhoto[]> {
  const m = new Map<string, ConditionPhoto[]>();
  if (!recordIds.length) return m;
  const rows = ctx.db.selectObjects(`SELECT cp.*, p.file_name, p.thumb_name FROM condition_photos cp JOIN photos p ON p.id = cp.photo_id
      WHERE cp.record_id IN (${recordIds.map(() => '?').join(',')}) ORDER BY cp.captured_at, cp.photo_id`, recordIds);
  for (const r of rows) {
    const list = m.get(String(r.record_id)) ?? [];
    list.push({ photoId: String(r.photo_id), fileName: String(r.file_name), thumbName: String(r.thumb_name), capturedAt: String(r.captured_at),
      source: r.source as ConditionPhoto['source'], sha256: String(r.sha256), clockSuspect: num(r.clock_suspect) === 1 });
    m.set(String(r.record_id), list);
  }
  return m;
}

function records(ctx: Ctx, where: string, bind: unknown[]): ConditionRecord[] {
  const rows = ctx.db.selectObjects(`SELECT * FROM condition_records WHERE ${where} ORDER BY created_at, id`, bind);
  const photos = photosOf(ctx, rows.map((r) => String(r.id)));
  return rows.map((r) => ({
    id: String(r.id), jobId: String(r.job_id), locationId: String(r.location_id), stage: r.stage as Stage,
    tags: JSON.parse(String(r.tags)) as ConditionTag[], note: str(r.note), isAmendment: num(r.is_amendment) === 1,
    createdAt: String(r.created_at), createdBy: str(r.created_by), photos: photos.get(String(r.id)) ?? [],
  }));
}

/** The piece's record for this stage (not amendments), or undefined if nothing was recorded yet. */
export function getConditionRecord(ctx: Ctx, jobId: string, locationId: string, stage: Stage): ConditionRecord | undefined {
  return records(ctx, `job_id=? AND location_id=? AND stage=? AND is_amendment=0`, [jobId, locationId, stage])[0];
}

export const pieceAmendments = (ctx: Ctx, jobId: string, locationId: string, stage: Stage): ConditionRecord[] =>
  records(ctx, `job_id=? AND location_id=? AND stage=? AND is_amendment=1`, [jobId, locationId, stage]);

function ensureRecord(ctx: Ctx, jobId: string, locationId: string, stage: Stage, createdBy: string | null): string {
  const existing = ctx.db.selectValue(`SELECT id FROM condition_records WHERE job_id=? AND location_id=? AND stage=? AND is_amendment=0`, [jobId, locationId, stage]);
  if (existing != null) return String(existing);
  const id = newId();
  ctx.db.exec({
    sql: `INSERT INTO condition_records (id,workspace_id,job_id,location_id,stage,tags,created_at,created_by) VALUES (?,?,?,?,?,'[]',?,?)`,
    bind: [id, pieceOfJob(ctx, jobId, locationId), jobId, locationId, stage, ctx.now(), createdBy],
  });
  return id;
}

/** Tags and note for a piece at a stage, before sign-off. Creates the record the first time. */
export function saveCondition(ctx: Ctx, c: { jobId: string; locationId: string; stage: Stage; tags: readonly string[]; note?: string | null; createdBy?: string | null }): ConditionRecord {
  pieceOfJob(ctx, c.jobId, c.locationId);
  if (isLocked(ctx, c.jobId, c.stage)) throw new Error('stage_locked');
  const tags = checkTags(c.tags);
  write(ctx, () => {
    const id = ensureRecord(ctx, c.jobId, c.locationId, c.stage, optionalText(c.createdBy, 'created by', 80));
    ctx.db.exec({ sql: `UPDATE condition_records SET tags=?, note=? WHERE id=?`, bind: [JSON.stringify(tags), optionalText(c.note, 'note', 1000), id] });
  });
  return getConditionRecord(ctx, c.jobId, c.locationId, c.stage)!;
}

/** After sign-off: a new record with is_amendment=1 and a note (required). Photos may be added to it. */
export function addAmendment(ctx: Ctx, a: { jobId: string; locationId: string; stage: Stage; note: string; tags?: readonly string[]; createdBy?: string | null }): ConditionRecord {
  const workspaceId = pieceOfJob(ctx, a.jobId, a.locationId);
  const note = requireText(a.note, 'note', 1000);
  const tags = checkTags(a.tags ?? []);
  const id = newId();
  write(ctx, () => ctx.db.exec({
    sql: `INSERT INTO condition_records (id,workspace_id,job_id,location_id,stage,tags,note,is_amendment,created_at,created_by) VALUES (?,?,?,?,?,?,?,1,?,?)`,
    bind: [id, workspaceId, a.jobId, a.locationId, a.stage, JSON.stringify(tags), note, ctx.now(), optionalText(a.createdBy, 'created by', 80)],
  }));
  return records(ctx, 'id=?', [id])[0]!;
}

/** Condition photos already on this piece at this stage (the free / Pro limit counts these). */
export const conditionPhotoCount = (ctx: Ctx, jobId: string, locationId: string, stage: Stage): number =>
  num(ctx.db.selectValue(`SELECT count(*) FROM condition_photos cp JOIN condition_records r ON r.id = cp.record_id
    WHERE r.job_id=? AND r.location_id=? AND r.stage=?`, [jobId, locationId, stage]));

/**
 * A condition photo: the photos row (on the piece, so it is backed up and synced like any photo) and its
 * condition_photos row with the SHA-256 of the stored bytes, the phone's time and the source. Before sign-off it
 * goes on the piece's record; after sign-off only onto an amendment (`amendmentId`). If the phone's time is earlier
 * than the latest time this phone has seen, the photo is flagged (clock_suspect).
 */
export function addConditionPhoto(ctx: Ctx, c: {
  jobId: string; locationId: string; stage: Stage; capturedAt: string; source: 'camera' | 'library';
  photo: Omit<PhotoInput, 'workspaceId' | 'locationId' | 'itemId'>; amendmentId?: string; createdBy?: string | null;
}) {
  const workspaceId = pieceOfJob(ctx, c.jobId, c.locationId);
  if (Number.isNaN(Date.parse(c.capturedAt))) throw new RangeError('captured_at is not a time');
  return write(ctx, () => {
    let recordId: string;
    if (c.amendmentId) {
      const ok = ctx.db.selectValue(`SELECT 1 FROM condition_records WHERE id=? AND job_id=? AND location_id=? AND stage=? AND is_amendment=1`, [c.amendmentId, c.jobId, c.locationId, c.stage]);
      if (!ok) throw new RangeError('not an amendment of this piece');
      recordId = c.amendmentId;
    } else {
      if (isLocked(ctx, c.jobId, c.stage)) throw new Error('stage_locked_amend_only');
      recordId = ensureRecord(ctx, c.jobId, c.locationId, c.stage, optionalText(c.createdBy, 'created by', 80));
    }
    const p = addPhoto(ctx, { ...c.photo, workspaceId, locationId: c.locationId, itemId: null });
    const maxSeen = str(ctx.db.selectValue(`SELECT max_seen_at FROM time_guard WHERE id=1`));
    const suspect = maxSeen != null && Date.parse(c.capturedAt) < Date.parse(maxSeen);
    ctx.db.exec({
      sql: `INSERT INTO condition_photos (photo_id,record_id,captured_at,source,sha256,clock_suspect) VALUES (?,?,?,?,?,?)`,
      bind: [p.id, recordId, c.capturedAt, c.source, c.photo.sha256, suspect ? 1 : 0],
    });
    noteTimeSeen(ctx, c.capturedAt);
    return { photoId: p.id, recordId, clockSuspect: suspect };
  });
}

/** Raises this phone's high-water mark of time seen (time_guard.max_seen_at); never lowers it. */
export function noteTimeSeen(ctx: Ctx, iso: string): void {
  ctx.db.exec({
    sql: `INSERT INTO time_guard (id,max_seen_at) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET max_seen_at = max(max_seen_at, excluded.max_seen_at)`,
    bind: [new Date(iso).toISOString()],
  });
}

// Stage summary and comparison ------------------------------------------------------------------

export interface PieceCondition { piece: JobPiece; record: ConditionRecord | null; amendments: ConditionRecord[] }
export interface StageSummary {
  stage: Stage; pieces: PieceCondition[]; total: number; recorded: number; withDamage: number;
  notRecorded: JobPiece[]; locked: { at: string; reportHash: string; customerRefused: boolean } | null;
  signoffs: { role: 'customer' | 'crew_leader'; name: string; signedAt: string }[];
}

export function stageSummary(ctx: Ctx, jobId: string, stage: Stage): StageSummary {
  const pieces = listJobPieces(ctx, jobId);
  const recs = records(ctx, `job_id=? AND stage=?`, [jobId, stage]);
  const rows = pieces.map((piece) => ({
    piece,
    record: recs.find((r) => r.locationId === piece.id && !r.isAmendment) ?? null,
    amendments: recs.filter((r) => r.locationId === piece.id && r.isAmendment),
  }));
  const recorded = rows.filter((r) => r.record && (r.record.tags.length > 0 || r.record.photos.length > 0 || r.record.note));
  const [lock] = ctx.db.selectObjects(`SELECT * FROM stage_locks WHERE job_id=? AND stage=?`, [jobId, stage]);
  return {
    stage, pieces: rows, total: rows.length, recorded: recorded.length,
    withDamage: rows.filter((r) => [...(r.record?.tags ?? []), ...r.amendments.flatMap((a) => a.tags)].some(isDamage)).length,
    notRecorded: rows.filter((r) => !recorded.includes(r)).map((r) => r.piece),
    locked: lock ? { at: String(lock.locked_at), reportHash: String(lock.report_hash), customerRefused: num(lock.customer_refused) === 1 } : null,
    signoffs: ctx.db.selectObjects(`SELECT signer_role, signer_name, signed_at FROM signoffs WHERE job_id=? AND stage=? ORDER BY signer_role`, [jobId, stage])
      .map((r) => ({ role: r.signer_role as 'customer' | 'crew_leader', name: String(r.signer_name), signedAt: String(r.signed_at) })),
  };
}

export interface Change { piece: JobPiece; pickup: ConditionTag[]; delivery: ConditionTag[] }
export interface Comparison { changed: Change[]; missing: { piece: JobPiece; why: 'not_recorded' | 'missing_on_unload' }[] }

const tagsAt = (row: PieceCondition) => checkTags([...(row.record?.tags ?? []), ...row.amendments.flatMap((a) => a.tags)]);

/**
 * Delivery against pickup: every piece whose tags differ ("Box 7: OK at pickup → Dented at delivery"), and every
 * piece missing at delivery: recorded at pickup but not at delivery, or left with a missing reason in the unload check.
 */
export function compareStages(ctx: Ctx, jobId: string): Comparison {
  const pick = stageSummary(ctx, jobId, 'pickup');
  const del = stageSummary(ctx, jobId, 'delivery');
  const unloadMissing = new Set(ctx.db.selectValues(`SELECT location_id FROM job_events WHERE job_id=? AND direction='unload' AND event='missing_ack'`, [jobId]).map(String));
  const changed: Change[] = [];
  const missing: Comparison['missing'] = [];
  for (const p of pick.pieces) {
    const d = del.pieces.find((x) => x.piece.id === p.piece.id)!;
    const atPickup = !pick.notRecorded.some((x) => x.id === p.piece.id);
    const atDelivery = !del.notRecorded.some((x) => x.id === p.piece.id);
    if (unloadMissing.has(p.piece.id)) { missing.push({ piece: p.piece, why: 'missing_on_unload' }); continue; }
    if (atPickup && !atDelivery) { missing.push({ piece: p.piece, why: 'not_recorded' }); continue; }
    const a = tagsAt(p), b = tagsAt(d);
    if (atPickup && atDelivery && a.join() !== b.join()) changed.push({ piece: p.piece, pickup: a, delivery: b });
  }
  return { changed, missing };
}

// Sign-off --------------------------------------------------------------------------------------

export interface Signer { name: string; signedAt: string; png: Uint8Array }

/**
 * SHA-256 of canonical JSON (keys sorted) of everything the stage's report says: job number, stage, every record
 * sorted by id (piece, tags, note, times, who, amendment flag, photo hashes), signer names and times, signature image
 * hashes, and customer_refused. Same data → same hash; any change → a different hash.
 */
export function reportHash(ctx: Ctx, jobId: string, stage: Stage, signers: { role: string; name: string; signedAt: string; signatureSha256: string | null }[], customerRefused: boolean): string {
  const number = num(ctx.db.selectValue(`SELECT number FROM jobs WHERE id=?`, [jobId]));
  const recs = records(ctx, `job_id=? AND stage=? AND is_amendment=0`, [jobId, stage]).sort((a, b) => (a.id < b.id ? -1 : 1));
  const body = {
    job: jobNumber(number), stage, customer_refused: customerRefused,
    records: recs.map((r) => ({
      id: r.id, piece: r.locationId, tags: r.tags, note: r.note, created_at: r.createdAt, created_by: r.createdBy, is_amendment: r.isAmendment,
      photos: [...r.photos].sort((a, b) => (a.photoId < b.photoId ? -1 : 1)).map((p) => ({ sha256: p.sha256, captured_at: p.capturedAt, source: p.source })),
    })),
    signers: [...signers].sort((a, b) => (a.role < b.role ? -1 : 1)).map((s) => ({ role: s.role, name: s.name, signed_at: s.signedAt, signature_sha256: s.signatureSha256 })),
  };
  return hex(canonicalJson(body));
}

export class AlreadySignedError extends Error { name = 'AlreadySignedError'; constructor() { super('stage_already_signed'); } }

/**
 * Signs and locks a stage in one transaction: the customer's signoffs row (none if they refused), the crew leader's,
 * and the stage_locks row with the report hash. Delivery sign-off closes the job (owner, 2026-11-26).
 */
export function signStage(ctx: Ctx, s: { jobId: string; stage: Stage; customer: Signer | null; crew: Signer }): { reportHash: string } {
  if (!STAGES.includes(s.stage)) throw new RangeError('unknown stage');
  if (isLocked(ctx, s.jobId, s.stage)) throw new AlreadySignedError();
  const refused = s.customer == null;
  const people = [
    ...(s.customer ? [{ role: 'customer', ...s.customer }] : []),
    { role: 'crew_leader', ...s.crew },
  ].map((p) => {
    if (p.png.length < 8 || p.png.length > 100_000) throw new RangeError('signature image must be 8 bytes - 100 KB');
    return { ...p, name: requireText(p.name, 'signer name', 80), sha: hex(p.png) };
  });
  const hash = reportHash(ctx, s.jobId, s.stage, people.map((p) => ({ role: p.role, name: p.name, signedAt: p.signedAt, signatureSha256: p.sha })), refused);
  write(ctx, () => {
    for (const p of people) {
      ctx.db.exec({
        sql: `INSERT INTO signoffs (id,job_id,stage,signer_role,signer_name,signature_png,signature_sha256,signed_at,report_hash) VALUES (?,?,?,?,?,?,?,?,?)`,
        bind: [newId(), s.jobId, s.stage, p.role, p.name, p.png, p.sha, p.signedAt, hash],
      });
    }
    ctx.db.exec({ sql: `INSERT INTO stage_locks (job_id,stage,locked_at,report_hash,customer_refused) VALUES (?,?,?,?,?)`, bind: [s.jobId, s.stage, ctx.now(), hash, refused ? 1 : 0] });
    if (s.stage === 'delivery') ctx.db.exec({ sql: `UPDATE jobs SET status='closed', updated_at=? WHERE id=?`, bind: [ctx.now(), s.jobId] });
    noteTimeSeen(ctx, ctx.now());
  });
  return { reportHash: hash };
}

/** Recomputes the hash from what is stored now; equal to the lock's hash unless the report was changed. */
export function verifyStage(ctx: Ctx, jobId: string, stage: Stage): { ok: boolean; stored: string; now: string } | null {
  const [lock] = ctx.db.selectObjects(`SELECT report_hash, customer_refused FROM stage_locks WHERE job_id=? AND stage=?`, [jobId, stage]);
  if (!lock) return null;
  const signers = ctx.db.selectObjects(`SELECT signer_role, signer_name, signed_at, signature_sha256 FROM signoffs WHERE job_id=? AND stage=?`, [jobId, stage])
    .map((r) => ({ role: String(r.signer_role), name: String(r.signer_name), signedAt: String(r.signed_at), signatureSha256: str(r.signature_sha256) }));
  const now = reportHash(ctx, jobId, stage, signers, num(lock.customer_refused) === 1);
  return { ok: now === String(lock.report_hash), stored: String(lock.report_hash), now };
}
