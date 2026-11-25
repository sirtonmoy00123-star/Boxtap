import { describe, it, expect } from 'vitest';
import { catalogueLayout, pickCatalogueItems, formatPrice, CATALOGUE_MAX } from './layout';

describe('catalogue picture layout (ADR-015)', () => {
  it('uses 1, 2 or 3 columns and fits every tile inside the canvas', () => {
    for (const n of [1, 2, 3, 4, 5, 9, 12]) {
      const l = catalogueLayout(n);
      expect(l.tiles).toHaveLength(n);
      expect(l.columns).toBe(n === 1 ? 1 : n <= 4 ? 2 : 3);
      for (const tile of l.tiles) {
        expect(tile.x + tile.size).toBeLessThanOrEqual(l.width);
        expect(tile.y + tile.size + l.captionHeight).toBeLessThanOrEqual(l.height);
      }
    }
  });
  it('picks only items in stock that have a photo, most stock first, at most 12', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, available: i % 3 === 0 ? 0 : i, hasPhoto: i !== 4 }));
    const picked = pickCatalogueItems(items);
    expect(picked.length).toBe(CATALOGUE_MAX);
    expect(picked.every((p) => p.available > 0 && p.hasPhoto)).toBe(true);
    expect(picked[0]!.available).toBe(19);
  });
  it('formats prices in taka and dollars from minor units', () => {
    expect(formatPrice(129900, 'BDT')).toBe('৳1,299');
    expect(formatPrice(129950, 'BDT')).toBe('৳1,299.50');
    expect(formatPrice(1295, 'AUD')).toBe('$12.95');
    expect(formatPrice(null, 'BDT')).toBe('');
  });
});
