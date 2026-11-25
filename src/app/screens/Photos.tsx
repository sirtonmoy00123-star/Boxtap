import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { Button } from '../ui';
import { WorkerError } from '../../core/db/client';
import { addPhotoFromFile, photoUrl } from '../../core/photos/save';
import { StorageFullError } from '../../core/photos/store';
import type { Photo } from '../../core/repo';

interface Shown { photo: Photo; thumb: string | null }

/** Photos of one box (or item): add from camera or gallery, view, delete. */
export function PhotoStrip({ workspaceId, parent }: { workspaceId: string; parent: { locationId?: string; itemId?: string } }) {
  const { db, t, showUpgrade, toast } = useApp();
  const [shown, setShown] = useState<Shown[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ photo: Photo; url: string | null } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  const load = useCallback(async () => {
    const list = await db.listPhotos(parent);
    const next = await Promise.all(list.map(async (photo) => ({ photo, thumb: await photoUrl(photo.thumbName) })));
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = next.map((s) => s.thumb).filter((u): u is string => !!u);
    setShown(next);
  }, [db, parent.locationId, parent.itemId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); return () => urls.current.forEach((u) => URL.revokeObjectURL(u)); }, [load]);

  const add = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await addPhotoFromFile(db, workspaceId, parent, file);
      await load();
    } catch (e) {
      if (e instanceof WorkerError && e.reason) showUpgrade(e.reason);
      else if (e instanceof StorageFullError) toast(t('photos.full'));
      else toast(t('error.generic', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const view = async (photo: Photo) => setOpen({ photo, url: await photoUrl(photo.fileName) });
  const remove = async () => {
    if (!open) return;
    await db.deletePhoto(open.photo.id);
    if (open.url) URL.revokeObjectURL(open.url);
    setOpen(null);
    await load();
  };
  const missingText = (p: Photo) => (p.driveFileId ? t('photos.downloading') : t('photos.notBackedUp'));

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">{t('photos.title')}</h2>
      {shown.length === 0 && <p className="text-sm text-slate-500">{t('photos.none')}</p>}
      <ul className="mt-2 grid grid-cols-3 gap-2" aria-label="photos">
        {shown.map(({ photo, thumb }) => (
          <li key={photo.id}>
            <button type="button" onClick={() => void view(photo)} className="block aspect-square w-full overflow-hidden rounded-xl bg-slate-100" aria-label={t('photos.title')}>
              {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center p-1 text-center text-xs text-slate-500">{missingText(photo)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {/* No `capture` attribute: phones then offer both the camera and the photo library. */}
      <input ref={input} type="file" accept="image/*" className="sr-only" aria-label={t('photos.add')} onChange={(e) => void add(e.target.files?.[0])} />
      <Button variant="secondary" className="mt-2 w-full" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t('photos.adding') : t('photos.add')}
      </Button>

      {open && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4">
          <div className="flex flex-1 items-center justify-center">
            {open.url ? <img src={open.url} alt="" className="max-h-full max-w-full rounded-lg" /> : <p className="text-white">{missingText(open.photo)}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1" onClick={() => void remove()}>{t('photos.delete')}</Button>
            <Button variant="secondary" className="flex-1" onClick={() => { if (open.url) URL.revokeObjectURL(open.url); setOpen(null); }}>{t('photos.close')}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
