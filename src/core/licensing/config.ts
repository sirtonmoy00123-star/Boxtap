// Signed config file. Contract: API_CONTRACTS.md §3.
import * as ed from '@noble/ed25519';
import { canonicalJson } from '../util/canonicalJson';
import { b64urlDecode, utf8 } from '../util/encoding';
import type { TrustedKeys } from './licence';

export interface Offer { months: number; price: string; pay: string }
export interface ConfigBody {
  seq: number;
  issued_at: string;
  min_app_version: string;
  free_limits: { home_boxes: number; home_photos_per_box: number; seller_items: number };
  plans: Record<'move_pass' | 'seller_pro', { photos_per_parent: number; offers: Offer[] }>;
  features: { catalogue_image: boolean; insurance_pdf: boolean; excel: boolean };
  revoked_keys: string[];
  messages: { en: string | null; bn: string | null };
}
export interface SignedConfig { body: ConfigBody; kid: string; sig: string }

function isBody(b: unknown): b is ConfigBody {
  if (!b || typeof b !== 'object') return false;
  const o = b as ConfigBody;
  return Number.isInteger(o.seq) && typeof o.issued_at === 'string'
    && !!o.free_limits && Number.isInteger(o.free_limits.home_boxes)
    && Number.isInteger(o.free_limits.home_photos_per_box) && Number.isInteger(o.free_limits.seller_items)
    && !!o.plans?.move_pass && !!o.plans?.seller_pro && !!o.features && Array.isArray(o.revoked_keys);
}

export async function verifyConfig(signed: unknown, keys: TrustedKeys): Promise<{ ok: true; config: SignedConfig } | { ok: false }> {
  const s = signed as Partial<SignedConfig> | null;
  if (!s || typeof s.kid !== 'string' || typeof s.sig !== 'string' || !isBody(s.body)) return { ok: false };
  const pub = keys.cfg[s.kid];
  if (!pub) return { ok: false };
  try {
    const ok = await ed.verifyAsync(b64urlDecode(s.sig), utf8(canonicalJson(s.body)), pub);
    return ok ? { ok: true, config: s as SignedConfig } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Only a strictly higher seq replaces the stored config (a restore never lowers it either). */
export const acceptConfig = (storedSeq: number, incomingSeq: number): boolean => incomingSeq > storedSeq;
