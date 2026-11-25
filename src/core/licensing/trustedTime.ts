// Clock-rollback protection. Contract: API_CONTRACTS.md §4 (with audit fixes A1 and B11).

const BEHIND_LIMIT_MS = 48 * 3600 * 1000;

export interface Trusted {
  now: Date;
  /** Device clock is more than 48 h behind the high-water mark: paid plans count as ended. */
  clockBehind: boolean;
  /** New high-water mark to store in time_guard.max_seen_at. */
  maxSeenAt: string;
}

export function trustedNow(device: Date, maxSeenAt: string | null): Trusted {
  const mark = maxSeenAt ? new Date(maxSeenAt).getTime() : 0;
  const dev = device.getTime();
  const now = new Date(Math.max(dev, mark));
  return { now, clockBehind: mark - dev > BEHIND_LIMIT_MS, maxSeenAt: now.toISOString() };
}

/**
 * After a successful network-only, no-store config fetch: the response Date header becomes the new mark,
 * even if lower than the stored one, but never below the signed config's issued_at. Returns null if the
 * header is missing or unreadable (keep the stored mark).
 */
export function afterNetworkTime(dateHeader: string | null, configIssuedAt: string): string | null {
  if (!dateHeader) return null;
  const t = Date.parse(dateHeader);
  if (Number.isNaN(t)) return null;
  const floor = Date.parse(configIssuedAt);
  return new Date(Number.isNaN(floor) ? t : Math.max(t, floor)).toISOString();
}
