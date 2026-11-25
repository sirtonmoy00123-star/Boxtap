import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKeyFile, openKeyFile, issueLicence, signConfig, revoke, trustedKeysFrom } from './lib';
import { verifyLicence } from '../src/core/licensing/licence';
import { verifyConfig } from '../src/core/licensing/config';
import { DEFAULT_CONFIG } from '../src/core/licensing/can';

const PASS = 'correct horse battery staple';

describe('owner tools', () => {
  const dir = mkdtempSync(join(tmpdir(), 'boxtap-owner-'));
  const keyFile = join(dir, 'owner.keys.enc');

  it('creates an encrypted key file that opens only with the passphrase', async () => {
    const pub = await createKeyFile(keyFile, PASS, 2026);
    expect(Object.keys(pub)).toEqual(['cfg-2026', 'lic-2026']);
    expect(readFileSync(keyFile, 'utf8')).not.toContain(pub['lic-2026']);
    await expect(openKeyFile(keyFile, 'wrong')).rejects.toThrow(/passphrase/);
    const keys = await openKeyFile(keyFile, PASS);
    expect(keys.lic.kid).toBe('lic-2026');
  });

  it('refuses to overwrite an existing key file', async () => {
    await expect(createKeyFile(keyFile, PASS, 2026)).rejects.toThrow(/exists/);
  });

  it('issues a licence the app accepts and logs it to licences.csv', async () => {
    const keys = await openKeyFile(keyFile, PASS);
    const csv = join(dir, 'licences.csv');
    const key = await issueLicence(keys, {
      plan: 'move_pass', months: 12, licensee: 'Mia T. · mia@example.com', ref: 'stripe:pi_1',
      startsAt: '2026-12-01', amount: '12.95', currency: 'AUD', note: null, csvPath: csv,
    });
    const r = await verifyLicence(key.text, trustedKeysFrom(keys), []);
    expect(r.ok && r.payload.ends_at).toBe('2027-12-01');
    const log = readFileSync(csv, 'utf8');
    expect(log.split('\n')[0]).toBe('issued_at,key_id,plan,months,starts_at,ends_at,licensee,ref,amount,currency,note');
    expect(log).toContain(key.id);
  });

  it('signs a config the app accepts, bumping seq each time', async () => {
    const keys = await openKeyFile(keyFile, PASS);
    const src = join(dir, 'config.json');
    const out = join(dir, 'public', 'config', 'v1.json');
    const first = await signConfig(keys, src, out, { ...DEFAULT_CONFIG, seq: 3 });
    const second = await signConfig(keys, src, out);
    expect(second.body.seq).toBe(first.body.seq + 1);
    expect(existsSync(out)).toBe(true);
    const v = await verifyConfig(JSON.parse(readFileSync(out, 'utf8')), trustedKeysFrom(keys));
    expect(v.ok).toBe(true);
  });

  it('revoke adds the key id once to config.json', () => {
    const src = join(dir, 'config.json');
    revoke(src, 'lk_abc');
    revoke(src, 'lk_abc');
    expect(JSON.parse(readFileSync(src, 'utf8')).revoked_keys).toEqual(['lk_abc']);
  });
});
