import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from '../../db/testDb';
import type { SqlDb } from '../../db/migrate';
import * as R from '../index';
import { createService, BlockedError } from '../../service/service';
import { DEFAULT_CONFIG } from '../../licensing/can';

let db: TestDb;
let clock: string;
let ctx: R.Ctx;
beforeEach(async () => {
  db = await openTestDb();
  clock = '2026-11-26T00:00:00.000Z';
  ctx = { db: db as unknown as SqlDb, now: () => clock };
});

const business = (over: Partial<R.RemovalistSetup> = {}) => R.createRemovalistWorkspace(ctx, {
  language: 'en', country: 'AU', volumeUnit: 'm3', name: 'Fast Movers', phone: '0400 111 222', ...over,
});

describe('Removalist business setup', () => {
  it('creates the workspace, profile, trucks and the 22 starter volume items', () => {
    const ws = business({ email: 'hi@fast.example', abnOrLicence: '12 345 678 901', trucks: [{ name: 'Small', capacityM3: 20 }, { name: 'Big', capacityM3: 45 }] });
    expect(ws).toMatchObject({ type: 'removalist', name: 'Fast Movers', country: 'AU', currency: 'AUD' });
    const p = R.getBusinessProfile(ctx, ws.id)!;
    expect(p).toMatchObject({ name: 'Fast Movers', phone: '0400 111 222', email: 'hi@fast.example', volumeUnit: 'm3', bufferPct: 10, hasLogo: false });
    expect(R.listTrucks(ctx, ws.id).map((t) => [t.name, t.capacityM3])).toEqual([['Small', 20], ['Big', 45]]);
    const cat = R.listVolumeCatalogue(ctx, ws.id);
    expect(cat).toHaveLength(22);
    expect(cat.every((c) => c.isDefault)).toBe(true);
    expect(cat[0]).toMatchObject({ nameEn: 'Standard carton', volumeM3: 0.1, kind: 'box' });
    expect(cat[21]).toMatchObject({ nameEn: 'Showcase / display cabinet (BD)', nameBn: 'শোকেস', volumeM3: 1 });
    expect(p.defaultBoxItemId).toBe(cat[0]!.id);
  });

  it('Bangladesh: BDT, and the chosen unit', () => {
    const ws = business({ country: 'BD', volumeUnit: 'ft3', language: 'bn' });
    expect(ws.currency).toBe('BDT');
    expect(R.getBusinessProfile(ctx, ws.id)!.volumeUnit).toBe('ft3');
  });

  it('requires the business name and phone; email must look like one', () => {
    expect(() => business({ name: ' ' })).toThrow(/name/);
    expect(() => business({ phone: '' })).toThrow(/phone/);
    expect(() => business({ email: 'nope' })).toThrow(/email/);
    expect(() => business({ trucks: [{ name: 'T', capacityM3: 0 }] })).toThrow(/capacity/);
    expect(R.listWorkspaces(ctx)).toHaveLength(0); // nothing half-made
  });

  it('editing the profile renames the workspace; trucks can be added, edited and removed', () => {
    const ws = business();
    R.updateBusinessProfile(ctx, ws.id, { name: 'Faster Movers', phone: '1', volumeUnit: 'ft3' });
    expect(R.getWorkspace(ctx, ws.id)!.name).toBe('Faster Movers');
    expect(R.getBusinessProfile(ctx, ws.id)!.volumeUnit).toBe('ft3');
    const t = R.addTruck(ctx, ws.id, { name: '30 m³', capacityM3: 30 });
    R.updateTruck(ctx, t.id, { name: 'Isuzu', capacityM3: 32.5 });
    expect(R.listTrucks(ctx, ws.id)[0]).toMatchObject({ name: 'Isuzu', capacityM3: 32.5 });
    R.deleteTruck(ctx, t.id);
    expect(R.listTrucks(ctx, ws.id)).toEqual([]);
  });
});

describe('jobs', () => {
  it('numbers jobs J-0001, J-0002 and fills the label name with the last name', () => {
    const ws = business();
    const a = R.createJob(ctx, ws.id, { customerName: '  Ayesha  Rahman Khan ' });
    const b = R.createJob(ctx, ws.id, { customerName: 'Tom', customerLabelName: 'TOM-B' });
    expect([R.jobNumber(a.number), R.jobNumber(b.number)]).toEqual(['J-0001', 'J-0002']);
    expect(a).toMatchObject({ customerName: 'Ayesha  Rahman Khan', customerLabelName: 'Khan', status: 'booked' });
    expect(b.customerLabelName).toBe('TOM-B');
    expect(() => R.createJob(ctx, ws.id, { customerName: '' })).toThrow(/customer name/);
    expect(() => R.createJob(ctx, ws.id, { customerName: 'X', moveAt: '26/11/2026' })).toThrow(/move date/);
  });

  it('edits a job and changes its status', () => {
    const ws = business();
    const j = R.createJob(ctx, ws.id, { customerName: 'Mia Tran' });
    R.updateJob(ctx, j.id, { customerPhone: '0411 222 333', pickupAddress: '1 Old St, Parramatta', moveAt: '2026-12-03T08:30', customerLabelName: 'Tran' });
    R.setJobStatus(ctx, j.id, 'packing');
    expect(R.getJob(ctx, j.id)).toMatchObject({ customerPhone: '0411 222 333', moveAt: '2026-12-03T08:30', status: 'packing' });
    expect(() => R.setJobStatus(ctx, j.id, 'lost' as R.JobStatus)).toThrow(/status/);
  });

  it('searches by customer name, phone, address and job number', () => {
    const ws = business();
    R.createJob(ctx, ws.id, { customerName: 'Ayesha Khan', customerPhone: '+61 400 123 456', pickupAddress: '5 Rose St, Blacktown' });
    R.createJob(ctx, ws.id, { customerName: 'Tom Brown', deliveryAddress: 'Unit 2, Mirpur 10, Dhaka' });
    const q = (s: string) => R.listJobs(ctx, ws.id, { q: s, today: '2026-11-26' }).map((j) => j.customerName);
    expect(q('khan')).toEqual(['Ayesha Khan']);
    expect(q('400123')).toEqual(['Ayesha Khan']);
    expect(q('0400 123 456'.slice(1))).toEqual(['Ayesha Khan']);
    expect(q('mirpur')).toEqual(['Tom Brown']);
    expect(q('J-0002')).toEqual(['Tom Brown']);
    expect(q('j2')).toEqual(['Tom Brown']);
    expect(q('100%')).toEqual([]);
  });

  it('filters Upcoming, Today, In progress, Closed; no filter shows every open job', () => {
    const ws = business();
    const mk = (name: string, moveAt: string | null, status: R.JobStatus) => {
      const j = R.createJob(ctx, ws.id, { customerName: name, moveAt });
      R.setJobStatus(ctx, j.id, status);
      return j;
    };
    mk('Later', '2026-12-01T09:00', 'booked');
    mk('Now', '2026-11-26T07:00', 'packing');
    mk('Road', '2026-11-25', 'loaded');
    mk('Done', '2026-11-20', 'closed');
    const archived = mk('Old', null, 'delivered');
    R.archiveJob(ctx, archived.id, true);
    const f = (filter: R.JobFilter | null) => R.listJobs(ctx, ws.id, { filter, today: '2026-11-26' }).map((j) => j.customerName);
    expect(f(null)).toEqual(['Road', 'Now', 'Later']); // soonest first
    expect(f('upcoming')).toEqual(['Later']);
    expect(f('today')).toEqual(['Now']);
    expect(f('in_progress')).toEqual(['Road', 'Now']);
    expect(f('closed')).toEqual(['Done', 'Old']);
  });

  it('bins a job with its boxes and pieces at one timestamp, lists it in the Bin, and restores exactly those', () => {
    const ws = business();
    const j = R.createJob(ctx, ws.id, { customerName: 'Ayesha Khan' });
    const p1 = R.createBox(ctx, ws.id, {});
    const p2 = R.createBox(ctx, ws.id, {});
    db.exec(`UPDATE locations SET job_id='${j.id}', job_seq=1 WHERE id='${p1.id}'`);
    db.exec(`UPDATE locations SET job_id='${j.id}', job_seq=2 WHERE id='${p2.id}'`);
    R.deleteBox(ctx, p2.id); // binned earlier on its own
    clock = '2026-11-26T05:00:00.000Z';
    expect(R.getJobRow(ctx, j.id)!.pieces).toBe(1);
    R.binJob(ctx, j.id);
    expect(R.listJobs(ctx, ws.id, { today: '2026-11-26' })).toEqual([]);
    const bin = R.listBin(ctx, ws.id);
    expect(bin.jobs.map((x) => x.customerName)).toEqual(['Ayesha Khan']);
    expect(bin.boxes.map((b) => b.id)).toEqual([]); // the job's boxes come back with the job
    R.restoreJob(ctx, j.id);
    expect(R.getJob(ctx, j.id)!.deletedAt).toBeNull();
    expect(R.getBox(ctx, p1.id)!.deletedAt).toBeNull();
    expect(R.getBox(ctx, p2.id)!.deletedAt).not.toBeNull(); // was binned on its own before
  });

  it('the Bin purge removes a job binned over 30 days ago, with its pieces, labels freed', () => {
    const ws = business();
    const j = R.createJob(ctx, ws.id, { customerName: 'Gone' });
    const p = R.createBox(ctx, ws.id, {});
    db.exec(`UPDATE locations SET job_id='${j.id}', job_seq=1 WHERE id='${p.id}'`);
    db.exec(`INSERT INTO job_events (id,workspace_id,job_id,location_id,event,direction,at) VALUES ('e1','${ws.id}','${j.id}','${p.id}','loaded','load','${clock}')`);
    R.binJob(ctx, j.id);
    clock = '2027-01-01T00:00:00.000Z';
    const r = R.purgeBin(ctx);
    expect(r.jobs).toBe(1);
    expect(db.selectValue(`SELECT count(*) FROM jobs`)).toBe(0);
    expect(db.selectValue(`SELECT count(*) FROM locations`)).toBe(0);
    expect(db.selectValue(`SELECT count(*) FROM job_events`)).toBe(0);
    expect(db.selectValue(`SELECT count(*) FROM labels WHERE location_id IS NULL AND retired_at IS NOT NULL`)).toBe(1);
  });
});

describe('Removalist licensing through the service (plan §7)', () => {
  const svc = (plans: string[] = []) => createService(ctx, () => ({ config: DEFAULT_CONFIG, plans: new Set(plans as never[]) }));

  it('Free: 2 active jobs; a Closed or archived job frees a place; restoring from the Bin is never blocked', () => {
    const s = svc();
    const ws = s.createRemovalistWorkspace({ language: 'en', country: 'AU', volumeUnit: 'm3', name: 'M', phone: '1' });
    const a = s.createJob(ws.id, { customerName: 'A' });
    const b = s.createJob(ws.id, { customerName: 'B' });
    expect(() => s.createJob(ws.id, { customerName: 'C' })).toThrow(BlockedError);
    expect(s.check('add_job', ws.id)).toEqual({ allowed: false, reason: 'limit_jobs' });
    s.setJobStatus(a.id, 'closed');
    const c = s.createJob(ws.id, { customerName: 'C' });
    s.archiveJob(b.id, true);
    s.createJob(ws.id, { customerName: 'D' });
    s.binJob(c.id);
    s.createJob(ws.id, { customerName: 'E' });
    s.restoreJob(c.id); // 3 active now: restore is never gated
    expect(s.listJobs(ws.id, { today: '2026-11-26' })).toHaveLength(3);
    // Reading, search, export, and the box/item gates stay open.
    expect(s.check('add_box', ws.id)).toEqual({ allowed: true });
    expect(s.check('share_pdf', ws.id)).toEqual({ allowed: true });
    expect(s.check('logo_branding', ws.id)).toEqual({ allowed: false, reason: 'pro_only' });
    expect(typeof s.exportCsv(ws.id)).toBe('string');
  });

  it('Removalist Pro (preview switch) lifts the job limit and allows the logo', () => {
    const s = svc(['removalist_pro']);
    const ws = s.createRemovalistWorkspace({ language: 'en', country: 'AU', volumeUnit: 'm3', name: 'M', phone: '1' });
    for (let i = 0; i < 5; i++) s.createJob(ws.id, { customerName: `C${i}` });
    expect(s.check('logo_branding', ws.id)).toEqual({ allowed: true });
  });

  it('a Seller Pro or Move Pass does not unlock Removalist, and jobs need a Removalist workspace', () => {
    const s = svc(['seller_pro', 'move_pass']);
    const ws = s.createRemovalistWorkspace({ language: 'en', country: 'AU', volumeUnit: 'm3', name: 'M', phone: '1' });
    s.createJob(ws.id, { customerName: 'A' });
    s.createJob(ws.id, { customerName: 'B' });
    expect(() => s.createJob(ws.id, { customerName: 'C' })).toThrow(BlockedError);
    const home = s.createWorkspace({ type: 'home', name: 'H', country: 'AU', currency: 'AUD', language: 'en' });
    expect(s.check('add_job', home.id)).toEqual({ allowed: false, reason: 'feature_off' });
  });
});
