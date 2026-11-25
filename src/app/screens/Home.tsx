import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Page, inputClass } from '../ui';
import { WorkerError } from '../../core/db/client';
import type { Box, SearchHit } from '../../core/repo';

export function Home() {
  const { db, workspace, t, showUpgrade } = useApp();
  const ws = workspace!;
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  const load = useCallback(async () => {
    const list = await db.listBoxes(ws.id);
    setBoxes(list);
    const entries = await Promise.all(list.map(async (b) => [b.id, (await db.listItems(b.id)).length] as const));
    setItemCounts(Object.fromEntries(entries));
  }, [db, ws.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!q.trim()) return;
    let live = true;
    const id = setTimeout(() => { void db.search(ws.id, q).then((h) => { if (live) setHits(h); }); }, 120);
    return () => { live = false; clearTimeout(id); };
  }, [db, ws.id, q]);

  const addBox = async () => {
    try {
      const b = await db.createBox(ws.id, {});
      navigate(`/box/${b.id}`);
    } catch (e) {
      if (e instanceof WorkerError && e.reason) showUpgrade(e.reason);
      else throw e;
    }
  };

  return (
    <Page title={ws.name} actions={<><Button variant="ghost" onClick={() => navigate('/bin')}>{t('home.bin')}</Button><Button variant="ghost" onClick={() => navigate('/settings')}>{t('settings.title')}</Button></>}>
      <input type="search" className={inputClass} placeholder={t('home.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('home.search')} />
      {q.trim() && hits ? (
        <ul className="mt-3 divide-y" aria-label="results">
          {hits.length === 0 && <li className="py-6 text-center text-slate-500">{t('home.noResults')}</li>}
          {hits.map((h) => (
            <li key={h.itemId}>
              <button type="button" className="flex w-full justify-between py-3 text-left" onClick={() => navigate(`/box/${h.boxId}`)}>
                <span>{h.itemName}</span>
                <span className="text-slate-500">{t('box.title', { n: h.boxNumber })}{h.boxName ? ` · ${h.boxName}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 divide-y" aria-label="boxes">
          {boxes?.length === 0 && <li className="py-10 text-center text-slate-500">{t('home.empty')}</li>}
          {boxes?.map((b) => (
            <li key={b.id}>
              <button type="button" className="flex w-full items-center gap-3 py-3 text-left" onClick={() => navigate(`/box/${b.id}`)}>
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-blue-100 font-bold text-blue-900">{b.number}</span>
                <span className="flex-1">
                  <span className="block font-medium">{b.name || t('box.title', { n: b.number })}</span>
                  <span className="text-sm text-slate-500">{t('home.items', { n: itemCounts[b.id] ?? 0 })}{b.isFragile ? ` · ${t('box.fragile')}` : ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="fixed inset-x-0 bottom-0 flex justify-center gap-3 bg-white/95 p-4">
        <Button onClick={addBox} className="flex-1 max-w-xs">{t('home.addBox')}</Button>
      </div>
    </Page>
  );
}
