import { describe, it, expect } from 'vitest';
import { encodeWithin, MAX_PHOTO_BYTES, type Encoder } from './encode';

const blob = (type: string, size: number) => new Blob([new Uint8Array(size)], { type });

describe('photo encoding (audit B12)', () => {
  it('keeps WebP when the browser can make it', async () => {
    const enc: Encoder = async (type) => blob(type, 150_000);
    const out = await encodeWithin(enc, MAX_PHOTO_BYTES);
    expect(out.type).toBe('image/webp');
  });

  it('falls back to JPEG when the browser returns another type for WebP (Safari)', async () => {
    const asked: string[] = [];
    const enc: Encoder = async (type, q) => { asked.push(`${type}@${q}`); return blob(type === 'image/webp' ? 'image/png' : type, 180_000); };
    const out = await encodeWithin(enc, MAX_PHOTO_BYTES);
    expect(out.type).toBe('image/jpeg');
    expect(asked).toEqual(['image/webp@0.8', 'image/jpeg@0.8']);
  });

  it('lowers quality until the photo fits under the cap', async () => {
    const enc: Encoder = async (type, q) => blob(type, Math.round(q * 1_000_000));
    const out = await encodeWithin(enc, MAX_PHOTO_BYTES);
    expect(out.size).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
    expect(out.size).toBe(500_000);
  });

  it('gives up with a clear error if even the lowest quality is too big', async () => {
    const enc: Encoder = async (type) => blob(type, 900_000);
    await expect(encodeWithin(enc, MAX_PHOTO_BYTES)).rejects.toThrow(/too large/);
  });
});

import { conditionCaption } from './condition';
describe('condition photo caption', () => {
  it('reads "26 Nov 2026 14:32 · J-0042 · Box 7 · Pickup" in English, local time', () => {
    expect(conditionCaption(new Date(2026, 10, 26, 14, 32), 'J-0042', false, 7, 'pickup')).toBe('26 Nov 2026 14:32 · J-0042 · Box 7 · Pickup');
    expect(conditionCaption(new Date(2026, 0, 5, 9, 3), 'J-0001', true, 2, 'delivery')).toBe('5 Jan 2026 09:03 · J-0001 · Piece 2 · Delivery');
  });
});
