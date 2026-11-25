// Backup payload container. Ruling (build): a simple length-prefixed container instead of zip
// (API_CONTRACTS §6 says zip). It streams, needs no library, and the payload is encrypted anyway.
// Format: "BTPK1" | repeated [u16 name length][name UTF-8][u32 data length][data] | u16 0 (end)
import { fromUtf8, utf8 } from '../util/encoding';

export interface Entry { name: string; data: Uint8Array }

const MAGIC = utf8('BTPK1');
const NAME_OK = /^[A-Za-z0-9_][A-Za-z0-9_.\-/]{0,199}$/;
const okName = (n: string) => NAME_OK.test(n) && !n.split('/').some((p) => p === '..' || p === '.' || p === '');

export async function* pack(entries: Iterable<Entry> | AsyncIterable<Entry>): AsyncGenerator<Uint8Array> {
  yield MAGIC;
  for await (const e of entries) {
    const name = utf8(e.name);
    const head = new Uint8Array(2 + name.length + 4);
    const v = new DataView(head.buffer);
    v.setUint16(0, name.length);
    head.set(name, 2);
    v.setUint32(2 + name.length, e.data.length);
    yield head;
    yield e.data;
  }
  yield new Uint8Array(2); // end marker
}

export async function unpack(bytes: Uint8Array): Promise<Entry[]> {
  if (fromUtf8(bytes.subarray(0, 5)) !== 'BTPK1') throw new Error('not a BoxTap backup payload');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Entry[] = [];
  let off = 5;
  for (;;) {
    if (off + 2 > bytes.length) throw new Error('backup payload is cut short');
    const nl = v.getUint16(off);
    off += 2;
    if (nl === 0) return out;
    if (off + nl + 4 > bytes.length) throw new Error('backup payload is cut short');
    const name = fromUtf8(bytes.subarray(off, off + nl));
    if (!okName(name)) throw new Error(`bad entry name in backup`);
    off += nl;
    const dl = v.getUint32(off);
    off += 4;
    if (off + dl > bytes.length) throw new Error('backup payload is cut short');
    out.push({ name, data: bytes.slice(off, off + dl) });
    off += dl;
  }
}

/**
 * Streaming unpack: parses entries as chunks arrive and hands each complete entry to onEntry. Each entry is filled
 * into one buffer of its own size, so memory stays at about one entry plus one chunk.
 */
export async function unpackStream(chunks: AsyncIterable<Uint8Array>, onEntry: (e: Entry) => Promise<void>): Promise<void> {
  let head = new Uint8Array(0); // bytes of the magic or an entry header still being assembled (small)
  let started = false;
  let done = false;
  let entry: { name: string; data: Uint8Array; fill: number } | null = null;

  const feed = async (c: Uint8Array) => {
    let off = 0;
    while (off < c.length && !done) {
      if (entry) {
        const n = Math.min(entry.data.length - entry.fill, c.length - off);
        entry.data.set(c.subarray(off, off + n), entry.fill);
        entry.fill += n;
        off += n;
        if (entry.fill === entry.data.length) { const e = entry; entry = null; await onEntry({ name: e.name, data: e.data }); }
        continue;
      }
      // Assemble a small header in 'head' one byte at a time from this chunk.
      const h = new Uint8Array(head.length + 1);
      h.set(head);
      h[head.length] = c[off]!;
      head = h;
      off++;
      if (!started) {
        if (head.length === 5) {
          if (fromUtf8(head) !== 'BTPK1') throw new Error('not a BoxTap backup payload');
          started = true;
          head = new Uint8Array(0);
        }
        continue;
      }
      if (head.length < 2) continue;
      const nl = new DataView(head.buffer).getUint16(0);
      if (nl === 0) { done = true; return; }
      if (head.length < 2 + nl + 4) continue;
      const name = fromUtf8(head.subarray(2, 2 + nl));
      if (!okName(name)) throw new Error('bad entry name in backup');
      const size = new DataView(head.buffer).getUint32(2 + nl);
      head = new Uint8Array(0);
      entry = { name, data: new Uint8Array(size), fill: 0 };
      if (size === 0) { entry = null; await onEntry({ name, data: new Uint8Array(0) }); }
    }
  };
  for await (const c of chunks) {
    await feed(c);
    if (done) return;
  }
  if (!done) throw new Error('backup payload is cut short');
}
