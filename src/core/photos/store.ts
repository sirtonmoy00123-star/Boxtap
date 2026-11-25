// Photo files in the Origin Private File System, next to (not inside) the SQLite pool (ARCHITECTURE §4).
// Falls back to memory when OPFS is missing, matching the database fallback.
const DIR = 'boxtap-photos';
const memory = new Map<string, Blob>();

const flat = (name: string) => name.replace(/\//g, '_');

async function dir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR, { create: true });
  } catch {
    return null;
  }
}

export class StorageFullError extends Error { name = 'StorageFullError'; constructor() { super('This device is out of storage space'); } }

/** Writes a photo file. Throws StorageFullError on a full device (W5), and leaves no partial file behind. */
export async function writePhotoFile(name: string, blob: Blob): Promise<void> {
  const d = await dir();
  if (!d) { memory.set(name, blob); return; }
  const h = await d.getFileHandle(flat(name), { create: true });
  try {
    const w = await h.createWritable();
    try {
      await w.write(blob);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => {});
      throw e;
    }
  } catch (e) {
    await d.removeEntry(flat(name)).catch(() => {});
    if ((e as Error).name === 'QuotaExceededError') throw new StorageFullError();
    throw e;
  }
}

export async function readPhotoFile(name: string): Promise<Blob | null> {
  const d = await dir();
  if (!d) return memory.get(name) ?? null;
  try {
    return await (await d.getFileHandle(flat(name))).getFile();
  } catch {
    return null;
  }
}

export async function removePhotoFile(name: string): Promise<void> {
  const d = await dir();
  if (!d) { memory.delete(name); return; }
  await d.removeEntry(flat(name)).catch(() => {});
}

/** Self-check step 4 (DATABASE_SCHEMA §5): delete files no photo row points at. */
export async function removeOrphans(known: ReadonlySet<string>): Promise<number> {
  const d = await dir();
  if (!d) return 0;
  let n = 0;
  const keep = new Set([...known].map(flat));
  for await (const [entry] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (!keep.has(entry)) { await d.removeEntry(entry).catch(() => {}); n++; }
  }
  return n;
}
