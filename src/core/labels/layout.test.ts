import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { SHEETS, cellRects, mm } from './layout';
import { buildLabelPdf, pdfSafe } from './pdf';

const A4 = { w: mm(210), h: mm(297) };

describe('label sheet layout', () => {
  it.each(Object.keys(SHEETS) as (keyof typeof SHEETS)[])('%s cells fit on A4 without overlapping', (id) => {
    const cells = cellRects(SHEETS[id]);
    expect(cells).toHaveLength(SHEETS[id].cols * SHEETS[id].rows);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(A4.w + 0.01);
      expect(c.y + c.h).toBeLessThanOrEqual(A4.h + 0.01);
    }
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i]!, b = cells[j]!;
      const overlap = a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
      expect(overlap).toBe(false);
    }
  });

  it('L7165 matches Avery: 2 x 4 labels of 99.1 x 67.7 mm', () => {
    const [first] = cellRects(SHEETS.L7165);
    expect(first!.w).toBeCloseTo(mm(99.1), 1);
    expect(first!.h).toBeCloseTo(mm(67.7), 1);
  });

  it('first label is at the top-left (PDF origin is bottom-left)', () => {
    const cells = cellRects(SHEETS.L7165);
    expect(cells[0]!.y).toBeGreaterThan(cells[cells.length - 1]!.y);
    expect(cells[0]!.x).toBeLessThan(cells[1]!.x);
  });
});

describe('label PDF', () => {
  const label = (n: number) => ({ code: 'K7Q2M9XR4T', number: n, title: `Kitchen ${n}`, room: 'Kitchen', fragile: n % 2 === 0, openFirst: false });

  it('puts 8 labels per L7165 page and adds pages as needed', async () => {
    const bytes = await buildLabelPdf(Array.from({ length: 9 }, (_, i) => label(i + 1)), 'L7165');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(A4.w, 0);
  });

  it('can start at a later position on a part-used sheet', async () => {
    const bytes = await buildLabelPdf([label(1)], 'L7165', 7);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    await expect(buildLabelPdf([label(1)], 'L7165', 8)).rejects.toThrow(/start/);
  });

  it('never fails on text the standard PDF font cannot draw', async () => {
    expect(pdfSafe('Küche · 厨房 · রান্নাঘর')).toBe('Küche · ? · ?');
    await expect(buildLabelPdf([{ ...label(1), title: 'রান্নাঘর 😀' }], 'L7163')).resolves.toBeInstanceOf(Uint8Array);
  });
});
