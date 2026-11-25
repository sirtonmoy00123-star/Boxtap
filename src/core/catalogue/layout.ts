// In-stock catalogue picture (ADR-015, API_CONTRACTS §7): a photo grid with name, price and "in stock",
// drawn on a canvas (text drawn as text, never HTML) and shared as an image, e.g. to WhatsApp.

export const CATALOGUE_MAX = 12;
const WIDTH = 1080; // a square-ish image WhatsApp shows well
const PAD = 32;
const GAP = 24;
const HEADER = 120;
const CAPTION = 96;

export interface Tile { x: number; y: number; size: number }
export interface CatalogueLayout { width: number; height: number; columns: number; header: number; captionHeight: number; tiles: Tile[] }

export function catalogueLayout(n: number): CatalogueLayout {
  const count = Math.max(1, Math.min(n, CATALOGUE_MAX));
  const columns = count === 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / columns);
  const size = Math.floor((WIDTH - PAD * 2 - GAP * (columns - 1)) / columns);
  const tiles: Tile[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % columns;
    const r = Math.floor(i / columns);
    tiles.push({ x: PAD + c * (size + GAP), y: HEADER + r * (size + CAPTION + GAP), size });
  }
  const height = HEADER + rows * (size + CAPTION) + (rows - 1) * GAP + PAD;
  return { width: WIDTH, height, columns, header: HEADER, captionHeight: CAPTION, tiles };
}

export interface Candidate { id: string; available: number; hasPhoto: boolean }

/** Items worth showing: in stock, with a photo, most stock first, at most 12. */
export function pickCatalogueItems<T extends Candidate>(items: readonly T[]): T[] {
  return items.filter((i) => i.available > 0 && i.hasPhoto).sort((a, b) => b.available - a.available).slice(0, CATALOGUE_MAX);
}

export function formatPrice(minor: number | null, currency: 'AUD' | 'BDT'): string {
  if (minor == null) return '';
  const whole = minor % 100 === 0;
  const n = (minor / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return `${currency === 'BDT' ? '৳' : '$'}${n}`;
}
