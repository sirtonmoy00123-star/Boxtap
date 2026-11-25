import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openDb, type Db } from '../core/db/client';
import { tryAcquire, takeOver, type TabLock } from '../core/pwa/tabLock';
import { requestPersistence, storageStatus, type StorageStatus } from '../core/pwa/storage';
import type { Workspace } from '../core/repo';
import { AppContext, makeT, type AppState } from './context';
import { useRoute } from './router';
import { Banner, Button } from './ui';
import { Start } from './screens/Start';
import { Home } from './screens/Home';
import { BoxPage } from './screens/BoxPage';
import { Bin, LabelRoute, NoDataLabel, Upgrade } from './screens/Misc';
import { Settings } from './screens/Backup';
import { PrintLabels, Scan } from './screens/ScanLabels';
import { ItemPage, LowStockPage } from './screens/Seller';
import { CataloguePage } from './screens/Catalogue';
import { OrderPage, OrdersPage, ReportsPage } from './screens/Pro';
import { startSchedule } from '../core/drive/browserSync';
import { adoptRedirectToken } from '../core/drive/googleAuth';
import { removeOrphans, removePhotoFile } from '../core/photos/store';
import type { Lang } from '../i18n/i18n';

type Boot =
  | { s: 'loading' }
  | { s: 'otherTab' }
  | { s: 'lost' }
  | { s: 'failed'; msg: string }
  | { s: 'ready'; db: Db; workspaces: Workspace[] };

const WS_KEY = 'boxtap.currentWorkspace'; // only an id, never user text
const guessLang = (): Lang => (navigator.language?.startsWith('bn') ? 'bn' : 'en');

export function App() {
  const [boot, setBoot] = useState<Boot>({ s: 'loading' });
  const [workspace, setWorkspaceState] = useState<Workspace | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const lockRef = useRef<TabLock | null>(null);
  const toastRef = useRef<((m: string) => void) | null>(null);
  const route = useRoute();

  const start = useCallback(async (db: Db, lock: TabLock) => {
    lockRef.current = lock;
    void lock.lost.then(async () => {
      await db.close().catch(() => {});
      setBoot({ s: 'lost' });
    });
    const workspaces = await db.listWorkspaces();
    const saved = localStorage.getItem(WS_KEY);
    setWorkspaceState(workspaces.find((w) => w.id === saved) ?? workspaces[0] ?? null);
    setBoot({ s: 'ready', db, workspaces });
    // Daily self-checks (DATABASE_SCHEMA §5): integrity, ledger totals, bin purge, orphan photo files.
    void db.dailyCheck()
      .then(async (r) => {
        if (!r.ran) return;
        if (!r.integrityOk || r.ledgerRepaired) console.warn('self-check', r);
        if (!r.integrityOk) toastRef.current?.(makeT(guessLang())('check.failed'));
        await Promise.all(r.deleteFiles.map((f) => removePhotoFile(f)));
        await removeOrphans(new Set(r.keepFiles));
      })
      .catch((e) => console.warn('self-check failed', e));
    void requestPersistence().then(() => storageStatus()).then(setStorage);
  }, []);

  const bootUp = useCallback(async (steal: boolean) => {
    setBoot({ s: 'loading' });
    try {
      if (steal) {
        let db!: Db;
        const lock = await takeOver(async () => { db = await openDb(false); });
        await start(db, lock);
        return;
      }
      const lock = await tryAcquire(false);
      if (!lock) { setBoot({ s: 'otherTab' }); return; }
      await start(await openDb(), lock);
    } catch (e) {
      setBoot({ s: 'failed', msg: (e as Error).message });
    }
  }, [start]);

  useEffect(() => { void bootUp(false); }, [bootUp]);

  // Back from the full-page Google sign-in (audit B17): take the token into memory, tell the user what happened.
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('drive');
    const adopted = adoptRedirectToken();
    if (!q) return;
    history.replaceState(null, '', location.pathname);
    const lang = guessLang();
    setTimeout(() => toastRef.current?.(makeT(lang)(adopted ? 'drive.signedIn' : 'drive.signInFailed')), 800);
  }, []);

  // Drive backup runs only in the tab that owns the database, and only while the app is open (ADR-020).
  const readyDb = boot.s === 'ready' ? boot.db : null;
  useEffect(() => {
    if (!readyDb || !workspace) return;
    return startSchedule(readyDb, (o) => { if (o !== 'uploaded' && o !== 'up_to_date') console.info('drive backup:', o); });
  }, [readyDb, workspace]);

  const lang: Lang = workspace?.language ?? guessLang();
  const t = useMemo(() => makeT(lang), [lang]);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg(null), m.length > 60 ? 6000 : 2500);
  }, []);
  useEffect(() => { toastRef.current = toast; }, [toast]);

  // Any error nobody caught still tells the user something (review finding 14).
  useEffect(() => {
    const onError = (e: PromiseRejectionEvent) => {
      const msg = (e.reason as Error)?.message ?? String(e.reason);
      console.error(e.reason);
      toastRef.current?.(t('error.unexpected', { msg }));
    };
    window.addEventListener('unhandledrejection', onError);
    return () => window.removeEventListener('unhandledrejection', onError);
  }, [t]);
  const [shareFile, setShareFile] = useState<File | null>(null);
  useEffect(() => {
    const on = (e: Event) => setShareFile((e as CustomEvent<File>).detail);
    window.addEventListener('boxtap:share-file', on);
    return () => window.removeEventListener('boxtap:share-file', on);
  }, []);

  if (boot.s !== 'ready') {
    const msg = { loading: t('boot.loading'), otherTab: t('boot.otherTab'), lost: t('boot.lost'), failed: t('boot.failed') }[boot.s];
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center" data-boot={boot.s}>
        <p className="text-lg">{msg}</p>
        {boot.s === 'failed' && <p className="text-sm text-slate-500">{boot.msg}</p>}
        {(boot.s === 'otherTab' || boot.s === 'lost') && (
          <Button onClick={() => bootUp(true)}>{boot.s === 'otherTab' ? t('boot.useHere') : t('boot.reload')}</Button>
        )}
      </div>
    );
  }

  const state: AppState = {
    db: boot.db, workspace, lang, t, toast,
    setWorkspace: (w) => {
      setWorkspaceState(w);
      if (w) localStorage.setItem(WS_KEY, w.id); else localStorage.removeItem(WS_KEY);
    },
    showUpgrade: setUpgrade,
  };

  let screen;
  if (!workspace) screen = route.name === 'label' ? <NoDataLabel /> : <Start />;
  else if (route.name === 'box') screen = <BoxPage id={route.id} />;
  else if (route.name === 'item') screen = <ItemPage id={route.id} />;
  else if (route.name === 'low') screen = <LowStockPage />;
  else if (route.name === 'catalogue') screen = <CataloguePage />;
  else if (route.name === 'reports') screen = <ReportsPage />;
  else if (route.name === 'orders') screen = <OrdersPage />;
  else if (route.name === 'order') screen = <OrderPage id={route.id} />;
  else if (route.name === 'bin') screen = <Bin />;
  else if (route.name === 'settings') screen = <Settings />;
  else if (route.name === 'scan') screen = <Scan />;
  else if (route.name === 'labels') screen = <PrintLabels />;
  else if (route.name === 'label') screen = <LabelRoute code={route.code} />;
  else screen = <Home />;

  return (
    <AppContext.Provider value={state}>
      {!boot.db.info.persistent && <Banner tone="danger">{t('banner.memory')}</Banner>}
      {boot.db.info.persistent && storage?.likelyPrivate && <Banner tone="danger">{t('banner.private')}</Banner>}
      {boot.db.info.persistent && storage && !storage.likelyPrivate && !storage.persisted && workspace && <Banner>{t('banner.notPersisted')}</Banner>}
      {screen}
      {upgrade && <Upgrade reason={upgrade} onClose={() => setUpgrade(null)} />}
      {shareFile && (
        <div role="dialog" aria-label={t('share.ready')} className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 bg-white p-4 shadow-2xl" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <p className="font-medium">{t('share.ready')}: {shareFile.name}</p>
          <Button onClick={async () => { const f = shareFile; setShareFile(null); await navigator.share({ files: [f], title: f.name }).catch(() => {}); }}>{t('share.now')}</Button>
          <Button variant="ghost" onClick={() => setShareFile(null)}>{t('upgrade.later')}</Button>
        </div>
      )}
      {toastMsg && <div role="status" className="fixed inset-x-0 bottom-24 mx-auto w-fit rounded-full bg-slate-900 px-4 py-2 text-white">{toastMsg}</div>}
    </AppContext.Provider>
  );
}
