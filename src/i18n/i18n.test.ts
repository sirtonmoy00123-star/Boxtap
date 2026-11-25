import { describe, it, expect } from 'vitest';
import en from './en.json';
import bn from './bn.json';
import { translate, asciiDigits } from './i18n';

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
