// Ruling (build): a small typed dictionary over en.json/bn.json instead of i18next (same file format,
// so switching later is cheap). Placeholders look like {name}.
import en from './en.json';
import bn from './bn.json';

export type Lang = 'en' | 'bn';
export type Key = keyof typeof en;
const dicts: Record<Lang, Record<string, string>> = { en, bn };

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  // Singular form: a key may have a '<key>.one' variant used when n is 1 (e.g. '1 item').
  const one = vars?.n === 1 ? dicts[lang][`${key}.one`] ?? (lang === 'en' ? undefined : (en as Record<string, string>)[`${key}.one`]) : undefined;
  const raw = one ?? dicts[lang][key] ?? en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : raw;
}

/** Bangla digits ০-৯ to ASCII (DATABASE_SCHEMA §2: number inputs accept Bangla digits). */
export const asciiDigits = (s: string): string => s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
