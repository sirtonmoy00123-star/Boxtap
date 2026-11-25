// Ruling (build): a small typed dictionary over en.json/bn.json instead of i18next (same file format,
// so switching later is cheap). Placeholders look like {name}.
import en from './en.json';
import bn from './bn.json';

export type Lang = 'en' | 'bn';
export type Key = keyof typeof en;
const dicts: Record<Lang, Record<string, string>> = { en, bn };

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const raw = dicts[lang][key] ?? en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : raw;
}

/** Bangla digits ০-৯ to ASCII (DATABASE_SCHEMA §2: number inputs accept Bangla digits). */
export const asciiDigits = (s: string): string => s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
