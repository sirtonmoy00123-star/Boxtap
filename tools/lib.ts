// Owner tools library (runs on the owner's computer only). Contract: API_CONTRACTS.md §2.1.
// Private keys live in an encrypted file outside the repository (default: ./owner-private, git-ignored).
import * as ed from '@noble/ed25519';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { webcrypto } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { uuidv7 } from 'uuidv7';
import { b64urlDecode, b64urlEncode, bytesToHex, hexToBytes, utf8 } from '../src/core/util/encoding';
import { canonicalJson } from '../src/core/util/canonicalJson';
import { addMonths } from '../src/core/licensing/plans';
import type { LicencePayload, Plan, TrustedKeys } from '../src/core/licensing/licence';
import type { ConfigBody, SignedConfig } from '../src/core/licensing/config';
import { DEFAULT_CONFIG } from '../src/core/licensing/can';

const subtle = webcrypto.subtle;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, dkLen: 32 };

interface KeyPair { kid: string; secretHex: string; publicHex: string }
export interface OwnerKeys { cfg: KeyPair; lic: KeyPair }

async function aesKey(pass: string, salt: Uint8Array) {
  const raw = await scryptAsync(utf8(pass), salt, SCRYPT);
  return subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function pair(kid: string): Promise<KeyPair> {
  const sk = ed.utils.randomSecretKey();
  return { kid, secretHex: bytesToHex(sk), publicHex: bytesToHex(await ed.getPublicKeyAsync(sk)) };
}

/** Creates the two Ed25519 key pairs in an encrypted file. Returns the public keys (hex) by kid. */
export async function createKeyFile(path: string, passphrase: string, year: number): Promise<Record<string, string>> {
  if (existsSync(path)) throw new Error(`${path} already exists; refusing to overwrite owner keys`);
  if (passphrase.length < 12) throw new Error('passphrase must be at least 12 characters');
  const keys: OwnerKeys = { cfg: await pair(`cfg-${year}`), lic: await pair(`lic-${year}`) };
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(passphrase, salt), utf8(JSON.stringify(keys))));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ v: 1, kdf: 'scrypt', ...SCRYPT, salt: b64urlEncode(salt), iv: b64urlEncode(iv), ct: b64urlEncode(ct) }), { mode: 0o600 });
  return { [keys.cfg.kid]: keys.cfg.publicHex, [keys.lic.kid]: keys.lic.publicHex };
}

export async function openKeyFile(path: string, passphrase: string): Promise<OwnerKeys> {
  const f = JSON.parse(readFileSync(path, 'utf8'));
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(f.iv) }, await aesKey(passphrase, b64urlDecode(f.salt)), b64urlDecode(f.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    throw new Error('wrong passphrase or damaged key file');
  }
}

export const trustedKeysFrom = (k: OwnerKeys): TrustedKeys => ({
  lic: { [k.lic.kid]: hexToBytes(k.lic.publicHex) },
  cfg: { [k.cfg.kid]: hexToBytes(k.cfg.publicHex) },
});

export interface IssueInput {
  plan: Plan; months: number; licensee: string; ref: string; startsAt: string;
  amount: string; currency: string; note: string | null; csvPath: string;
}

// Cells starting with = + - @ tab or CR run as spreadsheet formulas (review finding 10): prefix them with '.
const csvCell = (raw: string) => {
  const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const CSV_HEADER = 'issued_at,key_id,plan,months,starts_at,ends_at,licensee,ref,amount,currency,note';

export async function issueLicence(keys: OwnerKeys, i: IssueInput): Promise<{ id: string; text: string; payload: LicencePayload }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.startsAt)) throw new Error('startsAt must be YYYY-MM-DD');
  if (!Number.isInteger(i.months) || i.months < 1 || i.months > 120) throw new Error('months must be 1-120');
  const payload: LicencePayload = {
    v: 1, kid: keys.lic.kid, id: `lk_${uuidv7()}`, plan: i.plan, months: i.months,
    starts_at: i.startsAt, ends_at: addMonths(i.startsAt, i.months),
    licensee: i.licensee, ref: i.ref, note: i.note,
  };
  const p = b64urlEncode(utf8(JSON.stringify(payload)));
  const sig = await ed.signAsync(utf8(p), hexToBytes(keys.lic.secretHex));
  const text = `BTK1.${p}.${b64urlEncode(sig)}`;
  if (!existsSync(i.csvPath)) {
    mkdirSync(dirname(i.csvPath), { recursive: true });
    writeFileSync(i.csvPath, `${CSV_HEADER}\n`);
  }
  appendFileSync(i.csvPath, [new Date().toISOString(), payload.id, payload.plan, String(payload.months), payload.starts_at,
    payload.ends_at, payload.licensee, payload.ref, i.amount, i.currency, i.note ?? ''].map(csvCell).join(',') + '\n');
  return { id: payload.id, text, payload };
}

function readBody(src: string): ConfigBody {
  return existsSync(src) ? JSON.parse(readFileSync(src, 'utf8')) : structuredClone(DEFAULT_CONFIG);
}

/** Bumps seq, sets issued_at, signs canonical JSON of the body, writes src (unsigned) and out (signed). */
export async function signConfig(keys: OwnerKeys, src: string, out: string, initial?: ConfigBody): Promise<SignedConfig> {
  if (!initial && !existsSync(src)) {
    // Review finding 11: signing from defaults would restart seq at 1, and every installed app would ignore it.
    throw new Error(`${src} (config.json) not found. Restore config.json from your backup before signing.`);
  }
  const body: ConfigBody = initial ? structuredClone(initial) : readBody(src);
  body.seq += 1;
  body.issued_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const sig = b64urlEncode(await ed.signAsync(utf8(canonicalJson(body)), hexToBytes(keys.cfg.secretHex)));
  const signed: SignedConfig = { body, kid: keys.cfg.kid, sig };
  mkdirSync(dirname(src), { recursive: true });
  writeFileSync(src, JSON.stringify(body, null, 2) + '\n');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(signed, null, 2) + '\n');
  return signed;
}

export function revoke(src: string, keyId: string): void {
  if (!/^lk_[0-9a-f-]+$/i.test(keyId)) throw new Error('key id must look like lk_…');
  if (!existsSync(src)) throw new Error(`${src} (config.json) not found. Restore config.json from your backup first.`);
  const body = readBody(src);
  if (!body.revoked_keys.includes(keyId)) body.revoked_keys.push(keyId);
  mkdirSync(dirname(src), { recursive: true });
  writeFileSync(src, JSON.stringify(body, null, 2) + '\n');
}
