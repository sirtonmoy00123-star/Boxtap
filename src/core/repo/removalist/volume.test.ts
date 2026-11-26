import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from '../../db/testDb';
import type { SqlDb } from '../../db/migrate';
import * as R from '../index';

let db: TestDb;
let ctx: R.Ctx;
beforeEach(async () => {
  db = await openTestDb();
  ctx = { db: db as unknown as SqlDb, now: () => '2026-11-27T08:00:00.000Z' };
});
function setup(trucks = [{ name: 'Small', capacityM3: 20 }, { name: 'Mid', capacityM3: 30 }]) {
  const ws = R.createRemovalistWorkspace(ctx, { language: 'en', country: 'AU', volumeUnit: 'm3', name: 'M', phone: '1', trucks });
  const job = R.createJob(ctx, ws.id, { customerName: 'Ayesha Khan' });
  const cat = R.listVolumeCatalogue(ctx, ws.id);
  const by = (n: string) => cat.find((c) => c.nameEn === n)!;
  return { ws, job, by };
}

describe('job volume', () => {
  it('counts boxes by size and furniture by linked type; unlinked furniture is listed apart', () => {
    const { job, by } = setup();
    R.quickAddBoxes(ctx, job.id, 10); // Standard carton 0.10
    const large = R.addJobBox(ctx, job.id);
    R.setPieceVolumeItem(ctx, large.id, by('Large carton').id); // 0.15
    R.addJobBox(ctx, job.id, { isPiece: true, volumeItemId: by('3-seater sofa').id }); // 1.50
    const loose = R.addJobBox(ctx, job.id, { isPiece: true, name: 'Piano' });
    const v = R.jobVolume(ctx, job.id);
    expect(v.counted.map((g) => [g.item.nameEn, g.isPiece, g.count])).toEqual([['Standard carton', false, 10], ['Large carton', false, 1], ['3-seater sofa', true, 1]]);
    expect(v.uncounted.map((p) => p.id)).toEqual([loose.id]);
    expect(v.countedM3).toBeCloseTo(2.65, 10);
  });

  it('adds catalogue lines (again = one more) and custom lines; quantity 0 removes; total, buffer and truck', () => {
    const { ws, job, by } = setup();
    R.addVolumeLine(ctx, job.id, { volumeItemId: by('Fridge, large').id }); // 1.00
    R.addVolumeLine(ctx, job.id, { volumeItemId: by('Fridge, large').id });
    R.addVolumeLine(ctx, job.id, { name: 'Pool table', m3Each: 2.5, quantity: 1 });
    let v = R.jobVolume(ctx, job.id);
    expect(v.lines.map((l) => [l.nameEn ?? l.name, l.quantity, l.m3Each])).toEqual([['Fridge, large', 2, 1], ['Pool table', 1, 2.5]]);
    expect(v.totalM3).toBeCloseTo(4.5, 10);
    expect(v.bufferPct).toBe(10);
    expect(v.neededM3).toBeCloseTo(4.95, 10);
    expect(v.truck).toMatchObject({ kind: 'fits', truck: { name: 'Small' } });
    R.bumpVolumeLine(ctx, v.lines[0]!.id, 1);
    R.bumpVolumeLine(ctx, v.lines[0]!.id, -1);
    expect(R.listVolumeLines(ctx, job.id)[0]!.quantity).toBe(2);
    R.bumpVolumeLine(ctx, v.lines[0]!.id, -1);
    R.bumpVolumeLine(ctx, v.lines[0]!.id, -1); // from 1: the line goes
    expect(R.listVolumeLines(ctx, job.id).map((l) => l.name)).toEqual(['Pool table']);
    R.addVolumeLine(ctx, job.id, { name: 'Shed contents', m3Each: 18, quantity: 1 });
    R.setBufferPct(ctx, ws.id, 20);
    v = R.jobVolume(ctx, job.id);
    expect(v.totalM3).toBeCloseTo(20.5, 10);
    expect(v.neededM3).toBeCloseTo(24.6, 10);
    expect(v.truck).toMatchObject({ kind: 'fits', truck: { name: 'Mid' } });
    R.addVolumeLine(ctx, job.id, { name: 'Warehouse', m3Each: 50, quantity: 1 });
    expect(R.jobVolume(ctx, job.id).truck).toMatchObject({ kind: 'tooBig', largest: { name: 'Mid' } });
    expect(() => R.addVolumeLine(ctx, job.id, { name: ' ', m3Each: 1 })).toThrow(/name/);
    expect(() => R.setBufferPct(ctx, ws.id, 101)).toThrow(/buffer/);
  });

  it('with no trucks only the total is given', () => {
    const { job } = setup([]);
    R.addVolumeLine(ctx, job.id, { name: 'Bits', m3Each: 1 });
    expect(R.jobVolume(ctx, job.id).truck).toEqual({ kind: 'noTrucks' });
  });
});

describe('volume catalogue editing', () => {
  it('adds, edits, moves and hides items; hidden items still count; the default box size stays', () => {
    const { ws, job, by } = setup();
    const piano = R.addVolumeItem(ctx, ws.id, { nameEn: 'Piano', nameBn: 'পিয়ানো', volumeM3: 1.2 });
    expect(R.listVolumeCatalogue(ctx, ws.id).at(-1)).toMatchObject({ nameEn: 'Piano', volumeM3: 1.2, isDefault: false });
    R.updateVolumeItem(ctx, by('Desk').id, { nameEn: 'Desk', volumeM3: 0.7 });
    expect(R.listVolumeCatalogue(ctx, ws.id).find((c) => c.nameEn === 'Desk')).toMatchObject({ volumeM3: 0.7, isDefault: false });
    R.moveVolumeItem(ctx, piano.id, -1);
    expect(R.listVolumeCatalogue(ctx, ws.id).slice(-2).map((c) => c.nameEn)).toEqual(['Piano', 'Showcase / display cabinet (BD)']);
    R.addJobBox(ctx, job.id, { isPiece: true, volumeItemId: piano.id });
    R.hideVolumeItem(ctx, piano.id);
    expect(R.listVolumeCatalogue(ctx, ws.id).some((c) => c.id === piano.id)).toBe(false);
    expect(R.jobVolume(ctx, job.id).countedM3).toBeCloseTo(1.2, 10);
    expect(() => R.hideVolumeItem(ctx, by('Standard carton').id)).toThrow(/default box size/);
    expect(() => R.addVolumeItem(ctx, ws.id, { volumeM3: 1 })).toThrow(/name/);
    expect(() => R.addVolumeItem(ctx, ws.id, { nameEn: 'X', volumeM3: 0 })).toThrow(/size/);
  });
});
