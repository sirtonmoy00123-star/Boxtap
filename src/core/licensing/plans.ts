// Key stacking and active plans. Contract: API_CONTRACTS.md §1 rules 2, 3 and 7.
import { PLANS, type Plan } from './licence';

export interface KeyWindow {
  id: string;
  plan: Plan;
  months: number;
  starts_at: string; // YYYY-MM-DD
  ends_at: string;
}

export interface Window { start: string; end: string }

/** Adds calendar months to a YYYY-MM-DD date (day clamped to month end). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Coverage windows for keys of ONE plan. The first key runs to its own ends_at; each later key adds its
 * length from max(current end, its starts_at). A key that starts after the current end opens a new window.
 */
export function coverage(keys: readonly KeyWindow[]): Window[] {
  const sorted = [...keys].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
  const out: Window[] = [];
  for (const k of sorted) {
    const cur = out[out.length - 1];
    if (!cur) {
      out.push({ start: k.starts_at, end: k.ends_at });
    } else if (k.starts_at > cur.end) {
      out.push({ start: k.starts_at, end: addMonths(k.starts_at, k.months) });
    } else {
      cur.end = addMonths(cur.end > k.starts_at ? cur.end : k.starts_at, k.months);
    }
  }
  return out;
}

const day = (now: Date) => now.toISOString().slice(0, 10);

/** Window that contains `now`, if any (start ≤ now < end, by UTC date). */
export function currentWindow(keys: readonly KeyWindow[], now: Date): Window | undefined {
  const today = day(now);
  return coverage(keys).find((w) => w.start <= today && today < w.end);
}

/** Plans active now. Callers pass only keys that verified and are not revoked. */
export function activePlans(keys: readonly KeyWindow[], now: Date): Set<Plan> {
  const out = new Set<Plan>();
  for (const plan of PLANS) {
    if (currentWindow(keys.filter((k) => k.plan === plan), now)) out.add(plan);
  }
  return out;
}
