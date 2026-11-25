// Draws the in-stock catalogue picture on a canvas. Bangla and every other script are shaped by the browser.
import { catalogueLayout, formatPrice } from './layout';

export interface CatalogueEntry { name: string; available: number; priceMinor: number | null; photo: Blob }
export interface CatalogueText { title: string; subtitle: string; inStock: (n: number) => string }

const FONT = 'system-ui, "Noto Sans Bengali", "Segoe UI", Roboto, sans-serif';

function fitLines(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const tryLine = line ? `${line} ${w}` : w;
    if (ctx.measureText(tryLine).width <= maxW || !line) line = tryLine;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1]!;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

export async function renderCatalogue(entries: readonly CatalogueEntry[], currency: 'AUD' | 'BDT', text: CatalogueText): Promise<Blob> {
  const l = catalogueLayout(entries.length);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(l.width, l.height) : Object.assign(document.createElement('canvas'), { width: l.width, height: l.height });
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, l.width, l.height);
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'top';
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText(fitLines(ctx, text.title, l.width - 64, 1)[0] ?? '', 32, 24);
  ctx.font = `400 28px ${FONT}`;
  ctx.fillStyle = '#475569';
  ctx.fillText(text.subtitle, 32, 76);

  for (let i = 0; i < l.tiles.length; i++) {
    const tile = l.tiles[i]!;
    const e = entries[i]!;
    const bmp = await createImageBitmap(e.photo);
    // Cover-crop to a square.
    const s = Math.min(bmp.width, bmp.height);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(tile.x, tile.y, tile.size, tile.size, 16);
    ctx.clip();
    ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, tile.x, tile.y, tile.size, tile.size);
    ctx.restore();
    bmp.close();

    const nameSize = l.columns === 3 ? 26 : 32;
    ctx.font = `600 ${nameSize}px ${FONT}`;
    ctx.fillStyle = '#0f172a';
    const lines = fitLines(ctx, e.name, tile.size, 1);
    ctx.fillText(lines[0] ?? '', tile.x, tile.y + tile.size + 10);
    ctx.font = `400 ${nameSize - 4}px ${FONT}`;
    const price = formatPrice(e.priceMinor, currency);
    const meta = [price, text.inStock(e.available)].filter(Boolean).join(' · ');
    ctx.fillStyle = '#15803d';
    ctx.fillText(fitLines(ctx, meta, tile.size, 1)[0] ?? '', tile.x, tile.y + tile.size + 14 + nameSize);
  }

  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return new Promise<Blob>((res, rej) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('could not draw the picture'))), 'image/jpeg', 0.85));
}
