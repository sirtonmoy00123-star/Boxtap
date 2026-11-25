// Browser text renderer for label PDFs: draws one line on a canvas (the browser shapes Bangla correctly)
// at print resolution and returns it as a PNG. Uses OffscreenCanvas where available, else a normal canvas.
import type { TextRenderer } from './pdf';

const DPI_SCALE = 300 / 72; // canvas pixels per PDF point, for a crisp 300 dpi print
const FONT = 'system-ui, "Noto Sans Bengali", "Segoe UI", Roboto, sans-serif';

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { ctx: Ctx2D; toPng: () => Promise<Blob> } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (ctx) return { ctx, toPng: () => c.convertToBlob({ type: 'image/png' }) };
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return {
    ctx: c.getContext('2d')!,
    toPng: () => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('could not draw label text'))), 'image/png')),
  };
}

export const canvasTextRenderer: TextRenderer = async (text, sizePt) => {
  const px = Math.round(sizePt * DPI_SCALE);
  const m = makeCanvas(1, 1).ctx;
  m.font = `${px}px ${FONT}`;
  const width = Math.max(1, Math.ceil(m.measureText(text).width) + 4);
  const height = Math.ceil(px * 1.4);
  const { ctx, toPng } = makeCanvas(width, height);
  ctx.font = `${px}px ${FONT}`;
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 2, Math.round(px * 1.05));
  return { png: new Uint8Array(await (await toPng()).arrayBuffer()), width, height };
};
