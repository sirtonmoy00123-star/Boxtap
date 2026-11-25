import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { listRows, buildListPdf, type ListBox } from './lists';

const boxes: ListBox[] = [
  { number: 1, name: 'Kitchen 1', room: 'Kitchen', fragile: true, openFirst: true, moveStatus: 'moved', photo: null,
    items: [{ name: 'Kettle', valueMinor: 8000, photo: null }, { name: 'Plates', valueMinor: null, photo: null }] },
  { number: 2, name: null, room: null, fragile: false, openFirst: false, moveStatus: null, photo: null, items: [] },
];

describe('list PDFs (API_CONTRACTS §7)', () => {
  it('removalist list: box, room and handling only, never what is inside (privacy)', () => {
    const rows = listRows('removalist', boxes, 'AUD');
    const text = JSON.stringify(rows);
    expect(text).toContain('FRAGILE');
    expect(text).toContain('OPEN FIRST');
    expect(text).not.toContain('Kettle');
    expect(rows.map((r) => r.title)).toEqual(['Box 1 · Kitchen 1', 'Box 2']);
  });
  it('family list: every item under its box', () => {
    const rows = listRows('family', boxes, 'AUD');
    expect(rows[0]!.lines).toEqual(['Kettle', 'Plates']);
  });
  it('insurance list: items with values and a total; missing values are marked', () => {
    const rows = listRows('insurance', boxes, 'AUD');
    expect(rows[0]!.lines).toEqual(['Kettle · $80', 'Plates · no value']);
    expect(rows.at(-1)!.title).toBe('Total value: $80');
  });
  it('builds a multi-page A4 PDF for many boxes', async () => {
    const many: ListBox[] = Array.from({ length: 60 }, (_, i) => ({ ...boxes[0]!, number: i + 1 }));
    const pdf = await PDFDocument.load(await buildListPdf('family', many, { title: 'Our move', currency: 'AUD' }));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
});
