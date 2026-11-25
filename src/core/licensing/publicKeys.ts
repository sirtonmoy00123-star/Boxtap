// Public keys the app trusts. Filled by the owner with `npx tsx tools/keys.ts init` (API_CONTRACTS §2.1).
// Empty until then: no licence key or signed config verifies, and the built-in config is used.
import raw from './publicKeys.json';
import { hexToBytes } from '../util/encoding';
import type { TrustedKeys } from './licence';

const map = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hexToBytes(v)]));
export const TRUSTED_KEYS: TrustedKeys = { lic: map(raw.lic), cfg: map(raw.cfg) };
