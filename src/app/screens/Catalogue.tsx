import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Page } from '../ui';
import { pickCatalogueItems, CATALOGUE_MAX } from '../../core/catalogue/layout';
import { renderCatalogue } from '../../core/catalogue/render';
import { readPhotoFile } from '../../core/photos/store';
import { deliverFile } from '../../core/backup/backupFile';
import type { CatalogueCandidate } from '../../core/repo';

/** /catalogue (whole shop) or /catalogue?box=<id>: pick items, preview, share as one picture (ADR-015). */
export function CataloguePage() {
  const { db, workspace, t, toast, showUpgrade } = useApp();
  const ws = workspace!;
  const boxId = new URLSearchParams(location.search).get('box') ?? undefined;
  const [items, setItems] = useState<CatalogueCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const ok = await db.check('catalogue_image', ws.id);
      if (!ok.allowed) { showUpgrade(ok.reason); navigate('/', true); return; }
      const all = (await db.catalogueCandidates(ws.id, boxId)).filter((c) => c.available > 0 && c.photoFile);
      setItems(all);
      setPicked(new Set(pickCatalogueItems(all.map((c) => ({ ...c, id: c.itemId, hasPhoto: true }))).map((c) => c.itemId)));
    })();
  }, [db, ws.id, boxId, showUpgrade]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else if (next.size < CATALOGUE_MAX) next.add(id);
    setPicked(next);
    setPreview(null);
  };

  const make = async () => {
    if (!items) return;
    setBusy(true);
    try {
      const chosen = items.filter((c) => picked.has(c.itemId));
      const entries = [];
      for (const c of chosen) {
        const photo = c.photoFile ? await readPhotoFile(c.photoFile) : null;
        if (photo) entries.push({ name: c.name, available: c.available, priceMinor: c.salePriceMinor, photo });
      }
      const blob = await renderCatalogue(entries, ws.currency, {
        title: ws.name,
        subtitle: t('cat.subtitle', { date: new Date().toLocaleDateString(ws.language === 'bn' ? 'bn-BD' : 'en-AU') }),
        inStock: (n) => t('cat.inStock', { n }),
      });
      setPreview({ url: URL.createObjectURL(blob), blob });
    } catch (e) {
      toast(t('error.generic', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    if (!preview) return;
    const date = new Date().toISOString().slice(0, 10);
    await deliverFile(new File([preview.blob], `in-stock-${date}.jpg`, { type: 'image/jpeg' }));
  };

  return (
    <Page title={t('cat.title')} back={() => (boxId ? navigate(`/box/${boxId}`) : navigate('/'))}>
      {items?.length === 0 && <p className="py-10 text-center text-text-2">{t('cat.none')}</p>}
      {!!items?.length && (
        <>
          <p className="text-subhead text-text-2">{t('cat.pick')}</p>
          <ul className="mt-2 divide-y divide-separator" aria-label="catalogue items">
            {items.map((c) => (
              <li key={c.itemId}>
                <label className="flex min-h-12 items-center gap-3">
                  <input type="checkbox" className="h-5 w-5" checked={picked.has(c.itemId)} onChange={() => toggle(c.itemId)} />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-subhead text-text-2">{t('cat.inStock', { n: c.available })}</span>
                </label>
              </li>
            ))}
          </ul>
          <Button className="mt-3 w-full" disabled={busy || picked.size === 0} onClick={() => void make()}>{t('cat.make')}</Button>
        </>
      )}
      {preview && (
        <div className="mt-4">
          <img src={preview.url} alt={t('cat.title')} className="w-full rounded-md border border-separator" />
          <Button className="mt-3 w-full" onClick={() => void share()}>{t('cat.send')}</Button>
        </div>
      )}
    </Page>
  );
}
