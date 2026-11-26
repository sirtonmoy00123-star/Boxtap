import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from '../../db/testDb';
import type { SqlDb } from '../../db/migrate';
import * as R from '../index';
import { createService, BlockedError } from '../../service/service';
import { DEFAULT_CONFIG } from '../../licensing/can';

let db: TestDb;
let ctx: R.Ctx;
let clock = '2026-11-27T08:00:00.000Z';
beforeEach(async () => {
  db = await openTestDb();
  clock = '2026-11-27T08:00:00.000Z';
  ctx = { db: db as unknown as SqlDb, now: () => clock };
});

const png = (n: number) => Uint8Array.from({ length: 200 }, (_, i) => (i * 7 + n) % 256);
const sha = (c: string) => c.repeat(64).slice(0, 64);
function setup() {
  const ws = R.createRemovalistWorkspace(ctx, { language: 'en', country: 'AU', volumeUnit: 'm3', name: 'Fast Movers', phone: '1' });
  const job = R.createJob(ctx, ws.id, { customerName: 'Ayesha Khan', crewLeader: 'Sam' });
  const [b1, b2] = R.quickAddBoxes(ctx, job.id, 2);
  const sofa = R.addJobBox(ctx, job.id, { isPiece: true, name: 'Sofa' });
  return { ws, job, b1: b1!, b2: b2!, sofa };
}
const photo = (jobId: string, boxId: string, stage: R.Stage, c = 'a', extra: Partial<Parameters<typeof R.addConditionPhoto>[1]> = {}) =>
  R.addConditionPhoto(ctx, { jobId, locationId: boxId, stage, capturedAt: clock, source: 'camera', photo: { mime: 'image/webp', bytes: 1000, sha256: sha(c) }, ...extra });
const sign = (jobId: string, stage: R.Stage, refused = false) => R.signStage(ctx, {
  jobId, stage, customer: refused ? null : { name: 'Ayesha Khan', signedAt: clock, png: png(1) }, crew: { name: 'Sam', signedAt: clock, png: png(2) },
});

describe('condition records', () => {
  it('saves tags and a note per piece per stage, photos with hash, time and source', () => {
    const { job, b1 } = setup();
    R.saveCondition(ctx, { jobId: job.id, locationId: b1.id, stage: 'pickup', tags: ['scratched', 'pre_existing', 'scratched'], note: 'Corner scuff' });
    const p = photo(job.id, b1.id, 'pickup');
    const r = R.getConditionRecord(ctx, job.id, b1.id, 'pickup')!;
    expect(r.tags).toEqual(['scratched', 'pre_existing']);
    expect(r.photos).toEqual([expect.objectContaining({ photoId: p.photoId, sha256: sha('a'), source: 'camera', capturedAt: clock, clockSuspect: false })]);
    expect(() => R.saveCondition(ctx, { jobId: job.id, locationId: b1.id, stage: 'pickup', tags: ['melted'] })).toThrow(/tag/);
    // Condition photos are not the box's own photos.
    expect(R.listPhotos(ctx, { locationId: b1.id })).toEqual([]);
    expect(R.photosOnParent(ctx, { locationId: b1.id })).toBe(0);
  });

  it('flags a photo taken with the phone clock behind the latest time seen', () => {
    const { job, b1 } = setup();
    expect(photo(job.id, b1.id, 'pickup', 'a').clockSuspect).toBe(false);
    clock = '2026-11-20T08:00:00.000Z'; // the clock went back a week
    expect(photo(job.id, b1.id, 'pickup', 'b', { capturedAt: clock }).clockSuspect).toBe(true);
  });

  it('limits condition photos through can(): 3 per piece per stage on Free, 10 on Pro', () => {
    const free = createService(ctx, () => ({ config: DEFAULT_CONFIG, plans: new Set() }));
    const { job, b1 } = setup();
    const add = (s: ReturnType<typeof createService>, c: string, stage: R.Stage = 'pickup') =>
      s.addConditionPhoto({ jobId: job.id, locationId: b1.id, stage, capturedAt: clock, source: 'library', photo: { mime: 'image/jpeg', bytes: 10, sha256: sha(c) } });
    for (const c of ['1', '2', '3']) add(free, c);
    expect(() => add(free, '4')).toThrow(BlockedError);
    add(free, '5', 'delivery'); // another stage has its own 3
    const pro = createService(ctx, () => ({ config: DEFAULT_CONFIG, plans: new Set(['removalist_pro' as const]) }));
    for (const c of ['6', '7', '8', '9', 'a', 'b', 'c']) add(pro, c);
    expect(() => add(pro, 'd')).toThrow(BlockedError);
  });
});

describe('report hash', () => {
  it('is the same for the same data and changes when any record, photo or signer changes', () => {
    const { job, b1, b2 } = setup();
    R.saveCondition(ctx, { jobId: job.id, locationId: b1.id, stage: 'pickup', tags: ['ok'] });
    photo(job.id, b1.id, 'pickup', 'a');
    const signers = [{ role: 'customer', name: 'Ayesha Khan', signedAt: clock, signatureSha256: sha('1') }, { role: 'crew_leader', name: 'Sam', signedAt: clock, signatureSha256: sha('2') }];
    const h1 = R.reportHash(ctx, job.id, 'pickup', signers, false);
    expect(R.reportHash(ctx, job.id, 'pickup', [...signers].reverse(), false)).toBe(h1); // order of signers doesn't matter
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(R.reportHash(ctx, job.id, 'pickup', signers, true)).not.toBe(h1);
    expect(R.reportHash(ctx, job.id, 'pickup', [signers[0]!, { ...signers[1]!, name: 'Sam B' }], false)).not.toBe(h1);
    expect(R.reportHash(ctx, job.id, 'pickup', [signers[0]!, { ...signers[1]!, signatureSha256: sha('3') }], false)).not.toBe(h1);
    R.saveCondition(ctx, { jobId: job.id, locationId: b1.id, stage: 'pickup', tags: ['dented'] });
    const h2 = R.reportHash(ctx, job.id, 'pickup', signers, false);
    expect(h2).not.toBe(h1);
    photo(job.id, b1.id, 'pickup', 'b');
    const h3 = R.reportHash(ctx, job.id, 'pickup', signers, false);
    expect(h3).not.toBe(h2);
    R.saveCondition(ctx, { jobId: job.id, locationId: b2.id, stage: 'pickup', tags: ['ok'] });
    expect(R.reportHash(ctx, job.id, 'pickup', signers, false)).not.toBe(h3);
    expect(R.reportHash(ctx, job.id, 'delivery', signers, false)).not.toBe(h1);
  });
});

describe('sign-off and locks', () => {
  it('writes both signoffs and the lock in one go; then only amendments; the hash still verifies', () => {
    const { job, b1 } = setup();
    R.saveCondition(ctx, { jobId: job.id, locationId: b1.id, stage: 'pickup', tags: ['ok'] });
    photo(job.id, b1.id, 'pickup');
    const { reportHash } = sign(job.id, 'pickup');
    expect(db.selectValues(`SELECT report_hash FROM signoffs ORDER BY signer_role`)).toEqual([reportHash, reportHash]);
    expect(R.stageSummary(ctx, job.id, 'pickup').locked).toMatchObject({ reportHash, customerRefused: false });
    expect(() => sign(job.id, 'pickup')).toThrow(R.AlreadySignedError);
    expect(() => R.saveCondition(ctx, { jobId: job.id, locationId: b1.id, stage: 'pickup', tags: ['dented'] })).toThrow(/stage_locked/);
    expect(() => photo(job.id, b1.id, 'pickup', 'e')).toThrow(/stage_locked/);
    expect(() => db.exec(`UPDATE condition_records SET note='x'`)).toThrow(/stage_locked/);
    const am = R.addAmendment(ctx, { jobId: job.id, locationId: b1.id, stage: 'pickup', note: 'Scratch found after sign-off', tags: ['scratched'] });
    photo(job.id, b1.id, 'pickup', 'f', { amendmentId: am.id });
    expect(R.pieceAmendments(ctx, job.id, b1.id, 'pickup')[0]).toMatchObject({ isAmendment: true, note: 'Scratch found after sign-off', tags: ['scratched'] });
    expect(() => R.addAmendment(ctx, { jobId: job.id, locationId: b1.id, stage: 'pickup', note: '  ' })).toThrow(/note/);
    expect(R.verifyStage(ctx, job.id, 'pickup')).toMatchObject({ ok: true, stored: reportHash });
    expect(R.getJob(ctx, job.id)!.status).not.toBe('closed'); // pickup doesn't close
    expect(() => R.binJob(ctx, job.id)).toThrow(R.JobSignedError);
  });

  it('a refused customer signature locks the stage with only the crew signature', () => {
    const { job, b1 } = setup();
    R.saveCondition(ctx, { jobId: job.id, locationId: b1.id, stage: 'pickup', tags: ['broken'] });
    const { reportHash } = sign(job.id, 'pickup', true);
    expect(db.selectValues(`SELECT signer_role FROM signoffs`)).toEqual(['crew_leader']);
    expect(R.stageSummary(ctx, job.id, 'pickup').locked).toMatchObject({ customerRefused: true, reportHash });
    expect(R.verifyStage(ctx, job.id, 'pickup')!.ok).toBe(true);
  });

  it('the delivery sign-off closes the job', () => {
    const { job } = setup();
    sign(job.id, 'pickup');
    sign(job.id, 'delivery');
    expect(R.getJob(ctx, job.id)!.status).toBe('closed');
  });
});

describe('pickup and delivery comparison', () => {
  it('lists changed pieces and pieces missing at delivery, and the damage count', () => {
    const { job, b1, b2, sofa } = setup();
    R.saveCondition(ctx, { jobId: job.id, locationId: b1.id, stage: 'pickup', tags: ['ok'] });
    R.saveCondition(ctx, { jobId: job.id, locationId: b2.id, stage: 'pickup', tags: ['ok'] });
    R.saveCondition(ctx, { jobId: job.id, locationId: sofa.id, stage: 'pickup', tags: ['scratched', 'pre_existing'] });
    expect(R.stageSummary(ctx, job.id, 'pickup')).toMatchObject({ total: 3, recorded: 3, withDamage: 1, notRecorded: [] });
    sign(job.id, 'pickup');
    R.saveCondition(ctx, { jobId: job.id, locationId: b1.id, stage: 'delivery', tags: ['dented'] });
    R.saveCondition(ctx, { jobId: job.id, locationId: sofa.id, stage: 'delivery', tags: ['pre_existing', 'scratched'] });
    const s = R.stageSummary(ctx, job.id, 'delivery');
    expect(s.notRecorded.map((p) => p.id)).toEqual([b2.id]);
    const c = R.compareStages(ctx, job.id);
    expect(c.changed).toEqual([expect.objectContaining({ piece: expect.objectContaining({ id: b1.id }), pickup: ['ok'], delivery: ['dented'] })]);
    expect(c.missing).toEqual([expect.objectContaining({ piece: expect.objectContaining({ id: b2.id }), why: 'not_recorded' })]);
  });
});
