// Label PDFs drawn in the browser (ADR-010). Text is drawn as text with pdf-lib, never as HTML (SECURITY_MODEL).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { cellRects, mm, PAGE, SHEETS, type Rect, type SheetId } from './layout';
import { labelUrl } from '../repo/labels';

export interface LabelData { code: string; number: number | null; title: string | null; room: string | null; fragile: boolean; openFirst: boolean }

/**
 * The built-in PDF fonts cover Latin text only (WinAnsi). In the browser, other lines are drawn by a TextRenderer
 * (canvas, so Bangla is shaped correctly) and placed as pictures. Without one (tests), they fall back to "?".
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

/** Draws one line of text as a picture (browser shaping: Bangla and every other script). Width/height in px. */
export type TextRenderer = (text: string, sizePt: number) => Promise<{ png: Uint8Array; width: number; height: number }>;

const latinOnly = (s: string) => pdfSafe(s) === s.normalize('NFC');

async function drawLabel(doc: PDFDocument, page: PDFPage, r: Rect, l: LabelData, bold: PDFFont, regular: PDFFont, renderText?: TextRenderer) {
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
    if (renderText && !latinOnly(line)) {
      const img = await doc.embedPng(await renderText(line, lineSize).then((x) => x.png));
      const h = lineSize * 1.2;
      const w = Math.min(tw, (img.width / img.height) * h);
      page.drawImage(img, { x: tx, y: y - lineSize * 0.2, width: w, height: w < tw ? h : (img.height / img.width) * w });
    } else {
      page.drawText(fit(regular, pdfSafe(line), lineSize, tw), { x: tx, y, size: lineSize, font: regular });
    }
  }
  const flags = [l.fragile ? 'FRAGILE' : '', l.openFirst ? 'OPEN FIRST' : ''].filter(Boolean).join(' · ');
  if (flags) page.drawText(fit(bold, flags, lineSize, tw), { x: tx, y: r.y + pad, size: lineSize, font: bold, color: rgb(0.75, 0, 0) });
  page.drawText(l.code, { x: tx, y: r.y + pad + (flags ? lineSize * 1.3 : 0), size: Math.min(lineSize, 8), font: regular, color: rgb(0.35, 0.35, 0.35) });
}

/** One page per sheet. `startAt` skips used positions on the first sheet (0-based). */
export async function buildLabelPdf(labels: readonly LabelData[], sheetId: SheetId, startAt = 0, opts: { renderText?: TextRenderer } = {}): Promise<Uint8Array> {
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
    await drawLabel(doc, page, cells[pos]!, l, bold, regular, opts.renderText);
    pos++;
  }
  if (!page) doc.addPage([PAGE.w, PAGE.h]);
  return doc.save();
}

// Removalist job labels (Phase 2) ------------------------------------------------------------------

export interface JobLabelItem {
  code: string;
  /** "Box 12 of 45" / "Piece 3 of 7" in the business's language. */
  big: string;
  /** The customer's last name with the job number: "Khan · J-0042" (owner, 2026-11-26). */
  owner: string;
  room: string | null;
  fragile: boolean;
  openFirst: boolean;
}
export interface JobLabelOptions {
  renderText?: TextRenderer;
  businessName: string;
  /** Only passed with Removalist Pro (logo_branding). Drawn on L7165 only, and only if it fits. */
  logo?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' } | null;
  /** Test hook: every element drawn, as a box in PDF points, to prove nothing overlaps or leaves the label. */
  trace?: (label: number, box: Rect & { what: string }) => void;
}

const SIZES: Record<SheetId, { business: number; big: number; owner: number; room: number; flags: number; code: number; logo: number }> = {
  L7165: { business: 8, big: 22, owner: 13, room: 11, flags: 10, code: 7, logo: 16 },
  L7163: { business: 7, big: 15, owner: 10, room: 9, flags: 8, code: 6, logo: 0 },
};

/**
 * One Removalist label: QR on the left (unchanged format), then business name (or logo), "Box 12 of 45",
 * "Khan · J-0042", destination room; Fragile / Open first and the code at the bottom. Lines are stacked in boxes
 * of 1.2× their size; a line that would reach the bottom block is left out (the room first), never drawn over it.
 */
async function drawJobLabel(doc: PDFDocument, page: PDFPage, r: Rect, l: JobLabelItem, sheet: SheetId, bold: PDFFont, regular: PDFFont,
  o: JobLabelOptions, logo: Awaited<ReturnType<PDFDocument['embedPng']>> | null, index: number) {
  const s = SIZES[sheet];
  const pad = mm(3);
  const trace = (box: Rect, what: string) => o.trace?.(index, { ...box, what });
  const qrSide = Math.min(r.h - pad * 2, mm(40));
  const qrY = r.y + (r.h - qrSide) / 2;
  drawQr(page, labelUrl(l.code), r.x + pad, qrY, qrSide);
  trace({ x: r.x + pad, y: qrY, w: qrSide, h: qrSide }, 'qr');
  const tx = r.x + pad * 2 + qrSide;
  const tw = r.x + r.w - pad - tx;

  // Bottom block, drawn bottom-up: the code, then the flags above it.
  let bottom = r.y + pad;
  const codeH = s.code * 1.2;
  page.drawText(l.code, { x: tx, y: bottom + s.code * 0.25, size: s.code, font: regular, color: rgb(0.35, 0.35, 0.35) });
  trace({ x: tx, y: bottom, w: regular.widthOfTextAtSize(l.code, s.code), h: codeH }, 'code');
  bottom += codeH;
  const flags = [l.fragile ? 'FRAGILE' : '', l.openFirst ? 'OPEN FIRST' : ''].filter(Boolean).join(' · ');
  if (flags) {
    const f = fit(bold, flags, s.flags, tw);
    page.drawText(f, { x: tx, y: bottom + s.flags * 0.25, size: s.flags, font: bold, color: rgb(0.75, 0, 0) });
    trace({ x: tx, y: bottom, w: bold.widthOfTextAtSize(f, s.flags), h: s.flags * 1.2 }, 'flags');
    bottom += s.flags * 1.2;
  }

  // Top block, top-down.
  let top = r.y + r.h - pad;
  const line = async (text: string, size: number, font: PDFFont, what: string, grey = false): Promise<boolean> => {
    const h = size * 1.2;
    if (top - h < bottom) return false;
    if (o.renderText && !latinOnly(text)) {
      const img = await doc.embedPng((await o.renderText(text, size)).png);
      let w = (img.width / img.height) * h;
      let ih = h;
      if (w > tw) { ih = (tw / w) * h; w = tw; }
      page.drawImage(img, { x: tx, y: top - h + (h - ih) / 2, width: w, height: ih });
      trace({ x: tx, y: top - h + (h - ih) / 2, w, h: ih }, what);
    } else {
      const t = fit(font, pdfSafe(text), size, tw);
      page.drawText(t, { x: tx, y: top - size * 0.95, size, font, color: grey ? rgb(0.3, 0.3, 0.3) : rgb(0, 0, 0) });
      trace({ x: tx, y: top - h, w: font.widthOfTextAtSize(t, size), h }, what);
    }
    top -= h;
    return true;
  };
  if (logo && s.logo > 0 && top - s.logo >= bottom) {
    let w = (logo.width / logo.height) * s.logo;
    let h = s.logo;
    if (w > tw) { h = (tw / w) * h; w = tw; }
    page.drawImage(logo, { x: tx, y: top - h, width: w, height: h });
    trace({ x: tx, y: top - h, w, h }, 'logo');
    top -= s.logo + 2;
  } else {
    await line(o.businessName, s.business, regular, 'business', true);
  }
  await line(l.big, s.big, bold, 'big');
  await line(l.owner, s.owner, bold, 'owner');
  if (l.room) await line(l.room, s.room, regular, 'room');
}

/** Removalist job labels: one page per sheet, `startAt` skips used positions on the first sheet (0-based). */
export async function buildJobLabelPdf(labels: readonly JobLabelItem[], sheetId: SheetId, startAt: number, o: JobLabelOptions): Promise<Uint8Array> {
  const cells = cellRects(SHEETS[sheetId]);
  if (!Number.isInteger(startAt) || startAt < 0 || startAt >= cells.length) throw new RangeError(`start position must be 0-${cells.length - 1}`);
  const doc = await PDFDocument.create();
  doc.setTitle('BoxTap job labels');
  doc.setProducer('BoxTap');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  let logo: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (o.logo && SIZES[sheetId].logo > 0) {
    try { logo = o.logo.mime === 'image/png' ? await doc.embedPng(o.logo.bytes) : await doc.embedJpg(o.logo.bytes); } catch { logo = null; }
  }
  let page: PDFPage | null = null;
  let pos = startAt;
  for (const [i, l] of labels.entries()) {
    if (!page || pos >= cells.length) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      if (pos >= cells.length) pos = 0;
    }
    await drawJobLabel(doc, page, cells[pos]!, l, sheetId, bold, regular, o, logo, i);
    pos++;
  }
  if (!page) doc.addPage([PAGE.w, PAGE.h]);
  return doc.save();
}
