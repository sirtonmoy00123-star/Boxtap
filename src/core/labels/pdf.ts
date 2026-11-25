// Label PDFs drawn in the browser (ADR-010). Text is drawn as text with pdf-lib, never as HTML (SECURITY_MODEL).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { cellRects, mm, PAGE, SHEETS, type Rect, type SheetId } from './layout';
import { labelUrl } from '../repo/labels';

export interface LabelData { code: string; number: number | null; title: string | null; room: string | null; fragile: boolean; openFirst: boolean }

/**
 * Ruling (build): the built-in PDF fonts cover Latin text only (WinAnsi). Other characters become "?"
 * until a Noto Sans Bengali subset is embedded for Seller mode (Phase 2). The box number and QR always print.
 */
export function pdfSafe(s: string): string {
  return [...s.normalize('NFC')].map((ch) => {
    const c = ch.codePointAt(0)!;
    return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || ch === '·' || ch === '–' || ch === '—' ? ch : '￿';
  }).join('').replace(/￿+/g, '?');
}

function qrMatrix(text: string): { size: number; dark: (x: number, y: number) => boolean } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  return { size, dark: (x, y) => !!qr.modules.get(y, x) };
}

function drawQr(page: PDFPage, text: string, x: number, y: number, side: number) {
  const m = qrMatrix(text);
  const quiet = 2;
  const cell = side / (m.size + quiet * 2);
  for (let row = 0; row < m.size; row++) {
    for (let col = 0; col < m.size; col++) {
      if (m.dark(col, row)) {
        page.drawRectangle({ x: x + (col + quiet) * cell, y: y + side - (row + quiet + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: rgb(0, 0, 0) });
      }
    }
  }
}

function fit(font: PDFFont, text: string, size: number, maxW: number): string {
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + '…';
  return t;
}

function drawLabel(page: PDFPage, r: Rect, l: LabelData, bold: PDFFont, regular: PDFFont) {
  const pad = mm(3);
  const qrSide = Math.min(r.h - pad * 2, mm(40));
  drawQr(page, labelUrl(l.code), r.x + pad, r.y + (r.h - qrSide) / 2, qrSide);
  const tx = r.x + pad * 2 + qrSide;
  const tw = r.x + r.w - pad - tx;
  const numSize = Math.min(r.h * 0.42, 48);
  let y = r.y + r.h - pad - numSize * 0.8;
  if (l.number != null) page.drawText(String(l.number), { x: tx, y, size: numSize, font: bold });
  const lineSize = Math.min(r.h * 0.12, 12);
  for (const line of [l.title, l.room].filter((s): s is string => !!s)) {
    y -= lineSize * 1.4;
    if (y < r.y + pad) break;
    page.drawText(fit(regular, pdfSafe(line), lineSize, tw), { x: tx, y, size: lineSize, font: regular });
  }
  const flags = [l.fragile ? 'FRAGILE' : '', l.openFirst ? 'OPEN FIRST' : ''].filter(Boolean).join(' · ');
  if (flags) page.drawText(fit(bold, flags, lineSize, tw), { x: tx, y: r.y + pad, size: lineSize, font: bold, color: rgb(0.75, 0, 0) });
  page.drawText(l.code, { x: tx, y: r.y + pad + (flags ? lineSize * 1.3 : 0), size: Math.min(lineSize, 8), font: regular, color: rgb(0.35, 0.35, 0.35) });
}

/** One page per sheet. `startAt` skips used positions on the first sheet (0-based). */
export async function buildLabelPdf(labels: readonly LabelData[], sheetId: SheetId, startAt = 0): Promise<Uint8Array> {
  const cells = cellRects(SHEETS[sheetId]);
  if (!Number.isInteger(startAt) || startAt < 0 || startAt >= cells.length) throw new RangeError(`start position must be 0-${cells.length - 1}`);
  const doc = await PDFDocument.create();
  doc.setTitle('BoxTap labels');
  doc.setProducer('BoxTap');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  let page: PDFPage | null = null;
  let pos = startAt;
  for (const l of labels) {
    if (!page || pos >= cells.length) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      if (page !== null && pos >= cells.length) pos = 0;
    }
    drawLabel(page, cells[pos]!, l, bold, regular);
    pos++;
  }
  if (!page) doc.addPage([PAGE.w, PAGE.h]);
  return doc.save();
}
