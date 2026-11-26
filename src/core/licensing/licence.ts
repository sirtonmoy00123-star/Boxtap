// Licence key format and verification. Contract: API_CONTRACTS.md §2.
import * as ed from '@noble/ed25519';
import { b64urlDecode, fromUtf8, utf8 } from '../util/encoding';

export type Plan = 'move_pass' | 'seller_pro' | 'removalist_pro';
export const PLANS: readonly Plan[] = ['move_pass', 'seller_pro', 'removalist_pro'];

export interface LicencePayload {
  v: 1;
  kid: string;
  id: string;
  plan: Plan;
  months: number;
  starts_at: string; // YYYY-MM-DD
  ends_at: string;   // YYYY-MM-DD
  licensee: string;
  ref: string;
  note: string | null;
}

/** Public keys the app trusts, by key id. `lic` signs licence keys, `cfg` signs the config file. */
export interface TrustedKeys {
  lic: Record<string, Uint8Array>;
  cfg: Record<string, Uint8Array>;
}

export type LicenceResult =
  | { ok: true; payload: LicencePayload; raw: string }
  | { ok: false; reason: 'malformed' | 'unknown_kid' | 'bad_signature' | 'revoked' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPayload(p: unknown): p is LicencePayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return o.v === 1 && typeof o.kid === 'string' && typeof o.id === 'string'
    && PLANS.includes(o.plan as Plan)
    && Number.isInteger(o.months) && (o.months as number) > 0 && (o.months as number) <= 120
    && typeof o.starts_at === 'string' && DATE.test(o.starts_at)
    && typeof o.ends_at === 'string' && DATE.test(o.ends_at) && o.ends_at > o.starts_at
    && typeof o.licensee === 'string' && typeof o.ref === 'string'
    && (o.note === null || typeof o.note === 'string');
}

/** Verifies a `BTK1.<payload>.<sig>` key. Expiry is not checked here (an expired key is kept, see plans.ts). */
export async function verifyLicence(text: string, keys: TrustedKeys, revoked: readonly string[]): Promise<LicenceResult> {
  const raw = text.trim();
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'BTK1') return { ok: false, reason: 'malformed' };
  const [, p, s] = parts as [string, string, string];
  let payload: unknown;
  let sig: Uint8Array;
  try {
    payload = JSON.parse(fromUtf8(b64urlDecode(p)));
    sig = b64urlDecode(s);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isPayload(payload) || sig.length !== 64) return { ok: false, reason: 'malformed' };
  const pub = keys.lic[payload.kid];
  if (!pub) return { ok: false, reason: 'unknown_kid' };
  let valid: boolean;
  try {
    valid = await ed.verifyAsync(sig, utf8(p), pub);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  if (revoked.includes(payload.id)) return { ok: false, reason: 'revoked' };
  return { ok: true, payload, raw };
}
