import { describe, it, expect } from 'vitest';
import { newest, toPrune, connectDecision, lockState, isBigChange, takeoverDefault, type Snap } from './rules';

const day = (d: number, h = 12) => new Date(Date.UTC(2026, 10, d, h)).toISOString();
const snap = (seq: number, at: string, over: Partial<Snap> = {}): Snap =>
  ({ id: `s${over.generation ?? 1}-${seq}`, generation: 1, seq, deviceId: 'A', keyId: 'bk_1', schemaVersion: 1, modifiedTime: at, beforeBigChange: false, ...over });

describe('snapshot order (audit B5)', () => {
  it('orders by generation then seq, never by time', () => {
    const list = [snap(9, day(20), { generation: 1 }), snap(2, day(1), { generation: 2 }), snap(5, day(30), { generation: 1 })];
    expect(newest(list)?.id).toBe('s2-2');
  });
  it('a device clock set a year ahead does not change the order (critical test 33)', () => {
    const list = [snap(1, '2027-11-01T00:00:00Z'), snap(2, day(2))];
    expect(newest(list)?.seq).toBe(2);
  });
});

describe('retention (audit A4)', () => {
  it('keeps the newest 3, the last of each of 7 days, and weekly for 4 weeks; about 14 files', () => {
    const now = day(28, 23);
    const list: Snap[] = [];
    let seq = 0;
    for (let d = 1; d <= 28; d++) for (let h = 1; h <= 4; h++) list.push(snap(++seq, day(d, h * 5)));
    const prune = new Set(toPrune(list, 1, now));
    const kept = list.filter((s) => !prune.has(s.id));
    expect(kept.length).toBeGreaterThanOrEqual(10);
    expect(kept.length).toBeLessThanOrEqual(15);
    // newest 3 always kept
    for (const s of list.slice(-3)) expect(prune.has(s.id)).toBe(false);
    // last snapshot of each of the past 7 days kept
    for (let d = 22; d <= 28; d++) expect(prune.has(snap(d * 4, day(d, 20)).id)).toBe(false);
  });
  it('never prunes "Before big change" younger than 30 days, and prunes it after', () => {
    const big = snap(1, day(1), { beforeBigChange: true });
    const many = Array.from({ length: 30 }, (_, i) => snap(i + 2, day(2, 0)));
    expect(toPrune([big, ...many], 1, day(20))).not.toContain(big.id);
    expect(toPrune([big, ...many], 1, '2026-12-15T00:00:00Z')).toContain(big.id);
  });
  it('keeps the last snapshot of an older generation for 30 days, and only prunes the current generation otherwise', () => {
    const old = [snap(1, day(1)), snap(2, day(1, 13))];
    const cur = [snap(1, day(5), { generation: 2 }), snap(2, day(5, 13), { generation: 2 })];
    const p = toPrune([...old, ...cur], 2, day(10));
    expect(p).not.toContain('s1-2');
    expect(p).toContain('s1-1');
    expect(toPrune([...old, ...cur], 2, '2026-12-05T00:00:00Z')).toContain('s1-2');
  });
});

describe('connect safety (audit B2)', () => {
  it('creates a folder when none exists', () => {
    expect(connectDecision([], 'bk_1')).toEqual({ kind: 'create' });
  });
  it('an empty BoxTap folder is reused', () => {
    expect(connectDecision([{ id: 'f1', snapshots: [] }], 'bk_1')).toEqual({ kind: 'use', folderId: 'f1' });
  });
  it('a folder with snapshots must be offered for restore first', () => {
    const d = connectDecision([{ id: 'f1', snapshots: [snap(3, day(3), { keyId: 'bk_other' })] }], 'bk_1');
    expect(d).toEqual({ kind: 'offer_restore', folderId: 'f1', sameKey: false, newestSeq: 3 });
  });
  it('a folder holding my own key is still offered for restore (it may be newer)', () => {
    expect(connectDecision([{ id: 'f1', snapshots: [snap(3, day(3))] }], 'bk_1')).toMatchObject({ kind: 'offer_restore', sameKey: true });
  });
});

describe('device lock (audit A6/B5)', () => {
  it('ok when I hold the lock at my generation', () => {
    expect(lockState({ deviceId: 'A', generation: 2 }, 'A', 2, [])).toBe('ok');
  });
  it('lost when another device took it, or a newer snapshot from another device exists', () => {
    expect(lockState({ deviceId: 'B', generation: 3 }, 'A', 2, [])).toBe('lost');
    expect(lockState({ deviceId: 'A', generation: 2 }, 'A', 2, [snap(9, day(9), { deviceId: 'B', generation: 3 })])).toBe('lost');
  });
  it('missing lock means the folder needs attention', () => {
    expect(lockState(null, 'A', 2, [])).toBe('missing');
  });
});

describe('big change and takeover', () => {
  it('flags when boxes, items, stock or photos drop by more than half', () => {
    const a = { boxes: 10, items: 100, onHand: 50, photos: 20 };
    expect(isBigChange(a, { ...a, boxes: 4 })).toBe(true);
    expect(isBigChange(a, { ...a, photos: 9 })).toBe(true);
    expect(isBigChange(a, { ...a, boxes: 6 })).toBe(false);
    expect(isBigChange({ boxes: 0, items: 0, onHand: 0, photos: 0 }, a)).toBe(false);
  });
  it('takeover defaults to restoring Drive when Drive is newer (critical test 32)', () => {
    expect(takeoverDefault({ generation: 2, seq: 5 }, snap(1, day(1), { generation: 3 }))).toBe('restore_newer');
    expect(takeoverDefault({ generation: 3, seq: 5 }, snap(5, day(1), { generation: 3 }))).toBe('take_over');
  });
});
