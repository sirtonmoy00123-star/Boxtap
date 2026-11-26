// Removalist jobs: create, edit, list with filters and search, status, Bin and archive (plan §4.2, §6).
import { clean, type Ctx, daysBefore, newId, num, optionalText, requireText, str, write } from '../core';

export type JobStatus = 'booked' | 'packing' | 'loaded' | 'delivered' | 'closed';
export const JOB_STATUSES: readonly JobStatus[] = ['booked', 'packing', 'loaded', 'delivered', 'closed'];
export type JobFilter = 'upcoming' | 'today' | 'in_progress' | 'closed';

export interface Job {
  id: string; workspaceId: string; number: number; customerName: string; customerLabelName: string;
  customerPhone: string | null; customerEmail: string | null; pickupAddress: string | null; deliveryAddress: string | null;
  /** Local date and time of the move as typed ("2026-12-03T08:30"), no time zone: the business works in its own. */
  moveAt: string | null; crewLeader: string | null; notes: string | null; truckId: string | null; status: JobStatus;
  createdAt: string; updatedAt: string; archivedAt: string | null; deletedAt: string | null;
}
export interface JobRow extends Job { pieces: number; loaded: number; signed: boolean }

export interface JobInput {
  customerName?: string; customerLabelName?: string | null; customerPhone?: string | null; customerEmail?: string | null;
  pickupAddress?: string | null; deliveryAddress?: string | null; moveAt?: string | null; crewLeader?: string | null;
  notes?: string | null; truckId?: string | null;
}

/** "J-0042". */
export const jobNumber = (n: number): string => `J-${String(n).padStart(4, '0')}`;

/** The name printed on labels: the customer's last name (owner, 2026-11-26), editable. */
export function defaultLabelName(customerName: string): string {
  const words = (clean(customerName) ?? '').split(/\s+/).filter(Boolean);
  return (words[words.length - 1] ?? '').slice(0, 40);
}

const MOVE_AT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
function moveAt(v: string | null | undefined): string | null {
  const s = clean(v);
  if (s == null) return null;
  if (!MOVE_AT.test(s) || Number.isNaN(new Date(s.length === 10 ? `${s}T00:00` : s).getTime())) throw new RangeError('move date is not valid');
  return s;
}

const toJob = (r: Record<string, unknown>): Job => ({
  id: String(r.id), workspaceId: String(r.workspace_id), number: num(r.number), customerName: String(r.customer_name),
  customerLabelName: String(r.customer_label_name), customerPhone: str(r.customer_phone), customerEmail: str(r.customer_email),
  pickupAddress: str(r.pickup_address), deliveryAddress: str(r.delivery_address), moveAt: str(r.move_at),
  crewLeader: str(r.crew_leader), notes: str(r.notes), truckId: str(r.truck_id), status: r.status as JobStatus,
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), archivedAt: str(r.archived_at), deletedAt: str(r.deleted_at),
});

export function createJob(ctx: Ctx, workspaceId: string, j: JobInput): Job {
  const name = requireText(j.customerName, 'customer name', 80);
  const label = requireText(clean(j.customerLabelName) ?? defaultLabelName(name), 'label name', 40);
  const id = newId();
  const t = ctx.now();
  write(ctx, () => {
    const n = num(ctx.db.selectValue(`SELECT next_job_number FROM business_profile WHERE workspace_id=?`, [workspaceId]));
    if (!n) throw new Error('business profile not found');
    ctx.db.exec({ sql: `UPDATE business_profile SET next_job_number=next_job_number+1, updated_at=? WHERE workspace_id=?`, bind: [t, workspaceId] });
    ctx.db.exec({
      sql: `INSERT INTO jobs (id,workspace_id,number,customer_name,customer_label_name,customer_phone,customer_email,pickup_address,
              delivery_address,move_at,crew_leader,notes,truck_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      bind: [id, workspaceId, n, name, label, optionalText(j.customerPhone, 'phone', 30), optionalText(j.customerEmail, 'email', 120),
        optionalText(j.pickupAddress, 'pickup address', 200), optionalText(j.deliveryAddress, 'delivery address', 200),
        moveAt(j.moveAt), optionalText(j.crewLeader, 'crew leader', 80), optionalText(j.notes, 'notes', 2000), j.truckId ?? null, t, t],
    });
  });
  return getJob(ctx, id)!;
}

export function getJob(ctx: Ctx, id: string): Job | undefined {
  const [r] = ctx.db.selectObjects(`SELECT * FROM jobs WHERE id=?`, [id]);
  return r ? toJob(r) : undefined;
}

export function updateJob(ctx: Ctx, id: string, j: JobInput): void {
  const cols: string[] = [];
  const bind: unknown[] = [];
  const set = (c: string, v: unknown) => { cols.push(`${c}=?`); bind.push(v); };
  if ('customerName' in j) set('customer_name', requireText(j.customerName, 'customer name', 80));
  if ('customerLabelName' in j) set('customer_label_name', requireText(j.customerLabelName, 'label name', 40));
  if ('customerPhone' in j) set('customer_phone', optionalText(j.customerPhone, 'phone', 30));
  if ('customerEmail' in j) set('customer_email', optionalText(j.customerEmail, 'email', 120));
  if ('pickupAddress' in j) set('pickup_address', optionalText(j.pickupAddress, 'pickup address', 200));
  if ('deliveryAddress' in j) set('delivery_address', optionalText(j.deliveryAddress, 'delivery address', 200));
  if ('moveAt' in j) set('move_at', moveAt(j.moveAt));
  if ('crewLeader' in j) set('crew_leader', optionalText(j.crewLeader, 'crew leader', 80));
  if ('notes' in j) set('notes', optionalText(j.notes, 'notes', 2000));
  if ('truckId' in j) set('truck_id', j.truckId ?? null);
  if (!cols.length) return;
  set('updated_at', ctx.now());
  write(ctx, () => ctx.db.exec({ sql: `UPDATE jobs SET ${cols.join(', ')} WHERE id=?`, bind: [...bind, id] }));
}

/** Manual status change (the screen asks first). Closed is set by the delivery sign-off in Phase 4. */
export function setJobStatus(ctx: Ctx, id: string, status: JobStatus): void {
  if (!JOB_STATUSES.includes(status)) throw new RangeError('unknown status');
  write(ctx, () => ctx.db.exec({ sql: `UPDATE jobs SET status=?, updated_at=? WHERE id=?`, bind: [status, ctx.now(), id] }));
}

/** Active = counts toward the free limit: not Closed, not archived, not in the Bin. */
export function activeJobCount(ctx: Ctx, workspaceId: string): number {
  return num(ctx.db.selectValue(`SELECT count(*) FROM jobs WHERE workspace_id=? AND status<>'closed' AND archived_at IS NULL AND deleted_at IS NULL`, [workspaceId]));
}

export const jobHasSignoff = (ctx: Ctx, id: string): boolean =>
  num(ctx.db.selectValue(`SELECT EXISTS (SELECT 1 FROM stage_locks WHERE job_id=?)`, [id])) === 1;

const ROW_SELECT = `SELECT j.*,
    (SELECT count(*) FROM locations l WHERE l.job_id=j.id AND l.deleted_at IS NULL) AS pieces,
    (SELECT count(DISTINCT e.location_id) FROM job_events e JOIN locations l ON l.id=e.location_id AND l.deleted_at IS NULL
      WHERE e.job_id=j.id AND e.event IN ('loaded','manual_loaded')) AS loaded,
    EXISTS (SELECT 1 FROM stage_locks s WHERE s.job_id=j.id) AS signed
  FROM jobs j`;
const toRow = (r: Record<string, unknown>): JobRow => ({ ...toJob(r), pieces: num(r.pieces), loaded: num(r.loaded), signed: num(r.signed) === 1 });

/**
 * Jobs of a workspace, soonest move first (no date last). With no filter: every job that isn't Closed or archived.
 * Filters: upcoming = Booked; today = moving today (not Closed); in_progress = Packing, Loaded or Delivered;
 * closed = Closed or archived. `today` is the phone's local date (YYYY-MM-DD). Search matches the customer name,
 * phone (digits only), either address, the label name and the job number ("J-0042", "j42", "42").
 */
export function listJobs(ctx: Ctx, workspaceId: string, opts: { filter?: JobFilter | null; q?: string; today: string }): JobRow[] {
  const where = ['j.workspace_id=?', 'j.deleted_at IS NULL'];
  const bind: unknown[] = [workspaceId];
  switch (opts.filter ?? null) {
    case 'upcoming': where.push(`j.status='booked' AND j.archived_at IS NULL`); break;
    case 'today': where.push(`substr(j.move_at,1,10)=? AND j.status<>'closed' AND j.archived_at IS NULL`); bind.push(opts.today); break;
    case 'in_progress': where.push(`j.status IN ('packing','loaded','delivered') AND j.archived_at IS NULL`); break;
    case 'closed': where.push(`(j.status='closed' OR j.archived_at IS NOT NULL)`); break;
    default: where.push(`j.status<>'closed' AND j.archived_at IS NULL`);
  }
  const q = clean(opts.q)?.toLowerCase();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = q.replace(/\D/g, '');
    const parts = [`lower(j.customer_name) LIKE ? ESCAPE '\\'`, `lower(j.customer_label_name) LIKE ? ESCAPE '\\'`,
      `lower(coalesce(j.pickup_address,'')) LIKE ? ESCAPE '\\'`, `lower(coalesce(j.delivery_address,'')) LIKE ? ESCAPE '\\'`];
    bind.push(like, like, like, like);
    if (digits.length >= 3) { parts.push(`replace(replace(replace(replace(coalesce(j.customer_phone,''),' ',''),'-',''),'+',''),'(','') LIKE ?`); bind.push(`%${digits}%`); }
    const jn = /^j?-?0*(\d{1,6})$/.exec(q.replace(/\s+/g, ''));
    if (jn) { parts.push('j.number=?'); bind.push(Number(jn[1])); }
    where.push(`(${parts.join(' OR ')})`);
  }
  return ctx.db.selectObjects(`${ROW_SELECT} WHERE ${where.join(' AND ')} ORDER BY j.move_at IS NULL, j.move_at, j.number`, bind).map(toRow);
}

export function getJobRow(ctx: Ctx, id: string): JobRow | undefined {
  const [r] = ctx.db.selectObjects(`${ROW_SELECT} WHERE j.id=?`, [id]);
  return r ? toRow(r) : undefined;
}

export class JobSignedError extends Error {
  name = 'JobSignedError';
  constructor() { super('job_signed_archive_only'); }
}

/** Moves a job, its boxes and pieces (and their items and photos) to the Bin with one timestamp. A signed job can only be archived. */
export function binJob(ctx: Ctx, id: string): void {
  if (jobHasSignoff(ctx, id)) throw new JobSignedError();
  const t = ctx.now();
  write(ctx, () => {
    const pieces = `SELECT id FROM locations WHERE job_id=? AND deleted_at IS NULL`;
    ctx.db.exec({ sql: `UPDATE items SET deleted_at=?, updated_at=? WHERE location_id IN (${pieces}) AND deleted_at IS NULL`, bind: [t, t, id] });
    ctx.db.exec({ sql: `UPDATE photos SET deleted_at=?, updated_at=? WHERE location_id IN (${pieces}) AND deleted_at IS NULL`, bind: [t, t, id] });
    ctx.db.exec({ sql: `UPDATE locations SET deleted_at=?, updated_at=? WHERE job_id=? AND deleted_at IS NULL`, bind: [t, t, id] });
    ctx.db.exec({ sql: `UPDATE jobs SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`, bind: [t, t, id] });
  });
}

/** Brings back exactly what binJob binned. Never gated by the free job limit (H-06). */
export function restoreJob(ctx: Ctx, id: string): void {
  const t = ctx.now();
  write(ctx, () => {
    const at = ctx.db.selectValue(`SELECT deleted_at FROM jobs WHERE id=?`, [id]);
    if (at == null) return;
    const pieces = `SELECT id FROM locations WHERE job_id=? AND deleted_at=?`;
    ctx.db.exec({ sql: `UPDATE items SET deleted_at=NULL, updated_at=? WHERE location_id IN (${pieces}) AND deleted_at=?`, bind: [t, id, at, at] });
    ctx.db.exec({ sql: `UPDATE photos SET deleted_at=NULL, updated_at=? WHERE location_id IN (${pieces}) AND deleted_at=?`, bind: [t, id, at, at] });
    ctx.db.exec({ sql: `UPDATE locations SET deleted_at=NULL, updated_at=? WHERE job_id=? AND deleted_at=?`, bind: [t, id, at] });
    ctx.db.exec({ sql: `UPDATE jobs SET deleted_at=NULL, updated_at=? WHERE id=?`, bind: [t, id] });
  });
}

export function archiveJob(ctx: Ctx, id: string, archived: boolean): void {
  const t = ctx.now();
  write(ctx, () => ctx.db.exec(archived
    ? { sql: `UPDATE jobs SET archived_at=coalesce(archived_at, ?), updated_at=? WHERE id=?`, bind: [t, t, id] }
    : { sql: `UPDATE jobs SET archived_at=NULL, updated_at=? WHERE id=?`, bind: [t, id] }));
}

export interface BinJob { id: string; number: number; customerName: string; deletedAt: string }

export function listBinJobs(ctx: Ctx, workspaceId: string): BinJob[] {
  const cutoff = daysBefore(ctx.now(), 30);
  return ctx.db.selectObjects(`SELECT id, number, customer_name, deleted_at FROM jobs WHERE workspace_id=? AND deleted_at IS NOT NULL AND deleted_at >= ? ORDER BY deleted_at DESC`, [workspaceId, cutoff])
    .map((r) => ({ id: String(r.id), number: num(r.number), customerName: String(r.customer_name), deletedAt: String(r.deleted_at) }));
}
