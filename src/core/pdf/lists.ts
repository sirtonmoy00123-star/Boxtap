// Share-out PDFs for Home mode (API_CONTRACTS §7): removalist list (free: box, room, handling, nothing about what
// is inside), family box list (Move Pass: items and photos), insurance list (Move Pass: items, values, photos).
// Text is drawn as text (never HTML); non-Latin lines go through the browser text renderer like labels.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { mm } from '../labels/layout';
import { pdfSafe, type TextRenderer } from '../labels/pdf';
import { formatPrice } from '../catalogue/layout';

export type ListKind = 'removalist' | 'family' | 'insurance';
export interface ListItem { name: string; valueMinor: number | null; photo: Uint8Array | null }
export interface ListBox {
  number: number; name: string | null; room: string | null; fragile: boolean; openFirst: boolean;
  moveStatus: 'packed' | 'moved' | 'unpacked' | null; photo: Uint8Array | null; items: ListItem[];
}
export interface ListRow { title: string; tags: string[]; lines: string[]; photo: Uint8Array | null }

/** What each list shows, separate from drawing so it can be tested. */
export function listRows(kind: ListKind, boxes: readonly ListBox[], currency: 'AUD' | 'BDT'): ListRow[] {
  const rows = boxes.map((b) => {
    const title = [`Box ${b.number}`, b.name].filter(Boolean).join(' · ');
    const tags = [b.room ?? '', b.fragile ? 'FRAGILE' : '', b.openFirst ? 'OPEN FIRST' : ''].filter(Boolean);
    if (kind === 'removalist') return { title, tags, lines: [], photo: null };
    const lines = b.items.map((i) => (kind === 'insurance' ? `${i.name} · ${i.valueMinor == null ? 'no value' : formatPrice(i.valueMinor, currency)}` : i.name));
    return { title, tags, lines, photo: b.photo };
  });
  if (kind === 'insurance') {
    const total = boxes.reduce((s, b) => s + b.items.reduce((t, i) => t + (i.valueMinor ?? 0), 0), 0);
    rows.push({ title: `Total value: ${formatPrice(total, currency)}`, tags: [], lines: [], photo: null });
  }
  return rows;
}

const PAGE = { w: mm(210), h: mm(297) };
const M = mm(15);

export async function buildListPdf(kind: ListKind, boxes: readonly ListBox[], opts: { title: string; currency: 'AUD' | 'BDT'; renderText?: TextRenderer }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`BoxTap ${kind} list`);
  doc.setProducer('BoxTap');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - M;

  const ensure = (h: number) => {
    if (y - h < M) { page = doc.addPage([PAGE.w, PAGE.h]); y = PAGE.h - M; }
  };
  const text = async (s: string, size: number, font: PDFFont, x: number, color = rgb(0, 0, 0)) => {
    const safe = pdfSafe(s);
    if (opts.renderText && safe !== s.normalize('NFC')) {
      const img = await doc.embedPng((await opts.renderText(s, size)).png);
      const h = size * 1.2;
      page.drawImage(img, { x, y: y - size * 0.2, width: Math.min(PAGE.w - M - x, (img.width / img.height) * h), height: h });
    } else {
      page.drawText(safe, { x, y, size, font, color, maxWidth: PAGE.w - M - x });
    }
  };
  const embed = async (bytes: Uint8Array): Promise<PDFImage | null> => {
    try { return await doc.embedJpg(bytes); } catch { try { return await doc.embedPng(bytes); } catch { return null; } }
  };

  ensure(30);
  y -= 18;
  await text(opts.title, 18, bold, M);
  y -= 8;
  page.drawText(kind === 'removalist' ? 'Removalist list' : kind === 'family' ? 'What is in each box' : 'Insurance list', { x: M, y: (y -= 14), size: 11, font: regular, color: rgb(0.3, 0.3, 0.3) });
  y -= 10;

  for (const row of listRows(kind, boxes, opts.currency)) {
    const photo = row.photo ? await embed(row.photo) : null;
    const thumb = photo ? mm(22) : 0;
    const height = Math.max(thumb, 18 + row.lines.length * 13 + (row.tags.length ? 13 : 0)) + 10;
    ensure(height);
    const top = y;
    const tx = M + (thumb ? thumb + mm(4) : 0);
    y -= 14;
    await text(row.title, 13, bold, tx);
    if (row.tags.length) { y -= 13; await text(row.tags.join(' · '), 10, regular, tx, rgb(0.6, 0, 0)); }
    for (const line of row.lines) { y -= 13; await text(line, 10, regular, tx + 6); }
    if (photo) page.drawImage(photo, { x: M, y: top - thumb, width: thumb, height: thumb });
    y = Math.min(y, top - thumb) - 10;
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: PAGE.w - M, y: y + 4 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  }
  return doc.save();
}
