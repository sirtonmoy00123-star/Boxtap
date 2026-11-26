// Removalist job labels: nothing overlaps or runs off the label, on both sheets, with long and Bangla text.
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { zlibSync } from 'fflate';
import { cellRects, SHEETS, type Rect, type SheetId } from './layout';
import { buildJobLabelPdf, type JobLabelItem } from './pdf';

// A real PNG the shape of a long line of drawn text (2000 x 40 px, grey, no alpha), so scaling is tested.
function widePng(w = 2000, h = 40): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type: string, data: Uint8Array) => {
    const td = new Uint8Array([...type].map((c) => c.charCodeAt(0)).concat([...data]));
    return [...u32(data.length), ...td, ...u32(crc(td))];
  };
  const raw = new Uint8Array((w + 1) * h); // filter byte 0 + black pixels
  const ihdr = new Uint8Array([...u32(w), ...u32(h), 8, 0, 0, 0, 0]);
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr), ...chunk('IDAT', zlibSync(raw)), ...chunk('IEND', new Uint8Array())]);
}

const item = (over: Partial<JobLabelItem> = {}): JobLabelItem => ({
  code: 'K7Q2M9XR4T', big: 'Box 12 of 45', owner: 'Khan · J-0042', name: 'Pots and pans', room: 'Kitchen', fragile: true, openFirst: true, ...over,
});

async function traced(sheet: SheetId, labels: JobLabelItem[], renderText?: boolean) {
  const png = widePng();
  const boxes: { label: number; box: Rect & { what: string } }[] = [];
  const seen: string[] = [];
  const bytes = await buildJobLabelPdf(labels, sheet, 0, {
    businessName: 'Fast Movers & Storage of Western Sydney Pty Ltd',
    renderText: renderText ? async (text) => { seen.push(text); return { png, width: 2000, height: 40 }; } : undefined,
    trace: (label, box) => boxes.push({ label, box }),
  });
  return { bytes, boxes, seen };
}

const inside = (b: Rect, r: Rect) => b.x >= r.x - 0.01 && b.y >= r.y - 0.01 && b.x + b.w <= r.x + r.w + 0.01 && b.y + b.h <= r.y + r.h + 0.01;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

describe.each(Object.keys(SHEETS) as SheetId[])('job labels on %s', (sheet) => {
  const cells = cellRects(SHEETS[sheet]);
  const cases: [string, JobLabelItem, boolean][] = [
    ['plain', item(), false],
    ['long Latin text', item({ big: 'Piece 123 of 456', owner: 'Montgomery-Fitzwilliam · J-1234', name: 'Grandmother\'s good china, wrapped twice, this side up', room: 'Upstairs back bedroom with the balcony' }), false],
    ['long Bangla text drawn by the browser', item({ big: 'বাক্স ১২ / ৪৫', owner: 'রহমান চৌধুরী খান · J-0042', name: 'রান্নাঘরের বাসনপত্র, কাঁচের জিনিস সাবধানে রাখুন', room: 'দোতলার পেছনের শোবার ঘর বারান্দাসহ' }), true],
    ['no name, no room, no flags', item({ name: null, room: null, fragile: false, openFirst: false }), false],
  ];
  it.each(cases)('%s: every element stays inside its label and nothing overlaps', async (_name, l, bangla) => {
    const { boxes, seen } = await traced(sheet, [l], bangla);
    const r = cells[0]!;
    const mine = boxes.filter((b) => b.label === 0).map((b) => b.box);
    expect(mine.map((b) => b.what)).toEqual(expect.arrayContaining(['qr', 'code', 'big', 'owner']));
    for (const b of mine) expect(inside(b, r), `${b.what} leaves the label`).toBe(true);
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
      expect(overlap(mine[i]!, mine[j]!), `${mine[i]!.what} overlaps ${mine[j]!.what}`).toBe(false);
    }
    if (bangla) expect(seen).toEqual(expect.arrayContaining(['বাক্স ১২ / ৪৫', 'রহমান চৌধুরী খান · J-0042']));
  });

  it('a full sheet makes one page, the next label starts a new page', async () => {
    const n = cells.length;
    expect((await PDFDocument.load((await traced(sheet, Array.from({ length: n }, () => item()))).bytes)).getPageCount()).toBe(1);
    expect((await PDFDocument.load((await traced(sheet, Array.from({ length: n + 1 }, () => item()))).bytes)).getPageCount()).toBe(2);
  });
});

describe('job label box name', () => {
  it('is printed on L7165 (drawn when not Latin) and never on L7163', async () => {
    const big = await traced('L7165', [item({ name: 'রান্নাঘরের বাসনপত্র' })], true);
    expect(big.boxes.some((b) => b.box.what === 'name')).toBe(true);
    expect(big.seen).toContain('রান্নাঘরের বাসনপত্র');
    const small = await traced('L7163', [item({ name: 'রান্নাঘরের বাসনপত্র' })], true);
    expect(small.boxes.some((b) => b.box.what === 'name')).toBe(false);
    expect(small.seen).not.toContain('রান্নাঘরের বাসনপত্র');
  });
});

describe('job label room line', () => {
  it('is shown on both sheets when it fits', async () => {
    for (const sheet of ['L7165', 'L7163'] as const) {
      const { boxes } = await traced(sheet, [item()]);
      expect(boxes.some((b) => b.box.what === 'room')).toBe(true);
    }
  });
  it('the logo is never drawn on L7163', async () => {
    const png = widePng();
    const whats: string[] = [];
    await buildJobLabelPdf([item()], 'L7163', 0, { businessName: 'M', logo: { bytes: png, mime: 'image/png' }, trace: (_i, b) => whats.push(b.what) });
    expect(whats).not.toContain('logo');
    expect(whats).toContain('business');
    const big: string[] = [];
    await buildJobLabelPdf([item()], 'L7165', 0, { businessName: 'M', logo: { bytes: png, mime: 'image/png' }, trace: (_i, b) => big.push(b.what) });
    expect(big).toContain('logo');
  });
});
