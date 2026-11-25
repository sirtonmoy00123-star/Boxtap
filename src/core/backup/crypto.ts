// Backup crypto and file format. Contract: API_CONTRACTS.md §6 and §6.1 (audit fixes A2, A3, B6, B7, B15).
//
// File:   magic (6 bytes) | u32 header length (big-endian) | header JSON (UTF-8) | encrypted chunks
// Chunk:  AES-256-GCM(backup_key, plaintext ≤ 1 MiB), AAD = magic+length+header bytes,
//         nonce = 7-byte file nonce ‖ 1-byte last-chunk flag ‖ u32 chunk counter.
// Every chunk except the last holds exactly CHUNK plaintext bytes, so a reader can split the stream, and a
// file cut at a chunk boundary is detected because no chunk carries the last flag.
import { argon2id } from 'hash-wasm';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { b64urlDecode, b64urlEncode, bytesToHex, fromUtf8, utf8 } from '../util/encoding';

export const CHUNK = 1024 * 1024;
const TAG = 16;
export type Magic = 'BTBAK2' | 'BTDB1' | 'BTPH1';
const MAGICS: readonly Magic[] = ['BTBAK2', 'BTDB1', 'BTPH1'];

export interface KdfParams { alg: 'argon2id'; m: number; t: number; p: number; salt: string }
export const DEFAULT_KDF: Omit<KdfParams, 'salt'> = { alg: 'argon2id', m: 65536, t: 3, p: 1 };
const MAX_M = 131072;
const MAX_T = 6;

/** What every file carries so it can be decrypted alone with the recovery code. */
export interface WrappedKey { kdf: KdfParams; nonce: string; ct: string }
export interface KeyMaterial { raw: Uint8Array<ArrayBuffer>; keyId: string; wrapped: WrappedKey }

export interface Header {
  created_at: string;
  app_version: string;
  schema_version: number;
  key_id: string;
  kdf: KdfParams;
  wrapped_key_by_recovery: { nonce: string; ct: string };
  nonce: string; // 7-byte file nonce
}

export class WrongCodeError extends Error { name = 'WrongCodeError'; constructor() { super('wrong recovery code'); } }
export class BadFileError extends Error { name = 'BadFileError'; }
export class FutureVersionError extends Error {
  name = 'FutureVersionError';
  constructor(public readonly schemaVersion: number) { super('this backup was made by a newer BoxTap; update BoxTap first'); }
}

const subtle = globalThis.crypto.subtle;
const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// Recovery code ----------------------------------------------------------------------------------------

export const newRecoveryCode = (): string => generateMnemonic(wordlist, 128);

export const normaliseRecoveryCode = (s: string): string =>
  s.normalize('NFKD').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

export const isValidRecoveryCode = (s: string): boolean => validateMnemonic(normaliseRecoveryCode(s), wordlist);

// Key wrapping -----------------------------------------------------------------------------------------

async function kek(code: string, kdf: KdfParams): Promise<CryptoKey> {
  if (kdf.alg !== 'argon2id' || kdf.m > MAX_M || kdf.t > MAX_T || kdf.p !== 1 || kdf.m < 8) throw new BadFileError('unsupported key parameters');
  const raw = await argon2id({
    password: normaliseRecoveryCode(code), salt: b64urlDecode(kdf.salt),
    iterations: kdf.t, parallelism: kdf.p, memorySize: kdf.m, hashLength: 32, outputType: 'binary',
  });
  return subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** At setup: a random backup key, wrapped once with Argon2id(recovery code). The code itself is never stored. */
export async function createKeyMaterial(code: string, kdf: Omit<KdfParams, 'salt'> & { salt?: string } = DEFAULT_KDF): Promise<KeyMaterial> {
  const raw = rand(32);
  const full: KdfParams = { alg: 'argon2id', m: kdf.m, t: kdf.t, p: kdf.p, salt: kdf.salt || b64urlEncode(rand(16)) };
  const nonce = rand(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: utf8('boxtap-key-wrap-v1') }, await kek(code, full), raw));
  return { raw, keyId: `bk_${bytesToHex(rand(8))}`, wrapped: { kdf: full, nonce: b64urlEncode(nonce), ct: b64urlEncode(ct) } };
}

export async function unwrapBackupKey(w: WrappedKey, code: string): Promise<Uint8Array<ArrayBuffer>> {
  const k = await kek(code, w.kdf);
  try {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(w.nonce), additionalData: utf8('boxtap-key-wrap-v1') }, k, b64urlDecode(w.ct)));
  } catch {
    throw new WrongCodeError();
  }
}

/** Non-extractable copy for daily use (kept in IndexedDB by the caller). */
export const importBackupKey = (raw: Uint8Array<ArrayBuffer>, extractable = false): Promise<CryptoKey> =>
  subtle.importKey('raw', raw, 'AES-GCM', extractable, ['encrypt', 'decrypt']);

// File format ------------------------------------------------------------------------------------------

function chunkNonce(fileNonce: Uint8Array, index: number, last: boolean): Uint8Array<ArrayBuffer> {
  const n = new Uint8Array(12);
  n.set(fileNonce, 0);
  n[7] = last ? 1 : 0;
  new DataView(n.buffer).setUint32(8, index);
  return n;
}

/** Re-chunks a byte stream into exact CHUNK pieces, telling which piece is the last. */
async function* rechunk(src: AsyncIterable<Uint8Array>): AsyncGenerator<{ data: Uint8Array<ArrayBuffer>; last: boolean }> {
  let buf = new Uint8Array(CHUNK);
  let fill = 0;
  let pending: Uint8Array<ArrayBuffer> | null = null;
  for await (const part of src) {
    let off = 0;
    while (off < part.length) {
      const n = Math.min(CHUNK - fill, part.length - off);
      buf.set(part.subarray(off, off + n), fill);
      fill += n;
      off += n;
      if (fill === CHUNK) {
        if (pending) yield { data: pending, last: false };
        pending = buf;
        buf = new Uint8Array(CHUNK);
        fill = 0;
      }
    }
  }
  if (fill > 0) {
    if (pending) yield { data: pending, last: false };
    yield { data: buf.slice(0, fill), last: true };
  } else {
    yield { data: pending ?? new Uint8Array(0), last: true };
  }
}

/**
 * Encrypts a plaintext stream with the backup key (from key material, or an existing CryptoKey plus the
 * stored wrapped blob and key id).
 */
export async function* encryptFile(
  magic: Magic,
  meta: { app_version: string; schema_version: number },
  key: KeyMaterial | { cryptoKey: CryptoKey; keyId: string; wrapped: WrappedKey },
  plain: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const cryptoKey = 'cryptoKey' in key ? key.cryptoKey : await importBackupKey(key.raw);
  const fileNonce = rand(7);
  const header: Header = {
    created_at: new Date().toISOString(), app_version: meta.app_version, schema_version: meta.schema_version,
    key_id: key.keyId, kdf: key.wrapped.kdf, wrapped_key_by_recovery: { nonce: key.wrapped.nonce, ct: key.wrapped.ct },
    nonce: b64urlEncode(fileNonce),
  };
  const hjson = utf8(JSON.stringify(header));
  const prefix = new Uint8Array(6 + 4 + hjson.length);
  prefix.set(utf8(magic.padEnd(6, '\0')), 0);
  new DataView(prefix.buffer).setUint32(6, hjson.length);
  prefix.set(hjson, 10);
  yield prefix;
  let i = 0;
  for await (const c of rechunk(plain)) {
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv: chunkNonce(fileNonce, i++, c.last), additionalData: prefix }, cryptoKey, c.data);
    yield new Uint8Array(ct);
  }
}

export interface ParsedHeader { magic: Magic; header: Header; aad: Uint8Array<ArrayBuffer>; payloadOffset: number }

export function readHeader(file: Uint8Array): ParsedHeader {
  if (file.length < 10) throw new BadFileError('not a BoxTap backup');
  const magic = new TextDecoder().decode(file.subarray(0, 6)).replace(/\0+$/, '') as Magic;
  if (!MAGICS.includes(magic)) throw new BadFileError('not a BoxTap backup');
  const len = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(6);
  if (len > 64 * 1024 || 10 + len > file.length) throw new BadFileError('damaged backup header');
  let header: Header;
  try {
    header = JSON.parse(fromUtf8(file.subarray(10, 10 + len)));
  } catch {
    throw new BadFileError('damaged backup header');
  }
  if (!header || typeof header.key_id !== 'string' || !Number.isInteger(header.schema_version) || !header.kdf) throw new BadFileError('damaged backup header');
  return { magic, header, aad: file.slice(0, 10 + len), payloadOffset: 10 + len };
}

/** Decrypts a whole file held in memory, yielding plaintext chunks. Throws before yielding on a wrong code. */
export async function* decryptFile(file: Uint8Array, code: string | { cryptoKey: CryptoKey; keyId: string }, opts: { maxSchema: number }): AsyncGenerator<Uint8Array> {
  const { header, aad, payloadOffset } = readHeader(file);
  if (header.schema_version > opts.maxSchema) throw new FutureVersionError(header.schema_version);
  let cryptoKey: CryptoKey;
  if (typeof code === 'string') {
    const raw = await unwrapBackupKey({ kdf: header.kdf, ...header.wrapped_key_by_recovery }, code);
    cryptoKey = await importBackupKey(raw);
  } else {
    if (code.keyId !== header.key_id) throw new WrongCodeError();
    cryptoKey = code.cryptoKey;
  }
  const fileNonce = b64urlDecode(header.nonce);
  let off = payloadOffset;
  let i = 0;
  for (;;) {
    const remaining = file.length - off;
    const isLast = remaining <= CHUNK + TAG;
    if (remaining < TAG) throw new BadFileError('backup file is cut short');
    const ct = file.subarray(off, off + Math.min(remaining, CHUNK + TAG)) as Uint8Array<ArrayBuffer>; // never shared memory here
    let pt: ArrayBuffer;
    try {
      pt = await subtle.decrypt({ name: 'AES-GCM', iv: chunkNonce(fileNonce, i, isLast), additionalData: aad }, cryptoKey, ct);
    } catch {
      throw new BadFileError(isLast ? 'backup file is damaged or cut short' : 'backup file is damaged');
    }
    yield new Uint8Array(pt);
    off += ct.length;
    i++;
    if (isLast) return;
  }
}
