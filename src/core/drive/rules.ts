// Pure Drive backup rules (API_CONTRACTS §6.1 and §6.2, ADR-022). No network here, so all of it is unit-tested.

export interface Snap {
  id: string;
  generation: number;
  seq: number;
  deviceId: string;
  keyId: string;
  schemaVersion: number;
  /** Server-set Drive modifiedTime: used only to bucket days and ages, never to order. */
  modifiedTime: string;
  beforeBigChange: boolean;
}

const DAY = 86_400_000;
const cmp = (a: Pick<Snap, 'generation' | 'seq'>, b: Pick<Snap, 'generation' | 'seq'>) => a.generation - b.generation || a.seq - b.seq;

/** "Newest" means highest (generation, seq), never a clock (audit B5). */
export function newest(snaps: readonly Snap[]): Snap | undefined {
  return [...snaps].sort(cmp).at(-1);
}

/**
 * Snapshot ids to delete (audit A4 + B5): in the current generation keep the newest 3, the last snapshot of
 * each of the past 7 days, and the last of each of the past 4 weeks; keep "Before big change" for 30 days;
 * in older generations keep only the last snapshot, for 30 days.
 */
export function toPrune(snaps: readonly Snap[], currentGeneration: number, nowIso: string): string[] {
  const now = Date.parse(nowIso);
  const age = (s: Snap) => now - Date.parse(s.modifiedTime);
  const keep = new Set<string>();

  const current = snaps.filter((s) => s.generation === currentGeneration).sort(cmp);
  current.slice(-3).forEach((s) => keep.add(s.id));
  const lastIn = (from: number, to: number) => {
    const inWindow = current.filter((s) => { const a = age(s); return a >= from && a < to; });
    const last = inWindow.at(-1);
    if (last) keep.add(last.id);
  };
  const startOfToday = Math.floor(now / DAY) * DAY;
  for (let d = 0; d < 7; d++) {
    const dayStart = startOfToday - d * DAY;
    lastIn(now - (dayStart + DAY), now - dayStart + 1);
  }
  for (let w = 0; w < 4; w++) lastIn(w * 7 * DAY, (w + 1) * 7 * DAY);

  for (const s of snaps) if (s.beforeBigChange && age(s) < 30 * DAY) keep.add(s.id);

  const older = new Map<number, Snap>();
  for (const s of snaps) {
    if (s.generation >= currentGeneration) continue;
    const prev = older.get(s.generation);
    if (!prev || cmp(prev, s) < 0) older.set(s.generation, s);
  }
  for (const s of older.values()) if (age(s) < 30 * DAY) keep.add(s.id);

  // Snapshots from a newer generation than ours are never ours to delete.
  return snaps.filter((s) => s.generation <= currentGeneration && !keep.has(s.id)).map((s) => s.id);
}

export interface FolderSeen { id: string; snapshots: readonly Snap[] }
export type ConnectDecision =
  | { kind: 'create' }
  | { kind: 'use'; folderId: string }
  | { kind: 'offer_restore'; folderId: string; sameKey: boolean; newestSeq: number };

/**
 * Connect safety (audit B2): a folder that already holds snapshots is never written to until the user chooses
 * "Restore it" (default) or "Start a new backup folder" (the old one is renamed and left alone).
 */
export function connectDecision(folders: readonly FolderSeen[], myKeyId: string): ConnectDecision {
  const withData = folders.find((f) => f.snapshots.length > 0);
  if (withData) {
    const n = newest(withData.snapshots)!;
    return { kind: 'offer_restore', folderId: withData.id, sameKey: withData.snapshots.every((s) => s.keyId === myKeyId), newestSeq: n.seq };
  }
  const empty = folders[0];
  return empty ? { kind: 'use', folderId: empty.id } : { kind: 'create' };
}

export interface Lock { deviceId: string; generation: number }

/** Before and after each snapshot upload (A6/B5): stop if another device holds the lock or wrote newer. */
export function lockState(lock: Lock | null, myDeviceId: string, myGeneration: number, snaps: readonly Snap[]): 'ok' | 'lost' | 'missing' {
  if (!lock) return 'missing';
  if (lock.deviceId !== myDeviceId || lock.generation > myGeneration) return 'lost';
  if (snaps.some((s) => s.deviceId !== myDeviceId && s.generation >= myGeneration)) return 'lost';
  return 'ok';
}

export interface Totals { boxes: number; items: number; onHand: number; photos: number }

/** "Before big change" (A4, §6.2 rule 8): any total more than halved since the previous snapshot. */
export function isBigChange(prev: Totals, now: Totals): boolean {
  return (Object.keys(prev) as (keyof Totals)[]).some((k) => prev[k] > 0 && now[k] < prev[k] / 2);
}

/** "Use this device instead" (B5 rule 3): if Drive is newer, the default is to restore it here. */
export function takeoverDefault(mine: Pick<Snap, 'generation' | 'seq'>, driveNewest: Snap | undefined): 'restore_newer' | 'take_over' {
  return driveNewest && cmp(driveNewest, mine) > 0 ? 'restore_newer' : 'take_over';
}
