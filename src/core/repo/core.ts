import { uuidv7 } from 'uuidv7';
import type { SqlDb } from '../db/migrate';

/** Everything a repository needs. `now` is injectable so tests control time. */
export interface Ctx {
  db: SqlDb;
  now: () => string;
}

export const newId = (): string => uuidv7();

/** NFC-normalise text before it is stored or searched (DATABASE_SCHEMA §2), and trim it. */
export const clean = (s: string | null | undefined): string | null => {
  if (s == null) return null;
  const t = s.normalize('NFC').trim();
  return t === '' ? null : t;
};

export function requireText(s: string | null | undefined, field: string, max: number): string {
  const t = clean(s);
  if (!t || t.length > max) throw new RangeError(`${field} must be 1-${max} characters`);
  return t;
}

export function optionalText(s: string | null | undefined, field: string, max: number): string | null {
  const t = clean(s);
  if (t && t.length > max) throw new RangeError(`${field} must be at most ${max} characters`);
  return t;
}

export function bump(db: SqlDb): void {
  db.exec(`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'change_seq'`);
}

/** Runs fn atomically (nestable savepoint) and bumps change_seq once. */
export function write<T>(ctx: Ctx, fn: () => T): T {
  return ctx.db.savepoint(() => {
    const r = fn();
    bump(ctx.db);
    return r;
  });
}

export const bool = (v: unknown): boolean => v === 1 || v === true;
export const str = (v: unknown): string | null => (v == null ? null : String(v));
export const num = (v: unknown): number => Number(v);

export function changeSeq(ctx: Ctx): number {
  return Number(ctx.db.selectValue(`SELECT value FROM meta WHERE key='change_seq'`));
}

export const daysBefore = (iso: string, days: number): string =>
  new Date(new Date(iso).getTime() - days * 86400000).toISOString();
