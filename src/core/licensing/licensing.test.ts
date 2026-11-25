import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { b64urlEncode, utf8 } from '../util/encoding';
import { canonicalJson } from '../util/canonicalJson';
import { verifyLicence, type LicencePayload, type TrustedKeys } from './licence';
import { coverage, activePlans } from './plans';
import { trustedNow, afterNetworkTime } from './trustedTime';
import { verifyConfig, acceptConfig } from './config';
import { can, DEFAULT_CONFIG, type CanContext } from './can';

const sk = ed.utils.randomSecretKey();
const pk = await ed.getPublicKeyAsync(sk);
const trusted: TrustedKeys = { lic: { 'lic-test': pk }, cfg: { 'cfg-test': pk } };

async function makeKey(over: Partial<LicencePayload> = {}, secret = sk): Promise<string> {
  const payload: LicencePayload = {
    v: 1, kid: 'lic-test', id: 'lk_1', plan: 'move_pass', months: 12,
    starts_at: '2026-12-01', ends_at: '2027-12-01', licensee: 'Mia T.', ref: 'stripe:pi_1', note: null, ...over,
  };
  const p = b64urlEncode(utf8(JSON.stringify(payload)));
  const sig = await ed.signAsync(utf8(p), secret);
  return `BTK1.${p}.${b64urlEncode(sig)}`;
}

describe('licence keys', () => {
  it('accepts a correctly signed key', async () => {
    const r = await verifyLicence(await makeKey(), trusted, []);
    expect(r.ok && r.payload.licensee).toBe('Mia T.');
  });
  it('rejects a forged signature', async () => {
    const r = await verifyLicence(await makeKey({}, ed.utils.randomSecretKey()), trusted, []);
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects a tampered payload', async () => {
    const k = await makeKey();
    const sig = k.split('.')[2];
    const evil = b64urlEncode(utf8(JSON.stringify({ v: 1, kid: 'lic-test', id: 'lk_1', plan: 'seller_pro', months: 120, starts_at: '2026-01-01', ends_at: '2036-01-01', licensee: 'x', ref: '', note: null })));
    expect(await verifyLicence(`BTK1.${evil}.${sig}`, trusted, [])).toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects an unknown kid', async () => {
    expect(await verifyLicence(await makeKey({ kid: 'lic-1999' }), trusted, [])).toEqual({ ok: false, reason: 'unknown_kid' });
  });
  it('rejects a revoked key id', async () => {
    expect(await verifyLicence(await makeKey(), trusted, ['lk_1'])).toEqual({ ok: false, reason: 'revoked' });
  });
  it('rejects malformed text and tolerates surrounding whitespace', async () => {
    expect(await verifyLicence('hello', trusted, [])).toEqual({ ok: false, reason: 'malformed' });
    expect((await verifyLicence(`  ${await makeKey()}\n`, trusted, [])).ok).toBe(true);
  });
});

describe('stacking (API_CONTRACTS §1.7, critical test 15)', () => {
  const k = (id: string, starts_at: string, ends_at: string, months = 12) =>
    ({ id, plan: 'move_pass' as const, starts_at, ends_at, months });
  it('two 12-month keys: end = first end + 12 months', () => {
    const c = coverage([k('a', '2026-12-01', '2027-12-01'), k('b', '2026-12-05', '2027-12-05')]);
    expect(c).toEqual([{ start: '2026-12-01', end: '2028-12-01' }]);
  });
  it('a key starting after a gap opens a new window', () => {
    const c = coverage([k('a', '2026-01-01', '2026-02-01', 1), k('b', '2026-06-01', '2026-07-01', 1)]);
    expect(c).toEqual([{ start: '2026-01-01', end: '2026-02-01' }, { start: '2026-06-01', end: '2026-07-01' }]);
  });
  it('activePlans uses the window containing now', () => {
    const keys = [k('a', '2026-12-01', '2027-12-01'), k('b', '2026-12-05', '2027-12-05')];
    expect(activePlans(keys, new Date('2028-06-01T00:00:00Z')).has('move_pass')).toBe(true);
    expect(activePlans(keys, new Date('2028-12-02T00:00:00Z')).has('move_pass')).toBe(false);
    expect(activePlans(keys, new Date('2026-11-30T00:00:00Z')).has('move_pass')).toBe(false);
  });
});

describe('trustedNow (API_CONTRACTS §4)', () => {
  it('never goes below the high-water mark', () => {
    const t = trustedNow(new Date('2026-01-01T00:00:00Z'), '2026-01-01T10:00:00Z');
    expect(t.now.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(t.clockBehind).toBe(false);
  });
  it('flags a clock more than 48 h behind (critical test 16)', () => {
    expect(trustedNow(new Date('2025-11-25T00:00:00Z'), '2026-11-25T00:00:00Z').clockBehind).toBe(true);
  });
  it('a fresh network time may lower the mark, but not below config issued_at (A1)', () => {
    expect(afterNetworkTime('Wed, 25 Nov 2026 00:00:00 GMT', '2026-11-01T00:00:00Z')).toBe('2026-11-25T00:00:00.000Z');
    expect(afterNetworkTime('Wed, 25 Nov 2026 00:00:00 GMT', '2026-12-01T00:00:00Z')).toBe('2026-12-01T00:00:00.000Z');
    expect(afterNetworkTime('not a date', '2026-12-01T00:00:00Z')).toBeNull();
  });
});

describe('signed config', () => {
  const body = { ...DEFAULT_CONFIG, seq: 7 };
  const sign = async (b: object) =>
    ({ body: b, kid: 'cfg-test', sig: b64urlEncode(await ed.signAsync(utf8(canonicalJson(b)), sk)) });
  it('verifies a signed config', async () => {
    expect((await verifyConfig(await sign(body), trusted)).ok).toBe(true);
  });
  it('rejects a config whose body was edited', async () => {
    const s = await sign(body);
    const edited = { ...s, body: { ...body, free_limits: { ...body.free_limits, home_boxes: 999 } } };
    expect((await verifyConfig(edited, trusted)).ok).toBe(false);
  });
  it('ignores an older or equal seq (critical test 17)', () => {
    expect(acceptConfig(7, 6)).toBe(false);
    expect(acceptConfig(7, 7)).toBe(false);
    expect(acceptConfig(7, 8)).toBe(true);
  });
  it('canonical JSON sorts keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});

describe('can()', () => {
  const none = new Set<'move_pass' | 'seller_pro'>();
  const ctx = (over: Partial<CanContext>): CanContext => ({
    config: DEFAULT_CONFIG, plans: none, workspaceType: 'home',
    counts: { boxes: 0, items: 0, photosOnParent: 0 }, ...over,
  });
  it('blocks box 13 on Home Free (critical test 12)', () => {
    expect(can('add_box', ctx({ counts: { boxes: 11, items: 0, photosOnParent: 0 } }))).toEqual({ allowed: true });
    expect(can('add_box', ctx({ counts: { boxes: 12, items: 0, photosOnParent: 0 } }))).toEqual({ allowed: false, reason: 'limit_boxes' });
  });
  it('Move Pass lifts the box limit and allows 5 photos per box', () => {
    const plans = new Set(['move_pass'] as const);
    expect(can('add_box', ctx({ plans, counts: { boxes: 500, items: 0, photosOnParent: 0 } })).allowed).toBe(true);
    expect(can('add_photo', ctx({ plans, counts: { boxes: 1, items: 0, photosOnParent: 4 } })).allowed).toBe(true);
    expect(can('add_photo', ctx({ plans, counts: { boxes: 1, items: 0, photosOnParent: 5 } }))).toEqual({ allowed: false, reason: 'limit_photos' });
  });
  it('Home Free allows 1 photo per box', () => {
    expect(can('add_photo', ctx({ counts: { boxes: 1, items: 0, photosOnParent: 1 } }))).toEqual({ allowed: false, reason: 'limit_photos' });
  });
  it('Seller Free allows 50 items and a Move Pass does not unlock Seller', () => {
    const c = ctx({ workspaceType: 'seller', plans: new Set(['move_pass'] as const), counts: { boxes: 0, items: 50, photosOnParent: 0 } });
    expect(can('add_item', c)).toEqual({ allowed: false, reason: 'limit_items' });
  });
  it('Pro features need Seller Pro', () => {
    expect(can('reports', ctx({ workspaceType: 'seller' }))).toEqual({ allowed: false, reason: 'pro_only' });
    expect(can('reports', ctx({ workspaceType: 'seller', plans: new Set(['seller_pro'] as const) })).allowed).toBe(true);
  });
  it('a feature switched off in config is blocked even with a plan', () => {
    const config = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, insurance_pdf: false } };
    expect(can('insurance_pdf', ctx({ config, plans: new Set(['move_pass'] as const) }))).toEqual({ allowed: false, reason: 'feature_off' });
  });
});
