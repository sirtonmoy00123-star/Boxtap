import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context';
import { Button, Field, inputClass } from '../ui';
import { loadGis, requestToken, revokeAccess, currentToken, driveConfigured, DrivePermissionError, onTokenChange, PopupBlockedError, preferRedirect, RedirectingError, startRedirectSignIn } from '../../core/drive/googleAuth';
import { driveApi, makeSync, runPhotoQueue } from '../../core/drive/browserSync';
import type { LinkState } from '../../core/drive/sync';
import { WrongCodeError, FutureVersionError } from '../../core/backup/crypto';
import type { Db } from '../../core/db/client';
import type { Key } from '../../i18n/i18n';

type T = (k: Key, v?: Record<string, string | number>) => string;

/** Signs in from a tap (GIS must already be loaded so the pop-up isn't blocked). Returns the account email. */
async function signIn(hint?: string): Promise<string> {
  if (currentToken()) return driveApi().accountEmail(); // e.g. just back from the full-page sign-in
  if (preferRedirect()) startRedirectSignIn(hint);
  const gis = await loadGis();
  try {
    await requestToken(gis, hint);
  } catch (e) {
    if (e instanceof PopupBlockedError) startRedirectSignIn(hint);
    throw e;
  }
  return driveApi().accountEmail();
}

function useGisPreload() {
  useEffect(() => { if (driveConfigured()) void loadGis().catch(() => {}); }, []);
}

function errorText(t: T, e: unknown): string {
  if (e instanceof RedirectingError) return t('drive.redirecting');
  if (e instanceof DrivePermissionError) return t('drive.permission');
  if (e instanceof WrongCodeError) return t('restore.wrongCode');
  if (e instanceof FutureVersionError) return t('restore.newer');
  return t('error.generic', { msg: (e as Error).message });
}

/** "Restore from Google Drive" (first screen and after "Restore it"). Nothing changes on a wrong code. */
export function DriveRestore({ db, t, onDone, onCancel, folderId: knownFolder }: { db: Db; t: T; onDone: (msg: string) => void; onCancel: () => void; folderId?: string }) {
  useGisPreload();
  const [folder, setFolder] = useState<string | null>(knownFolder ?? null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async () => {
    setBusy(true); setError(null);
    try {
      const mail = await signIn();
      setEmail(mail);
      const d = await (await makeSync(db)).inspect();
      if (d.kind === 'offer_restore') setFolder(d.folderId);
      else setError(t('drive.noBackupFound'));
    } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); }
  };
  const go = async () => {
    if (!folder) return;
    setBusy(true); setError(null);
    try {
      if (!currentToken()) setEmail(await signIn(email || undefined));
      const r = await (await makeSync(db)).restore(folder, code, email || (await driveApi().accountEmail()));
      await db.queuePhotoDownloads(); // photos follow in the background, newest first
      void runPhotoQueue(db);
      onDone(t('restore.done', { boxes: r.boxes, items: r.items }));
    } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-large-title font-bold">{t('drive.restoreTitle')}</h1>
      <p className="text-subhead text-warning">{t('restore.replaceWarning')}</p>
      {!folder ? (
        <Button onClick={find} disabled={busy}>{busy ? t('drive.connecting') : t('drive.signIn')}</Button>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void go(); }}>
          {email && <p className="text-subhead text-text-2">{t('drive.account', { email })}</p>}
          <Field label={t('restore.code')}>
            <textarea className={`${inputClass} py-2 font-mono`} rows={3} autoCapitalize="none" autoComplete="off" spellCheck={false}
              value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!code.trim() || busy}>{busy ? t('restore.working') : t('restore.go')}</Button>
        </form>
      )}
      {error && <p role="alert" className="text-danger">{error}</p>}
      <Button variant="ghost" onClick={onCancel}>{t('box.back')}</Button>
    </div>
  );
}

/** Settings section: connect, status, back up now, disconnect. */
export function DriveSettings({ onRestore }: { onRestore: (folderId: string) => void }) {
  const { db, t, toast } = useApp();
  useGisPreload();
  const [link, setLink] = useState<LinkState | null | undefined>(undefined);
  const [hasToken, setHasToken] = useState(!!currentToken());
  const [found, setFound] = useState<{ folderId: string; email: string } | null>(null);
  const [newer, setNewer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [waiting, setWaiting] = useState(0);
  const [paused, setPaused] = useState(false);
  const refresh = useCallback(async () => {
    setLink(await db.getDriveLink());
    setWaiting(await db.outboxCount('upload'));
    setPaused(await db.photoUploadsPaused());
  }, [db]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => onTokenChange(() => setHasToken(!!currentToken())), []);

  if (!driveConfigured()) return null;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); await refresh(); }
  };

  const connect = () => act(async () => {
    const email = await signIn();
    const sync = await makeSync(db);
    const d = await sync.inspect();
    if (d.kind === 'offer_restore') { setFound({ folderId: d.folderId, email }); return; }
    await sync.connect(email);
    await sync.snapshotNow();
    await db.queueMissingUploads();
    void runPhotoQueue(db);
  });
  const startNew = () => act(async () => {
    if (!found || !confirm(t('drive.startNewConfirm'))) return;
    if (!currentToken()) await signIn(found.email);
    const sync = await makeSync(db);
    await sync.connect(found.email, { startNewFolder: true });
    await sync.snapshotNow();
    await db.queueMissingUploads();
    void runPhotoQueue(db);
    setFound(null);
  });
  const backUpNow = () => act(async () => {
    if (!currentToken()) await signIn(link?.googleEmail);
    const out = await (await makeSync(db)).snapshotNow();
    await runPhotoQueue(db);
    if (out === 'uploaded' || out === 'up_to_date') toast(t('settings.backupDone'));
  });
  const useHere = () => act(async () => {
    if (!currentToken()) await signIn(link?.googleEmail);
    const sync = await makeSync(db);
    if ((await sync.takeoverCheck()).driveIsNewer) { setNewer(true); return; }
    if (!confirm(t('drive.useHereConfirm'))) return;
    await sync.takeOver();
    await sync.snapshotNow();
  });
  const replaceNewer = () => act(async () => {
    if (prompt(t('drive.replacePrompt'))?.trim().toUpperCase() !== 'REPLACE') return;
    if (!currentToken()) await signIn(link?.googleEmail);
    const sync = await makeSync(db);
    await sync.takeOver({ replaceNewer: true });
    await sync.snapshotNow();
    setNewer(false);
  });
  const disconnect = () => act(async () => {
    await (await makeSync(db)).disconnect();
    await revokeAccess();
    toast(t('drive.disconnected'));
  });

  const status = link?.status;
  return (
    <section className="mt-6" aria-label={t('drive.title')}>
      <h2 className="text-headline font-semibold">{t('drive.title')}</h2>
      <p className="text-subhead text-text-2">{t('drive.explain')}</p>
      {link === undefined ? null : !link ? (
        found ? (
          <div className="mt-3 flex flex-col gap-2">
            <p role="status">{t('drive.found')}</p>
            <Button onClick={() => onRestore(found.folderId)}>{t('drive.restoreIt')}</Button>
            <Button variant="secondary" onClick={startNew} disabled={busy}>{t('drive.startNew')}</Button>
          </div>
        ) : (
          <Button className="mt-3 w-full" onClick={connect} disabled={busy}>{busy ? t('drive.connecting') : t('drive.connect')}</Button>
        )
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-subhead" data-testid="drive-status">
            {link.lastSnapshotAt ? t('drive.backedUp', { when: new Date(link.lastSnapshotAt).toLocaleString() }) : t('drive.notYet')}
          </p>
          {link.googleEmail && <p className="text-subhead text-text-2">{t('drive.account', { email: link.googleEmail })}</p>}
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" className="h-5 w-5" checked={paused} onChange={async (e) => { await db.setPhotoUploadsPaused(e.target.checked); setPaused(e.target.checked); }} />
            <span>{t('drive.pause')}<span className="block text-footnote text-text-2">{t('drive.pauseHint')}</span></span>
          </label>
          {waiting > 0 && <p className="text-subhead text-text-2" data-testid="photos-waiting">{t('photos.waiting', { n: waiting })}</p>}
          {status === 'lock_lost' && <p role="alert" className="text-warning">{t('drive.lockLost')}</p>}
          {status === 'lock_lost' && !newer && <Button variant="secondary" onClick={useHere} disabled={busy}>{t('drive.useHere')}</Button>}
          {status === 'lock_lost' && newer && (
            <>
              <p role="status">{t('drive.newerThere')}</p>
              <Button onClick={() => onRestore(link.folderId)}>{t('drive.restoreNewer')}</Button>
              <Button variant="danger" onClick={replaceNewer} disabled={busy}>{t('drive.replaceNewer')}</Button>
            </>
          )}
          {status === 'folder_trashed' && (
            <p role="alert" className="text-warning">{t('drive.trashed')} <a className="underline" href="https://drive.google.com/drive/trash" target="_blank" rel="noreferrer noopener">{t('drive.openTrash')}</a></p>
          )}
          {status === 'folder_missing' && <p role="alert" className="text-warning">{t('drive.missing')}</p>}
          {status === 'quota_full' && <p role="alert" className="text-warning">{t('drive.quota')}</p>}
          {status !== 'lock_lost' && (
            <Button onClick={backUpNow} disabled={busy}>{hasToken ? t('drive.syncNow') : t('drive.tapToBackUp')}</Button>
          )}
          <Button variant="secondary" onClick={disconnect} disabled={busy}>{t('drive.disconnect')}</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    </section>
  );
}
