import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from '../../db/testDb';
import type { SqlDb } from '../../db/migrate';
import * as R from '../index';

let db: TestDb;
let ctx: R.Ctx;
let t = 0;
beforeEach(async () => {
  db = await openTestDb();
  t = 0;
  ctx = { db: db as unknown as SqlDb, now: () => new Date(Date.UTC(2026, 10, 27, 8, 0, t++)).toISOString() };
});

function setup() {
  const ws = R.createRemovalistWorkspace(ctx, { language: 'en', country: 'AU', volumeUnit: 'm3', name: 'Fast Movers', phone: '1' });
  const job = R.createJob(ctx, ws.id, { customerName: 'Ayesha Khan' });
  const boxes = R.quickAddBoxes(ctx, job.id, 3);
  const sofa = R.addJobBox(ctx, job.id, { isPiece: true, name: 'Sofa' });
  return { ws, job, boxes, sofa };
}
const events = () => db.selectValues(`SELECT event FROM job_events ORDER BY at`).map(String);

describe('load check', () => {
  it('counts each box once; a repeat says Already loaded and is not counted', () => {
    const { job, boxes } = setup();
    expect(R.recordScan(ctx, job.id, 'load', boxes[0]!.labelCode)).toMatchObject({ kind: 'counted', seq: 1, done: 1, total: 4 });
    expect(R.recordScan(ctx, job.id, 'load', boxes[1]!.labelCode)).toMatchObject({ kind: 'counted', seq: 2, done: 2, total: 4 });
    expect(R.recordScan(ctx, job.id, 'load', boxes[0]!.labelCode)).toMatchObject({ kind: 'already', seq: 1, done: 2, total: 4 });
    expect(events()).toEqual(['loaded', 'loaded']);
  });

  it('a box of another job: warning with its number, job and name, recorded as wrong_job_scan', () => {
    const { ws, job } = setup();
    const other = R.createJob(ctx, ws.id, { customerName: 'Tom Brown' });
    R.quickAddBoxes(ctx, other.id, 3);
    const b4 = R.addJobBox(ctx, other.id);
    expect(R.recordScan(ctx, job.id, 'load', b4.labelCode)).toEqual({ kind: 'otherJob', isPiece: false, seq: 4, jobNumber: 'J-0002', labelName: 'Brown' });
    expect(events()).toEqual(['wrong_job_scan']);
    expect(R.checkState(ctx, job.id, 'load').done).toBe(0);
  });

  it('a Home or Seller box on this phone is not part of the job; an unknown or spare code is refused', () => {
    const { ws, job } = setup();
    const home = R.createWorkspace(ctx, { type: 'home', name: 'H', country: 'AU', currency: 'AUD', language: 'en' });
    const hb = R.createBox(ctx, home.id, {});
    expect(R.recordScan(ctx, job.id, 'load', hb.labelCode)).toEqual({ kind: 'notInJob' });
    const loose = R.createBox(ctx, ws.id, {}); // a Removalist box outside any job
    expect(R.recordScan(ctx, job.id, 'load', loose.labelCode)).toEqual({ kind: 'notInJob' });
    expect(R.recordScan(ctx, job.id, 'load', 'ZZZZZZZZZZ')).toEqual({ kind: 'unknown' });
    const [spare] = R.createSpareLabels(ctx, ws.id, 1);
    expect(R.recordScan(ctx, job.id, 'load', spare!)).toEqual({ kind: 'unknown' });
    expect(events()).toEqual([]);
  });

  it('a manual tick counts once and shows as manual', () => {
    const { job, sofa } = setup();
    R.manualTick(ctx, job.id, 'load', sofa.id);
    R.manualTick(ctx, job.id, 'load', sofa.id);
    expect(events()).toEqual(['manual_loaded']);
    expect(R.recordScan(ctx, job.id, 'load', sofa.labelCode).kind).toBe('already');
    expect(R.checkState(ctx, job.id, 'load').rows.find((r) => r.piece.id === sofa.id)!.done).toBe('manual');
  });

  it('finishing needs a reason for every missing piece (Other needs a note), then the job is Loaded', () => {
    const { job, boxes, sofa } = setup();
    R.recordScan(ctx, job.id, 'load', boxes[0]!.labelCode);
    R.recordScan(ctx, job.id, 'load', boxes[1]!.labelCode);
    expect(() => R.finishCheck(ctx, job.id, 'load', {})).toThrow(R.MissingReasonError);
    try { R.finishCheck(ctx, job.id, 'load', { [sofa.id]: { reason: 'customer_taking' } }); } catch (e) {
      expect((e as R.MissingReasonError).boxIds).toEqual([boxes[2]!.id]);
    }
    expect(() => R.finishCheck(ctx, job.id, 'load', { [boxes[2]!.id]: { reason: 'other' }, [sofa.id]: { reason: 'customer_taking' } })).toThrow(R.MissingReasonError);
    expect(R.getJob(ctx, job.id)!.status).toBe('packing');
    R.finishCheck(ctx, job.id, 'load', { [boxes[2]!.id]: { reason: 'other', note: 'Box split, repacked' }, [sofa.id]: { reason: 'customer_taking' } });
    expect(R.getJob(ctx, job.id)!.status).toBe('loaded');
    const s = R.checkState(ctx, job.id, 'load');
    expect(s.finished).toBe(true);
    expect(s.rows.find((r) => r.piece.id === sofa.id)!.missing).toEqual({ reason: 'customer_taking', note: null });
    expect(db.selectValues(`SELECT reason FROM job_events WHERE event='missing_ack' ORDER BY reason`)).toEqual(['customer_taking', 'other']);
  });
});

describe('unload check', () => {
  it('expects what was loaded, flags a box that was never loaded, and finishing makes the job Delivered', () => {
    const { job, boxes, sofa } = setup();
    R.recordScan(ctx, job.id, 'load', boxes[0]!.labelCode);
    R.manualTick(ctx, job.id, 'load', boxes[1]!.id);
    R.finishCheck(ctx, job.id, 'load', { [boxes[2]!.id]: { reason: 'left_on_purpose' }, [sofa.id]: { reason: 'not_found' } });
    expect(R.checkState(ctx, job.id, 'unload')).toMatchObject({ done: 0, total: 2 });
    expect(R.recordScan(ctx, job.id, 'unload', boxes[0]!.labelCode)).toMatchObject({ kind: 'counted', done: 1, total: 2 });
    expect(R.recordScan(ctx, job.id, 'unload', boxes[0]!.labelCode).kind).toBe('already');
    // The sofa turned up after all: counted on unload, flagged as never loaded.
    expect(R.recordScan(ctx, job.id, 'unload', sofa.labelCode)).toMatchObject({ kind: 'counted', notLoaded: true });
    expect(() => R.finishCheck(ctx, job.id, 'unload', {})).toThrow(R.MissingReasonError);
    R.finishCheck(ctx, job.id, 'unload', { [boxes[1]!.id]: { reason: 'not_found' } });
    expect(R.getJob(ctx, job.id)!.status).toBe('delivered');
    expect(R.checkCounts(ctx, job.id)).toEqual({ load: { done: 2, total: 4 }, unload: { done: 1, total: 2 } });
  });

  it('status never goes backwards: finishing a load on a Delivered job leaves it Delivered', () => {
    const { job, boxes, sofa } = setup();
    R.setJobStatus(ctx, job.id, 'delivered');
    R.finishCheck(ctx, job.id, 'load', Object.fromEntries([...boxes, sofa].map((b) => [b.id, { reason: 'not_found' as const }])));
    expect(R.getJob(ctx, job.id)!.status).toBe('delivered');
  });

  it('the events are append-only', () => {
    const { job, boxes } = setup();
    R.recordScan(ctx, job.id, 'load', boxes[0]!.labelCode);
    expect(() => db.exec(`DELETE FROM job_events`)).toThrow(/append_only/);
  });
});
