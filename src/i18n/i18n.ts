// Ruling (build): a small typed dictionary over en.json/bn.json instead of i18next (same file format,
// so switching later is cheap). Placeholders look like {name}.
import en from './en.json';
import bn from './bn.json';

export type Lang = 'en' | 'bn';
export type Key = keyof typeof en;
const dicts: Record<Lang, Record<string, string>> = { en, bn };

const numberFormats: Partial<Record<Lang, Intl.NumberFormat>> = {};
/** Display form of a number: Bangla digits in Bangla (ADR-023), Western digits in English. Stored data is never changed. */
export function formatNumber(lang: Lang, n: number): string {
  if (lang !== 'bn') return String(n);
  return (numberFormats.bn ??= new Intl.NumberFormat('bn-BD', { useGrouping: false, maximumFractionDigits: 20 })).format(n);
}

/** Dates as "26 Nov 2026" in English (DESIGN_SYSTEM §8), the Bangla calendar words and digits in Bangla. */
export function formatDate(lang: Lang, iso: string | number | Date, withTime = false): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) };
  return d.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', opts);
}

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>, opts: { localDigits?: boolean } = {}): string {
  // Singular form: a key may have a '<key>.one' variant used when n is 1 (e.g. '1 item').
  const one = vars?.n === 1 ? dicts[lang][`${key}.one`] ?? (lang === 'en' ? undefined : (en as Record<string, string>)[`${key}.one`]) : undefined;
  const raw = one ?? dicts[lang][key] ?? en[key] ?? key;
  const show = (v: string | number | undefined, k: string) =>
    v === undefined ? `{${k}}` : typeof v === 'number' && opts.localDigits ? formatNumber(lang, v) : String(v);
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k: string) => show(vars[k], k)) : raw;
}

/** Bangla digits ০-৯ to ASCII (DATABASE_SCHEMA §2: number inputs accept Bangla digits). */
export const asciiDigits = (s: string): string => s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
