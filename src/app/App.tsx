import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openDb, rescueExport, type Db } from '../core/db/client';
import { deliverFile } from '../core/backup/backupFile';
import { tryAcquire, takeOver, type TabLock } from '../core/pwa/tabLock';
import { requestPersistence, storageStatus, type StorageStatus } from '../core/pwa/storage';
import type { Workspace } from '../core/repo';
import { AppContext, makeDate, makeNum, makeT, type AppState, type ToastAction } from './context';
import { navigate, useRoute } from './router';
import { Banner, Button, TabBar, type Tab } from './ui';
import { Bookmark, DoorOpen, Package, Settings as SettingsIcon, Truck } from 'lucide-react';
import { platform } from '../core/pwa/install';
import { RoomPage, RoomsPage } from './screens/Rooms';
import { BookedPage } from './screens/Booked';
import { Start } from './screens/Start';
import { Home } from './screens/Home';
import { BoxPage } from './screens/BoxPage';
import { Bin, LabelRoute, NoDataLabel, Upgrade } from './screens/Misc';
import { Settings } from './screens/Backup';
import { PrintLabels, Scan } from './screens/ScanLabels';
import { ItemPage, LowStockPage } from './screens/Seller';
import { CataloguePage } from './screens/Catalogue';
import { OrderPage, OrdersPage, ReportsPage } from './screens/Pro';
import { JobForm, JobPage, JobsPage } from './screens/removalist/Jobs';
import { BusinessPage, TrucksPage, VolumeCataloguePage } from './screens/removalist/Settings';
import { AddRemovalistPage } from './screens/removalist/AddRemovalist';
import { JobLabelsPage } from './screens/removalist/Pieces';
import { LoadCheckPage, ScanJobPicker } from './screens/removalist/LoadCheck';
import { ConditionPiecePage, ConditionStagePage } from './screens/removalist/Condition';
import { SignOffPage } from './screens/removalist/SignOff';
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
  const [toastMsg, setToastMsg] = useState<{ msg: string; action?: ToastAction; id: number } | null>(null);
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
  const num = useMemo(() => makeNum(lang), [lang]);
  const date = useMemo(() => makeDate(lang), [lang]);

  // Seller accent (indigo) via data-mode on <html>; the page language drives :lang(bn) and screen readers;
  // the platform decides whether the tab bar may blur (iPhone only, DESIGN_SYSTEM §7).
  const mode = workspace?.type;
  useEffect(() => {
    const el = document.documentElement;
    if (mode === 'seller' || mode === 'removalist') el.dataset.mode = mode; else delete el.dataset.mode;
    el.lang = lang;
    el.dataset.platform = platform();
  }, [mode, lang]);

  const toast = useCallback((m: string, action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToastMsg({ msg: m, action, id });
    setTimeout(() => setToastMsg((cur) => (cur?.id === id ? null : cur)), action ? 5000 : m.length > 60 ? 6000 : 2500);
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
        <p className="text-headline">{msg}</p>
        {boot.s === 'failed' && <p className="text-subhead text-text-2">{boot.msg}</p>}
        {boot.s === 'failed' && (
          <>
            <p className="text-subhead">{t('rescue.explain')}</p>
            <Button variant="secondary" onClick={async () => {
              try {
                const bytes = await rescueExport();
                const stamp = new Date().toISOString().slice(0, 10);
                await deliverFile(new File([new Uint8Array(bytes)], `BoxTap-rescue-${stamp}.sqlite3`, { type: 'application/octet-stream' }));
              } catch (e) {
                alert(t('error.generic', { msg: (e as Error).message }));
              }
            }}>{t('rescue.save')}</Button>
            <Button variant="ghost" onClick={() => location.reload()}>{t('rescue.retry')}</Button>
          </>
        )}
        {(boot.s === 'otherTab' || boot.s === 'lost') && (
          <Button onClick={() => bootUp(true)}>{boot.s === 'otherTab' ? t('boot.useHere') : t('boot.reload')}</Button>
        )}
      </div>
    );
  }

  const state: AppState = {
    db: boot.db, workspace, lang, t, num, date, toast,
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
  else if (route.name === 'rooms') screen = <RoomsPage />;
  else if (route.name === 'room') screen = <RoomPage id={route.id} />;
  else if (route.name === 'booked') screen = <BookedPage />;
  else if (route.name === 'settings') screen = <Settings />;
  else if (route.name === 'scan') screen = <Scan />;
  else if (route.name === 'labels') screen = <PrintLabels />;
  else if (route.name === 'label') screen = <LabelRoute code={route.code} />;
  else if (route.name === 'jobNew') screen = <JobForm />;
  else if (route.name === 'job') screen = <JobPage id={route.id} />;
  else if (route.name === 'jobEdit') screen = <JobForm id={route.id} />;
  else if (route.name === 'jobLabels') screen = <JobLabelsPage id={route.id} />;
  else if (route.name === 'loadCheck') screen = <LoadCheckPage key={`${route.id}-${route.direction}`} id={route.id} direction={route.direction} />;
  else if (route.name === 'scanJob') screen = <ScanJobPicker />;
  else if (route.name === 'conditionStage') screen = <ConditionStagePage key={`${route.id}-${route.stage}`} id={route.id} stage={route.stage} />;
  else if (route.name === 'conditionPiece') screen = <ConditionPiecePage key={`${route.id}-${route.stage}-${route.boxId}`} id={route.id} stage={route.stage} boxId={route.boxId} />;
  else if (route.name === 'signOff') screen = <SignOffPage key={`${route.id}-${route.stage}`} id={route.id} stage={route.stage} />;
  else if (route.name === 'business') screen = <BusinessPage />;
  else if (route.name === 'trucks') screen = <TrucksPage />;
  else if (route.name === 'volumeCatalogue') screen = <VolumeCataloguePage />;
  else if (route.name === 'addRemovalist') screen = <AddRemovalistPage />;
  else screen = workspace.type === 'removalist' ? <JobsPage /> : <Home />;

  // Top-level screens show the tab bar and the Scan button (DESIGN_SYSTEM §4). Home: Boxes, Rooms, Settings;
  // Seller: Stock, Booked, Settings. Detail screens push with a back button instead.
  const seller = workspace?.type === 'seller';
  const removalist = workspace?.type === 'removalist';
  // Removalist: Jobs and Settings, with the Scan button between (plan §6).
  const tabs: Tab[] = removalist ? [
    { id: 'home', label: t('nav.jobs'), icon: Truck, onClick: () => navigate('/') },
    { id: 'settings', label: t('nav.settings'), icon: SettingsIcon, onClick: () => navigate('/settings') },
  ] : [
    { id: 'home', label: t(seller ? 'nav.stock' : 'nav.boxes'), icon: Package, onClick: () => navigate('/') },
    seller
      ? { id: 'booked', label: t('nav.booked'), icon: Bookmark, onClick: () => navigate('/booked') }
      : { id: 'rooms', label: t('nav.rooms'), icon: DoorOpen, onClick: () => navigate('/rooms') },
    { id: 'settings', label: t('nav.settings'), icon: SettingsIcon, onClick: () => navigate('/settings') },
  ];
  const topLevel = ['home', 'rooms', 'booked', 'settings'];
  const showTabs = !!workspace && topLevel.includes(route.name) && !(route.name === 'rooms' && (seller || removalist)) && !(route.name === 'booked' && !seller);

  return (
    <AppContext.Provider value={state}>
      {!boot.db.info.persistent && <Banner tone="danger">{t('banner.memory')}</Banner>}
      {boot.db.info.persistent && storage?.likelyPrivate && <Banner tone="danger">{t('banner.private')}</Banner>}
      {boot.db.info.persistent && storage && !storage.likelyPrivate && !storage.persisted && workspace && <Banner>{t('banner.notPersisted')}</Banner>}
      {showTabs ? <div className="lg:pl-56">{screen}</div> : screen}
      {showTabs && <TabBar tabs={tabs} current={route.name} label={t('nav.main')} scanLabel={t('home.scan')} onScan={() => navigate(removalist ? '/scan-job' : '/scan')} />}
      {upgrade && <Upgrade reason={upgrade} onClose={() => setUpgrade(null)} />}
      {shareFile && (
        <div role="dialog" aria-label={t('share.ready')} className="anim-in fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 rounded-t-lg bg-surface p-4 shadow-2xl" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <p className="font-medium">{t('share.ready')}: {shareFile.name}</p>
          <Button onClick={async () => { const f = shareFile; setShareFile(null); await navigator.share({ files: [f], title: f.name }).catch(() => {}); }}>{t('share.now')}</Button>
          <Button variant="ghost" onClick={() => setShareFile(null)}>{t('upgrade.later')}</Button>
        </div>
      )}
      {toastMsg && (
        <div role="status" key={toastMsg.id} style={{ bottom: `calc(${showTabs ? '8.5rem' : '1.5rem'} + env(safe-area-inset-bottom))` }}
          className="anim-in fixed inset-x-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg bg-text px-4 py-2 text-subhead text-bg shadow-lg">
          <span className="py-1.5">{toastMsg.msg}</span>
          {toastMsg.action && (
            <button type="button" className="min-h-11 min-w-[60px] px-2 text-center font-semibold text-bg underline-offset-2 active:opacity-60"
              onClick={() => { const a = toastMsg.action!; setToastMsg(null); void a.run(); }}>{toastMsg.action.label}</button>
          )}
        </div>
      )}
    </AppContext.Provider>
  );
}
