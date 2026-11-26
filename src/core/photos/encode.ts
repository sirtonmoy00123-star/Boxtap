// Photo shrinking in the browser (ARCHITECTURE §4, audit B12): decode straight to the target width so a 48 MP
// photo never sits in memory at full size, encode WebP, fall back to JPEG where WebP can't be made (Safari).
import { bytesToHex } from '../util/encoding';

export const MAX_PHOTO_BYTES = 575_000; // the schema allows 600 000; keep a margin
export const FULL_WIDTH = 1600;
export const THUMB_WIDTH = 400;
const QUALITIES = [0.8, 0.7, 0.6, 0.5];

export type Encoder = (type: 'image/webp' | 'image/jpeg', quality: number) => Promise<Blob>;

/** Picks the format once (WebP if the browser really makes it), then lowers quality until it fits. */
export async function encodeWithin(encode: Encoder, maxBytes: number): Promise<Blob> {
  const first = await encode('image/webp', QUALITIES[0]!);
  const type = first.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  let out = type === 'image/webp' ? first : await encode('image/jpeg', QUALITIES[0]!);
  for (const q of QUALITIES.slice(1)) {
    if (out.size <= maxBytes) break;
    out = await encode(type, q);
  }
  if (out.size > maxBytes) throw new Error('This photo is too large to save. Try another photo.');
  return out;
}

/** The photo's width from its header (load only, no full decode), or null where it can't be read. */
function naturalWidth(file: Blob): Promise<number | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img.naturalWidth || null); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function bitmapAtWidth(file: Blob, width: number): Promise<ImageBitmap> {
  // Decode to the target width directly; height follows the aspect ratio. EXIF orientation is applied.
  const probe = await createImageBitmap(file, { resizeWidth: 64, imageOrientation: 'from-image' });
  const aspect = probe.height / probe.width;
  probe.close();
  // Never enlarge: a small photo keeps its own width.
  const own = await naturalWidth(file);
  const w = Math.max(1, Math.min(width, own ?? width, 4096));
  return createImageBitmap(file, { resizeWidth: w, resizeHeight: Math.max(1, Math.round(w * aspect)), resizeQuality: 'high', imageOrientation: 'from-image' });
}

function encoderFor(bmp: ImageBitmap): Encoder {
  return async (type, quality) => {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      return c.convertToBlob({ type, quality });
    }
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('could not encode photo'))), type, quality));
  };
}

/** 400 px thumbnail in the same format as the photo (also used to rebuild thumbnails after a restore). */
export async function makeThumb(full: Blob): Promise<Blob> {
  const bmp = await bitmapAtWidth(full, THUMB_WIDTH);
  try {
    return await encoderFor(bmp)(full.type === 'image/webp' ? 'image/webp' : 'image/jpeg', 0.7);
  } finally {
    bmp.close();
  }
}

export interface ProcessedPhoto { full: Blob; thumb: Blob; mime: 'image/webp' | 'image/jpeg'; sha256: string }

/**
 * Burns a one-line caption into the bottom of the picture (Removalist condition photos: date, job, box, stage).
 * Drawn on the 1600 px picture before it is encoded and hashed, so the stored file, its hash and every copy carry it.
 */
async function withCaption(bmp: ImageBitmap, caption: string): Promise<ImageBitmap> {
  const w = bmp.width, h = bmp.height;
  const bar = Math.max(28, Math.round(Math.min(w, h) * 0.06));
  const draw = (g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
    g.drawImage(bmp, 0, 0);
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fillRect(0, h - bar, w, bar);
    g.fillStyle = '#ffffff';
    g.font = `600 ${Math.round(bar * 0.55)}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(caption, Math.round(bar * 0.4), h - bar / 2, w - bar * 0.8);
  };
  let out: ImageBitmap;
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    draw(c.getContext('2d')!);
    out = await createImageBitmap(c);
  } else {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d')!);
    out = await createImageBitmap(c);
  }
  bmp.close();
  return out;
}

/** 1600 px photo (~200 KB) + 400 px thumbnail, plus the SHA-256 of the saved photo (for the Drive manifest). */
export async function processPhoto(file: Blob, opts: { caption?: string } = {}): Promise<ProcessedPhoto> {
  let fullBmp = await bitmapAtWidth(file, FULL_WIDTH);
  if (opts.caption) fullBmp = await withCaption(fullBmp, opts.caption);
  let full: Blob;

  try {
    full = await encodeWithin(encoderFor(fullBmp), MAX_PHOTO_BYTES);
  } finally {
    fullBmp.close();
  }
  const thumb = await makeThumb(full);
  const sha = new Uint8Array(await crypto.subtle.digest('SHA-256', await full.arrayBuffer()));
  return { full, thumb, mime: full.type === 'image/webp' ? 'image/webp' : 'image/jpeg', sha256: bytesToHex(sha) };
}
