import { describe, it, expect } from 'vitest';
import {
  newRecoveryCode, normaliseRecoveryCode, isValidRecoveryCode, createKeyMaterial, unwrapBackupKey,
  encryptFile, decryptFile, readHeader, WrongCodeError, FutureVersionError, BadFileError, CHUNK, rewrapBackupKey,
  type KdfParams,
} from './crypto';

// Fast KDF for tests only; production uses m=65536, t=3 (API_CONTRACTS §6).
const FAST: KdfParams = { alg: 'argon2id', m: 1024, t: 1, p: 1, salt: '' };

async function* chunks(...parts: Uint8Array[]) { for (const p of parts) yield p; }
async function collect(it: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const out: Uint8Array[] = [];
  for await (const c of it) out.push(c);
  const all = new Uint8Array(out.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of out) { all.set(c, o); o += c.length; }
  return all;
}
const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

describe('recovery code', () => {
  it('is 12 valid BIP39 English words', () => {
    const code = newRecoveryCode();
    expect(code.split(' ')).toHaveLength(12);
    expect(isValidRecoveryCode(code)).toBe(true);
  });
  it('normalises case, spacing and punctuation', () => {
    const code = newRecoveryCode();
    expect(normaliseRecoveryCode(`  ${code.toUpperCase().replace(/ /g, ',  ')}\n`)).toBe(code);
  });
  it('rejects a code whose checksum does not match (typo)', () => {
    // Known BIP39 vectors: 11 x abandon + about is valid; 12 x abandon fails the checksum.
    expect(isValidRecoveryCode(Array(11).fill('abandon').join(' ') + ' about')).toBe(true);
    expect(isValidRecoveryCode(Array(12).fill('abandon').join(' '))).toBe(false);
    expect(isValidRecoveryCode('abandon abandon')).toBe(false);
  });
});

describe('backup key wrapping (audit A2)', () => {
  it('unwraps with the right code and refuses a wrong one', async () => {
    const code = newRecoveryCode();
    const km = await createKeyMaterial(code, FAST);
    expect(km.keyId).toMatch(/^bk_[0-9a-f]{16}$/);
    const raw = await unwrapBackupKey(km.wrapped, code);
    expect(raw).toEqual(km.raw);
    await expect(unwrapBackupKey(km.wrapped, newRecoveryCode())).rejects.toBeInstanceOf(WrongCodeError);
  });
});

describe('.btbak file format', () => {
  const meta = { app_version: '0.1.0', schema_version: 1 };

  it('round-trips data larger than one chunk', async () => {
    const code = newRecoveryCode();
    const km = await createKeyMaterial(code, FAST);
    const plain = bytes(CHUNK * 2 + 12345);
    const file = await collect(encryptFile('BTBAK2', meta, km, chunks(plain.subarray(0, 700000), plain.subarray(700000))));
    const back = await collect(decryptFile(file, code, { maxSchema: 1 }));
    expect(back).toEqual(plain);
  });

  it('round-trips an empty payload', async () => {
    const code = newRecoveryCode();
    const km = await createKeyMaterial(code, FAST);
    const file = await collect(encryptFile('BTBAK2', meta, km, chunks()));
    expect(await collect(decryptFile(file, code, { maxSchema: 1 }))).toEqual(new Uint8Array(0));
  });

  it('a wrong recovery code fails cleanly (critical test 10)', async () => {
    const km = await createKeyMaterial(newRecoveryCode(), FAST);
    const file = await collect(encryptFile('BTBAK2', meta, km, chunks(bytes(100))));
    await expect(collect(decryptFile(file, newRecoveryCode(), { maxSchema: 1 }))).rejects.toBeInstanceOf(WrongCodeError);
  });

  it('detects a changed header byte (header is AAD) and a flipped payload bit', async () => {
    const code = newRecoveryCode();
    const km = await createKeyMaterial(code, FAST);
    const file = await collect(encryptFile('BTBAK2', meta, km, chunks(bytes(5000))));
    const h = readHeader(file);
    const tampered = file.slice();
    // change app_version inside the header JSON
    const at = new TextDecoder().decode(file).indexOf('0.1.0');
    tampered[at + 4] = '9'.charCodeAt(0);
    await expect(collect(decryptFile(tampered, code, { maxSchema: 1 }))).rejects.toBeInstanceOf(BadFileError);
    const flipped = file.slice();
    flipped[h.payloadOffset + 10]! ^= 1;
    await expect(collect(decryptFile(flipped, code, { maxSchema: 1 }))).rejects.toBeInstanceOf(BadFileError);
  });

  it('detects a truncated file (last-chunk flag)', async () => {
    const code = newRecoveryCode();
    const km = await createKeyMaterial(code, FAST);
    const file = await collect(encryptFile('BTBAK2', meta, km, chunks(bytes(CHUNK + 10))));
    const cut = file.subarray(0, readHeader(file).payloadOffset + CHUNK + 16);
    await expect(collect(decryptFile(cut, code, { maxSchema: 1 }))).rejects.toBeInstanceOf(BadFileError);
  });

  it('refuses a newer schema version ("Update BoxTap first", audit B6)', async () => {
    const code = newRecoveryCode();
    const km = await createKeyMaterial(code, FAST);
    const file = await collect(encryptFile('BTBAK2', { ...meta, schema_version: 9 }, km, chunks(bytes(10))));
    await expect(collect(decryptFile(file, code, { maxSchema: 1 }))).rejects.toBeInstanceOf(FutureVersionError);
  });

  it('refuses crafted KDF parameters that could exhaust memory (audit B15)', async () => {
    const code = newRecoveryCode();
    const km = await createKeyMaterial(code, FAST);
    km.wrapped.kdf = { ...km.wrapped.kdf, m: 1 << 22 };
    const file = await collect(encryptFile('BTBAK2', meta, km, chunks(bytes(10))));
    await expect(collect(decryptFile(file, code, { maxSchema: 1 }))).rejects.toBeInstanceOf(BadFileError);
  });

  it('rejects a file with the wrong magic', async () => {
    await expect(collect(decryptFile(new TextEncoder().encode('PK\u0003\u0004 not a backup'), 'x', { maxSchema: 1 }))).rejects.toBeInstanceOf(BadFileError);
  });

  it('the file contains no plaintext from the payload', async () => {
    const km = await createKeyMaterial(newRecoveryCode(), FAST);
    const secret = new TextEncoder().encode('Grandma gold necklace');
    const file = await collect(encryptFile('BTBAK2', meta, km, chunks(secret)));
    expect(new TextDecoder().decode(file)).not.toContain('Grandma');
  });
});

describe('changing the recovery code (audit B7)', () => {
  it('re-wraps the same key: new files open with the new code, the key id stays', async () => {
    const oldCode = newRecoveryCode();
    const km = await createKeyMaterial(oldCode, FAST);
    const newCode = newRecoveryCode();
    const wrapped = await rewrapBackupKey(km.wrapped, oldCode, newCode);
    expect(await unwrapBackupKey(wrapped, newCode)).toEqual(km.raw);
    await expect(unwrapBackupKey(wrapped, oldCode)).rejects.toBeInstanceOf(WrongCodeError);
  });
  it('refuses when the old code is wrong', async () => {
    const km = await createKeyMaterial(newRecoveryCode(), FAST);
    await expect(rewrapBackupKey(km.wrapped, newRecoveryCode(), newRecoveryCode())).rejects.toBeInstanceOf(WrongCodeError);
  });
});
