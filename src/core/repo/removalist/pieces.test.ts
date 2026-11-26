import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from '../../db/testDb';
import type { SqlDb } from '../../db/migrate';
import * as R from '../index';
import { createService } from '../../service/service';
import { DEFAULT_CONFIG } from '../../licensing/can';

let db: TestDb;
let ctx: R.Ctx;
beforeEach(async () => {
  db = await openTestDb();
  ctx = { db: db as unknown as SqlDb, now: () => '2026-11-27T00:00:00.000Z' };
});
const setup = () => {
  const ws = R.createRemovalistWorkspace(ctx, { language: 'en', country: 'AU', volumeUnit: 'm3', name: 'Fast Movers', phone: '1' });
  const job = R.createJob(ctx, ws.id, { customerName: 'Ayesha Khan' });
  return { ws, job };
};

describe('boxes and pieces in a job', () => {
  it('numbers boxes and furniture pieces separately per job; the workspace number stays internal', () => {
    const { ws, job } = setup();
    const other = R.createJob(ctx, ws.id, { customerName: 'Tom Brown' });
    const b1 = R.addJobBox(ctx, job.id);
    const p1 = R.addJobBox(ctx, job.id, { isPiece: true, name: 'Sofa' });
    const b2 = R.addJobBox(ctx, job.id);
    const o1 = R.addJobBox(ctx, other.id);
    expect([b1.jobSeq, b2.jobSeq, p1.jobSeq, o1.jobSeq]).toEqual([1, 2, 1, 1]);
    expect([b1.isPiece, p1.isPiece]).toEqual([false, true]);
    expect([b1.number, p1.number, b2.number, o1.number]).toEqual([1, 2, 3, 4]);
    expect(R.listJobPieces(ctx, job.id).map((p) => `${p.isPiece ? 'P' : 'B'}${p.jobSeq}`)).toEqual(['B1', 'B2', 'P1']);
    // A binned box keeps its number: the next one does not reuse it.
    R.deleteBox(ctx, b2.id);
    expect(R.addJobBox(ctx, job.id).jobSeq).toBe(3);
  });

  it('boxes get the default box size (Standard carton); pieces can link a furniture type', () => {
    const { ws, job } = setup();
    const cat = R.listVolumeCatalogue(ctx, ws.id);
    const sofa = cat.find((c) => c.nameEn === '3-seater sofa')!;
    const large = cat.find((c) => c.nameEn === 'Large carton')!;
    const b = R.addJobBox(ctx, job.id);
    expect(b.volumeItemId).toBe(cat[0]!.id);
    const p = R.addJobBox(ctx, job.id, { isPiece: true, volumeItemId: sofa.id });
    expect(p.volumeItemId).toBe(sofa.id);
    expect(R.addJobBox(ctx, job.id, { isPiece: true }).volumeItemId).toBeNull();
    R.setPieceVolumeItem(ctx, b.id, large.id);
    expect(R.getJobPiece(ctx, b.id)!.volumeItemId).toBe(large.id);
    expect(() => R.setPieceVolumeItem(ctx, b.id, sofa.id)).toThrow(/box size/);
    expect(() => R.addJobBox(ctx, job.id, { isPiece: true, volumeItemId: large.id })).toThrow(/furniture/);
  });

  it('quick add makes 10 numbered empty boxes in one transaction and starts packing', () => {
    const { job } = setup();
    expect(R.getJob(ctx, job.id)!.status).toBe('booked');
    R.addJobBox(ctx, job.id, { isPiece: true });
    R.setJobStatus(ctx, job.id, 'booked');
    const ten = R.quickAddBoxes(ctx, job.id);
    expect(ten.map((b) => b.jobSeq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(ten.map((b) => b.labelCode)).size).toBe(10);
    expect(R.getJob(ctx, job.id)!.status).toBe('packing');
    expect(R.pieceCounts(ctx, job.id)).toEqual({ boxes: 10, pieces: 1 });
    // All or none: a failure part-way leaves nothing behind.
    const seqBefore = db.selectValue(`SELECT change_seq FROM (SELECT value AS change_seq FROM meta WHERE key='change_seq')`);
    db.exec(`CREATE TRIGGER fail_11 BEFORE INSERT ON locations WHEN (SELECT count(*) FROM locations) >= 15 BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    expect(() => R.quickAddBoxes(ctx, job.id)).toThrow(/boom/);
    expect(R.pieceCounts(ctx, job.id)).toEqual({ boxes: 10, pieces: 1 });
    expect(db.selectValue(`SELECT value FROM meta WHERE key='change_seq'`)).toBe(seqBefore);
  });

  it('quick add goes through can(): Removalist has no box limit', () => {
    const svc = createService(ctx, () => ({ config: DEFAULT_CONFIG, plans: new Set() }));
    const { job } = setup();
    for (let i = 0; i < 3; i++) svc.quickAddBoxes(job.id, 10);
    expect(svc.listJobPieces(job.id)).toHaveLength(30);
  });

  it('rooms belong to their job; a box can only use its own job\'s rooms', () => {
    const { ws, job } = setup();
    const other = R.createJob(ctx, ws.id, { customerName: 'Tom' });
    const kitchen = R.createJobRoom(ctx, job.id, 'Kitchen');
    const lounge = R.createJobRoom(ctx, other.id, 'Lounge');
    expect(R.listJobRooms(ctx, job.id).map((r) => r.name)).toEqual(['Kitchen']);
    expect(R.listJobRooms(ctx, other.id).map((r) => r.name)).toEqual(['Lounge']);
    const b = R.addJobBox(ctx, job.id, { roomId: kitchen.id });
    expect(R.getJobPiece(ctx, b.id)!.roomName).toBe('Kitchen');
    expect(() => R.setPieceRoom(ctx, b.id, lounge.id)).toThrow(/not in this job/);
    expect(() => R.addJobBox(ctx, job.id, { roomId: lounge.id })).toThrow(/not in this job/);
    R.setPieceRoom(ctx, b.id, null);
    expect(R.getJobPiece(ctx, b.id)!.roomId).toBeNull();
    // Home rooms are untouched by job rooms.
    expect(R.listRooms(ctx, ws.id).map((r) => r.name).sort()).toEqual(['Kitchen', 'Lounge']);
  });

  it('label data: last name, job number, "of N" at print time, and a warning after boxes are added', () => {
    const { job } = setup();
    const room = R.createJobRoom(ctx, job.id, 'Kitchen');
    const b1 = R.addJobBox(ctx, job.id, { roomId: room.id, isFragile: true });
    R.addJobBox(ctx, job.id);
    const p1 = R.addJobBox(ctx, job.id, { isPiece: true, openFirst: true });
    const set = R.jobLabels(ctx, job.id);
    expect(set).toMatchObject({ businessName: 'Fast Movers', jobNumber: 'J-0001', labelName: 'Khan', sheet: 'L7165' });
    expect(set.labels.map((l) => [l.isPiece, l.seq, l.of])).toEqual([[false, 1, 2], [false, 2, 2], [true, 1, 1]]);
    expect(set.labels[0]).toMatchObject({ room: 'Kitchen', fragile: true, code: b1.labelCode });
    expect(R.jobLabels(ctx, job.id, [p1.id]).labels).toHaveLength(1);
    expect(R.jobLabelsStatus(ctx, job.id)).toEqual({ printed: null, stale: false });
    R.markJobLabelsPrinted(ctx, job.id);
    expect(R.jobLabelsStatus(ctx, job.id).stale).toBe(false);
    R.addJobBox(ctx, job.id);
    expect(R.jobLabelsStatus(ctx, job.id)).toEqual({ printed: { boxes: 2, pieces: 1 }, stale: true });
  });

  it('a job box opens by its label; a spare label can be stuck onto it', () => {
    const { ws, job } = setup();
    const b = R.addJobBox(ctx, job.id);
    expect(R.labelStatus(ctx, b.labelCode)).toEqual({ kind: 'box', workspaceId: ws.id, boxId: b.id });
    const [spare] = R.createSpareLabels(ctx, ws.id, 1);
    R.assignLabel(ctx, spare!, b.id);
    expect(R.labelStatus(ctx, spare!)).toMatchObject({ kind: 'box', boxId: b.id });
  });

  it('a box in a signed job cannot be binned', () => {
    const { job } = setup();
    const b = R.addJobBox(ctx, job.id);
    db.exec(`INSERT INTO stage_locks (job_id,stage,locked_at,report_hash) VALUES ('${job.id}','pickup','x','${'a'.repeat(64)}')`);
    expect(() => R.deleteBox(ctx, b.id)).toThrow(/job_signed_archive_only/);
    expect(() => R.addJobBox(ctx, job.id)).not.toThrow(); // adding is still allowed
  });
});
