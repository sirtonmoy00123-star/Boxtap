import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Page, inputClass } from '../ui';
import { WorkerError } from '../../core/db/client';
import { DEFAULT_CONFIG } from '../../core/licensing/can';
import type { BinBox, BinItem, Box } from '../../core/repo';
import type { Key } from '../../i18n/i18n';

export function Bin() {
  const { db, workspace, t, showUpgrade } = useApp();
  const [bin, setBin] = useState<{ boxes: BinBox[]; items: BinItem[] } | null>(null);
  const load = () => db.listBin(workspace!.id).then(setBin);
  useEffect(() => { void db.listBin(workspace!.id).then(setBin); }, [db, workspace]);
  const restore = async (fn: () => Promise<void>) => {
    try { await fn(); await load(); } catch (e) {
      if (e instanceof WorkerError && e.reason) showUpgrade(e.reason); else throw e;
    }
  };
  const empty = bin && bin.boxes.length === 0 && bin.items.length === 0;
  return (
    <Page title={t('bin.title')} back={() => navigate('/')}>
      <p className="text-sm text-slate-500">{t('bin.hint')}</p>
      {empty && <p className="py-10 text-center text-slate-500">{t('bin.empty')}</p>}
      <ul className="divide-y">
        {bin?.boxes.map((b) => (
          <li key={b.id} className="flex items-center justify-between py-2">
            <span>{b.name || t('box.title', { n: b.number })}</span>
            <Button variant="secondary" onClick={() => restore(() => db.restoreBox(b.id))}>{t('bin.restore')}</Button>
          </li>
        ))}
        {bin?.items.map((i) => (
          <li key={i.id} className="flex items-center justify-between py-2">
            <span>{i.name} <span className="text-slate-500">· {t('box.title', { n: i.boxNumber })}</span></span>
            <Button variant="secondary" onClick={() => restore(() => db.restoreItem(i.id))}>{t('bin.restore')}</Button>
          </li>
        ))}
      </ul>
    </Page>
  );
}

/** /b/:code opened from a camera app or link (API_CONTRACTS §5). Shows nothing about the code otherwise. */
export function LabelRoute({ code }: { code: string }) {
  const { db, workspace, setWorkspace, t, toast } = useApp();
  const [state, setState] = useState<'looking' | 'notMine' | 'spare'>('looking');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [target, setTarget] = useState('');
  const c = code.toUpperCase();
  useEffect(() => {
    let live = true;
    void (async () => {
      const st = await db.labelStatus(c);
      if (!live) return;
      if (st.kind === 'unknown') { setState('notMine'); return; }
      // A label of another list on this phone: open that list (lists are never mixed, but they share the phone).
      if (st.workspaceId !== workspace?.id) {
        const other = await db.getWorkspace(st.workspaceId);
        if (!other) { setState('notMine'); return; }
        setWorkspace(other);
      }
      if (st.kind === 'box') { navigate(`/box/${st.boxId}`, true); return; }
      setBoxes(await db.listBoxes(st.workspaceId));
      setState('spare');
    })();
    return () => { live = false; };
  }, [db, c, workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- setWorkspace changes identity every render
  if (state === 'looking') return null;
  if (state === 'spare') {
    const stick = async (boxId: string) => {
      await db.assignLabel(c, boxId);
      toast(t('spare.done'));
      navigate(`/box/${boxId}`, true);
    };
    const newBox = async () => {
      try {
        const b = await db.createBox(workspace!.id, {});
        await stick(b.id);
      } catch (e) {
        toast(t('error.generic', { msg: (e as Error).message }));
      }
    };
    return (
      <Page title={t('spare.title')} back={() => navigate('/')}>
        <p className="py-2">{t('spare.explain')}</p>
        <select className={inputClass} aria-label={t('spare.pick')} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t('spare.pick')}</option>
          {boxes.map((b) => <option key={b.id} value={b.id}>{t('box.title', { n: b.number })}{b.name ? ` · ${b.name}` : ''}</option>)}
        </select>
        <Button className="mt-2 w-full" disabled={!target} onClick={() => void stick(target)}>{t('spare.stick')}</Button>
        <Button variant="secondary" className="mt-2 w-full" onClick={() => void newBox()}>{t('spare.newBox')}</Button>
      </Page>
    );
  }
  return (
    <Page title={t('label.notMine')} back={() => navigate('/')}>
      <p className="py-6">{t('label.notMine')}</p>
    </Page>
  );
}

/** Shown when the browser holds no BoxTap data at all. */
export function NoDataLabel() {
  const { t } = useApp();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{t('label.noData')}</h1>
      <Button onClick={() => navigate('/', true)}>{t('label.openApp')}</Button>
    </div>
  );
}

export function Upgrade({ reason, onClose }: { reason: string; onClose: () => void }) {
  const { t } = useApp();
  const limits = DEFAULT_CONFIG.free_limits;
  const n = reason === 'limit_boxes' ? limits.home_boxes : limits.seller_items;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="upgrade-title" className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <h2 id="upgrade-title" className="text-xl font-semibold">{t('upgrade.title')}</h2>
        <p className="mt-2" data-testid="upgrade-reason">{t(`upgrade.${reason}` as Key, { n })}</p>
        <p className="mt-2">{t('upgrade.movePass')}</p>
        <p className="mt-3 text-sm text-slate-600">{t('upgrade.never')}</p>
        <Button variant="secondary" className="mt-4 w-full" onClick={onClose}>{t('upgrade.later')}</Button>
      </div>
    </div>
  );
}
