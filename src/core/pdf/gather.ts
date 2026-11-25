// Collects the boxes, items and photos of a Home workspace for the list PDFs (browser only: reads photo files).
import type { Db } from '../db/client';
import { readPhotoFile } from '../photos/store';
import type { ListBox } from './lists';

/** pdf-lib embeds only JPEG and PNG, so thumbnails (often WebP) are redrawn as small JPEGs. */
async function asJpeg(name: string | undefined): Promise<Uint8Array | null> {
  if (!name) return null;
  const blob = await readPhotoFile(name);
  if (!blob) return null;
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.8));
    return out ? new Uint8Array(await out.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function gatherListBoxes(db: Db, workspaceId: string, withPhotos: boolean): Promise<ListBox[]> {
  const rooms = new Map((await db.listRooms(workspaceId)).map((r) => [r.id, r.name]));
  const out: ListBox[] = [];
  for (const b of await db.listBoxes(workspaceId)) {
    const items = await db.listItems(b.id);
    const thumbs = withPhotos ? await db.itemThumbs(b.id) : {};
    const boxPhoto = withPhotos ? (await db.listPhotos({ locationId: b.id }))[0] : undefined;
    out.push({
      number: b.number, name: b.name, room: b.roomId ? rooms.get(b.roomId) ?? null : null,
      fragile: b.isFragile, openFirst: b.openFirst, moveStatus: b.moveStatus,
      photo: await asJpeg(boxPhoto?.thumbName ?? Object.values(thumbs)[0]?.thumbName),
      items: await Promise.all(items.map(async (i) => ({ name: i.name, valueMinor: i.valueEstimateMinor, photo: null }))),
    });
  }
  return out;
}
