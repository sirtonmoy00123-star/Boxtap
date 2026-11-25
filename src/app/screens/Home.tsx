import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Page, inputClass } from '../ui';
import { WorkerError } from '../../core/db/client';
import type { Box, SearchHit } from '../../core/repo';
import { shouldOfferInstall } from '../../core/pwa/install';
import { InstallGuide } from './Install';

const WEEK = 7 * 24 * 3600 * 1000;

export function Home() {
  const { db, workspace, t, showUpgrade } = useApp();
  const ws = workspace!;
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [guide, setGuide] = useState(false);
  const [persisted, setPersisted] = useState(true);
  const [backup, setBackup] = useState<{ last: string | null; drive: boolean; overAWeek: boolean } | null>(null);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
    void (async () => {
      const file = (await db.backupState())?.last_backup_at;
      const link = await db.getDriveLink();
      const times = [file ? String(file) : null, link?.lastSnapshotAt ?? null].filter((x): x is string => !!x).sort();
      const last = times.at(-1) ?? null;
      const since = Date.parse(last ?? ws.createdAt);
      setBackup({ last, drive: !!link, overAWeek: Date.now() - since > WEEK });
    })();
  }, [db, ws.createdAt]);

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

  const createBox = async () => {
    try {
      const b = await db.createBox(ws.id, {});
      navigate(`/box/${b.id}`);
    } catch (e) {
      if (e instanceof WorkerError && e.reason) showUpgrade(e.reason);
      else throw e;
    }
  };
  // Ask to install before the 5th box (iPhone always; Android/desktop while storage isn't protected; B14).
  const addBox = () => {
    if (boxes && shouldOfferInstall(boxes.length, persisted)) setGuide(true);
    else void createBox();
  };
  // ADR-016: without Drive, nudge a file backup after 7 days.
  const backupDue = backup && !backup.drive && (boxes?.length ?? 0) > 0 && backup.overAWeek;

  return (
    <Page title={ws.name} actions={<><Button variant="ghost" onClick={() => navigate('/bin')}>{t('home.bin')}</Button><Button variant="ghost" onClick={() => navigate('/settings')}>{t('settings.title')}</Button></>}>
      {backupDue && (
        <div role="status" className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <span>{t('home.backupDue')}</span>
          <Button variant="secondary" onClick={() => navigate('/settings')}>{t('home.backupNow')}</Button>
        </div>
      )}
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
      {backup && (boxes?.length ?? 0) > 0 && (
        <p className="mt-4 text-center text-xs text-slate-500" data-testid="home-last-backup">
          {backup.last ? t('home.lastBackup', { when: new Date(backup.last).toLocaleDateString() }) : t('home.neverBackedUp')}
        </p>
      )}
      {guide && <InstallGuide onClose={() => { setGuide(false); void createBox(); }} />}
      <div className="fixed inset-x-0 bottom-0 flex justify-center gap-3 bg-white/95 p-4">
        <Button variant="secondary" onClick={() => navigate('/scan')} className="flex-1 max-w-40">{t('home.scan')}</Button>
        <Button onClick={addBox} className="flex-1 max-w-40">{t('home.addBox')}</Button>
      </div>
    </Page>
  );
}
