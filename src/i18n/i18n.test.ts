import { describe, it, expect } from 'vitest';
import en from './en.json';
import bn from './bn.json';
import { translate, asciiDigits, formatNumber, formatDate } from './i18n';

describe('i18n', () => {
  it('bn has exactly the same keys as en', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
  });
  it('every bn string keeps the same placeholders as en', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ph(bn[k]), k).toBe(ph(en[k]));
  });
  it('fills placeholders', () => {
    expect(translate('en', 'box.title', { n: 12 })).toBe('Box 12');
  });
  it('converts Bangla digits', () => {
    expect(asciiDigits('বাক্স ১২০')).toBe('বাক্স 120');
  });
});

describe('singular forms', () => {
  it('uses the .one form when n is 1', () => {
    expect(translate('en', 'home.items', { n: 1 })).toBe('1 item');
    expect(translate('en', 'home.items', { n: 3 })).toBe('3 items');
    expect(translate('bn', 'home.items', { n: 1 })).toBe('১টি জিনিস'.replace('১', '1'));
  });
});

describe('Bangla digits on screen (ADR-023)', () => {
  it('shows Bangla digits in Bangla when asked, Western digits otherwise', () => {
    expect(formatNumber('bn', 120)).toBe('১২০');
    expect(formatNumber('en', 120)).toBe('120');
    expect(translate('bn', 'box.title', { n: 12 }, { localDigits: true })).toBe('বাক্স ১২');
    expect(translate('en', 'box.title', { n: 12 }, { localDigits: true })).toBe('Box 12');
    expect(asciiDigits(formatNumber('bn', 9876))).toBe('9876');
  });
  it('still picks the singular form before changing digits', () => {
    expect(translate('bn', 'home.items', { n: 1 }, { localDigits: true })).toBe('১টি জিনিস');
  });
  it('writes English dates as 26 Nov 2026', () => {
    expect(formatDate('en', '2026-11-26T10:00:00')).toBe('26 Nov 2026');
  });
});
