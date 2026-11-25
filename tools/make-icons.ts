// Generates placeholder app icons (blue tile with a white box outline). Replace with real artwork later.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function png(size: number): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const inBox = (x: number, y: number) => {
    const m = size * 0.25, w = size * 0.07;
    const lx = x >= m && x <= size - m, ly = y >= m && y <= size - m;
    const edge = (Math.abs(x - m) < w || Math.abs(x - (size - m)) < w) && ly
      || (Math.abs(y - m) < w || Math.abs(y - (size - m)) < w || Math.abs(y - size * 0.42) < w / 2) && lx;
    return edge;
  };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const white = inBox(x, y);
      raw[o] = white ? 255 : 29; raw[o + 1] = white ? 255 : 78; raw[o + 2] = white ? 255 : 216; raw[o + 3] = 255;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('public/icons', { recursive: true });
for (const s of [192, 512]) writeFileSync(`public/icons/icon-${s}.png`, png(s));
console.log('icons written');
