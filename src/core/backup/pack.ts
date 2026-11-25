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
