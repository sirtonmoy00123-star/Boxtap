// Label codes: 10 characters of Crockford base32 (API_CONTRACTS §5). ~50 bits, random.
export const LABEL_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/;
export const LABEL_URL_PREFIX = 'https://boxtap.app/b/';

export const isLabelCode = (s: string): boolean => CODE_RE.test(s);

export function newLabelCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(10);
  let out = '';
  for (const b of bytes) out += LABEL_ALPHABET[b & 31];
  return out;
}

export const labelUrl = (code: string): string => `${LABEL_URL_PREFIX}${code}`;

/**
 * Accepts only https://boxtap.app/b/<10 valid chars> (SECURITY_MODEL §2: malicious QR codes).
 * Lower-case and the Crockford look-alikes (O→0, I/L→1) are normalised. Returns the code or null.
 */
export function parseLabelUrl(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'boxtap.app' || url.search || url.hash || url.port) return null;
  const m = /^\/b\/([^/]+)$/.exec(url.pathname);
  if (!m) return null;
  const code = m[1]!.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  return isLabelCode(code) ? code : null;
}
