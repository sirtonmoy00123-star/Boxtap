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
    void db.purgeBin().catch((e) => console.warn('purge failed', e));
    void requestPersistence().then(() => storageStatus()).then(setStorage);
  }, []);

  const bootUp = useCallback(async (steal: boolean) => {
    setBoot({ s: 'loading' });
    try {
      if (steal) {
        let db!: Db;
        const lock = await takeOver(async () => { db = await openDb(); });
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

  const lang: Lang = workspace?.language ?? guessLang();
  const t = useMemo(() => makeT(lang), [lang]);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg(null), 2000);
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
  else if (route.name === 'bin') screen = <Bin />;
  else if (route.name === 'label') screen = <LabelRoute code={route.code} />;
  else screen = <Home />;

  return (
    <AppContext.Provider value={state}>
      {!boot.db.info.persistent && <Banner tone="danger">{t('banner.memory')}</Banner>}
      {boot.db.info.persistent && storage?.likelyPrivate && <Banner tone="danger">{t('banner.private')}</Banner>}
      {boot.db.info.persistent && storage && !storage.likelyPrivate && !storage.persisted && workspace && <Banner>{t('banner.notPersisted')}</Banner>}
      {screen}
      {upgrade && <Upgrade reason={upgrade} onClose={() => setUpgrade(null)} />}
      {toastMsg && <div role="status" className="fixed inset-x-0 bottom-24 mx-auto w-fit rounded-full bg-slate-900 px-4 py-2 text-white">{toastMsg}</div>}
    </AppContext.Provider>
  );
}
