import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { labelUrl, newLabelCode, parseLabelUrl } from '../repo/labels';

const require = createRequire(import.meta.url);
prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')).buffer as ArrayBuffer } });

/** Renders the same module matrix the label PDF draws into RGBA pixels. */
function render(text: string, scale = 6) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size + 4;
  const w = n * scale;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < qr.modules.size; y++) for (let x = 0; x < qr.modules.size; x++) {
    if (!qr.modules.get(y, x)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const o = (((y + 2) * scale + dy) * w + (x + 2) * scale + dx) * 4;
      data[o] = data[o + 1] = data[o + 2] = 0;
    }
  }
  return { data, width: w, height: w, colorSpace: 'srgb' } as ImageData;
}

describe('label QR codes', () => {
  it('decode with the in-app decoder (zxing) back to a code the scanner accepts', async () => {
    for (let i = 0; i < 5; i++) {
      const code = newLabelCode();
      const [hit] = await readBarcodes(render(labelUrl(code)), { formats: ['QRCode'] });
      expect(hit?.text).toBe(labelUrl(code));
      expect(parseLabelUrl(hit!.text)).toBe(code);
    }
  });
});
