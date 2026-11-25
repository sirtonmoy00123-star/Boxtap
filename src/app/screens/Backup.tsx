import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Field, Page, inputClass } from '../ui';
import { isValidRecoveryCode, newRecoveryCode, normaliseRecoveryCode, WrongCodeError, BadFileError, FutureVersionError } from '../../core/backup/crypto';
import { changeRecoveryCode, checkRecoveryCode, createBackupFile, deliverFile, hasBackupKey, replaceRecoveryCode, restoreBackupFile, setUpBackupKey } from '../../core/backup/backupFile';
import type { Db } from '../../core/db/client';
import type { Key } from '../../i18n/i18n';
import { DriveRestore, DriveSettings } from './Drive';
import { InstallGuide } from './Install';
import { isInstalled } from '../../core/pwa/install';
import { removePhotoFile } from '../../core/photos/store';
import { clearBackupKey } from '../../core/backup/keystore';
import { forgetToken } from '../../core/drive/googleAuth';

type T = (k: Key, v?: Record<string, string | number>) => string;

/** Shows a new 12-word code, asks for 3 of the words back, then makes the backup key (audit B7). */
export function RecoveryCodeSetup({ db, t, onDone, apply }: { db: Db; t: T; onDone: () => void; apply?: (code: string) => Promise<void> }) {
  const code = useMemo(() => newRecoveryCode(), []);
  const words = code.split(' ');
  const ask = useMemo(() => {
    const picks = new Set<number>();
    const r = crypto.getRandomValues(new Uint8Array(16));
    for (const b of r) { if (picks.size < 3) picks.add(b % 12); }
    while (picks.size < 3) picks.add(picks.size);
    return [...picks].sort((a, b) => a - b);
  }, []);
  const [step, setStep] = useState<'show' | 'confirm' | 'making'>('show');
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [error, setError] = useState(false);

  const confirm = async () => {
    const ok = ask.every((idx, i) => normaliseRecoveryCode(answers[i] ?? '') === words[idx]);
    if (!ok) { setError(true); return; }
    setStep('making');
    await (apply ? apply(code) : setUpBackupKey(db, code));
    onDone();
  };

  if (step === 'making') return <p className="py-10 text-center">{t('code.making')}</p>;
  if (step === 'confirm') {
    return (
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
        <h1 className="text-2xl font-bold">{t('code.confirmTitle')}</h1>
        {ask.map((idx, i) => (
          <Field key={idx} label={t('code.confirmWord', { n: idx + 1 })}>
            <input className={inputClass} autoCapitalize="none" autoComplete="off" spellCheck={false} value={answers[i]}
              onChange={(e) => { const a = [...answers]; a[i] = e.target.value; setAnswers(a); setError(false); }} />
          </Field>
        ))}
        {error && <p role="alert" className="text-red-700">{t('code.mismatch')}</p>}
        <Button type="submit">{t('code.confirm')}</Button>
        <Button variant="ghost" onClick={() => setStep('show')}>{t('box.back')}</Button>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">{t('code.title')}</h1>
      <p className="text-slate-700">{t('code.explain')}</p>
      <ol className="grid grid-cols-2 gap-2 rounded-xl border border-slate-300 p-3 font-mono text-lg sm:grid-cols-3" data-testid="recovery-code">
        {words.map((w, i) => <li key={i}><span className="text-slate-400">{i + 1}.</span> {w}</li>)}
      </ol>
      <Button variant="secondary" onClick={() => window.print()}>{t('code.print')}</Button>
      <Button onClick={() => setStep('confirm')}>{t('code.written')}</Button>
    </div>
  );
}

/** Restore from a .btbak file. Used on the first screen and in Settings. */
export function RestoreFile({ db, t, onDone, onCancel }: { db: Db; t: T; onDone: (msg: string) => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await restoreBackupFile(db, file, code);
      onDone(t('restore.done', { boxes: r.boxes, items: r.items }));
    } catch (e) {
      if (e instanceof WrongCodeError) setError(t('restore.wrongCode'));
      else if (e instanceof FutureVersionError) setError(t('restore.newer'));
      else if (e instanceof BadFileError) setError(t('restore.badFile'));
      else setError(/newer/.test((e as Error).message) ? t('restore.newer') : t('restore.badFile'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void go(); }}>
      <h1 className="text-2xl font-bold">{t('restore.title')}</h1>
      <p className="text-sm text-amber-900">{t('restore.replaceWarning')}</p>
      <Field label={t('restore.pick')}>
        <input type="file" accept=".btbak,application/octet-stream" className="block py-2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label={t('restore.code')}>
        <textarea className={`${inputClass} py-2 font-mono`} rows={3} autoCapitalize="none" autoComplete="off" spellCheck={false}
          value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <Button type="submit" disabled={!file || !code.trim() || busy}>{busy ? t('restore.working') : t('restore.go')}</Button>
      <Button variant="ghost" onClick={onCancel}>{t('box.back')}</Button>
    </form>
  );
}

export function Settings() {
  const { db, t, toast, setWorkspace, workspace } = useApp();
  const [last, setLast] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'main' | 'restore' | 'setup' | 'driveRestore' | 'changeCode' | 'newCode'>('main');
  const [oldCode, setOldCode] = useState('');
  const [codeStep, setCodeStep] = useState<'old' | 'new'>('old');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [driveFolder, setDriveFolder] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    void db.backupState().then((s) => setLast(s?.last_backup_at ? String(s.last_backup_at) : null));
    void hasBackupKey(db).then(setReady);
  }, [db, mode]);

  if (mode === 'changeCode') {
    return (
      <div className="mx-auto max-w-md px-6 py-8">
        {codeStep === 'old' ? (
          <form className="flex flex-col gap-2" onSubmit={async (e) => {
            e.preventDefault();
            const ok = isValidRecoveryCode(oldCode) && (await checkRecoveryCode(db, oldCode));
            if (ok) { setCodeError(null); setCodeStep('new'); } else setCodeError(t('code.wrongOld'));
          }}>
            <h1 className="text-2xl font-bold">{t('code.changeTitle')}</h1>
            <Field label={t('code.oldCode')}>
              <textarea className={`${inputClass} py-2 font-mono`} rows={3} autoCapitalize="none" autoComplete="off" spellCheck={false} value={oldCode} onChange={(e) => setOldCode(e.target.value)} />
            </Field>
            {codeError && <p role="alert" className="text-red-700">{codeError}</p>}
            <Button type="submit" disabled={!oldCode.trim()}>{t('code.next')}</Button>
            <Button variant="ghost" onClick={() => { setMode('main'); setOldCode(''); }}>{t('box.back')}</Button>
          </form>
        ) : (
          <RecoveryCodeSetup db={db} t={t} apply={(code) => changeRecoveryCode(db, oldCode, code)}
            onDone={() => { setOldCode(''); setCodeStep('old'); setMode('main'); toast(t('code.changed')); }} />
        )}
      </div>
    );
  }
  if (mode === 'newCode') {
    return (
      <div className="mx-auto max-w-md px-6 py-8">
        <RecoveryCodeSetup db={db} t={t} apply={(code) => replaceRecoveryCode(db, code)} onDone={() => { setMode('main'); toast(t('code.replaced')); }} />
      </div>
    );
  }
  if (mode === 'setup') return <div className="mx-auto max-w-md px-6 py-8"><RecoveryCodeSetup db={db} t={t} onDone={() => setMode('main')} /></div>;
  const afterRestore = async (msg: string) => {
    const list = await db.listWorkspaces();
    setWorkspace(list[0] ?? null);
    toast(msg);
    navigate('/', true);
  };
  if (mode === 'driveRestore') {
    return <div className="mx-auto max-w-md px-6 py-8"><DriveRestore db={db} t={t} folderId={driveFolder} onCancel={() => setMode('main')} onDone={afterRestore} /></div>;
  }
  if (mode === 'restore') {
    return (
      <div className="mx-auto max-w-md px-6 py-8">
        <RestoreFile db={db} t={t} onCancel={() => setMode('main')} onDone={async (msg) => {
          const list = await db.listWorkspaces();
          setWorkspace(list[0] ?? null);
          toast(msg);
          navigate('/', true);
        }} />
      </div>
    );
  }

  const exportCsv = async () => {
    if (!workspace) return;
    const csv = await db.exportCsv(workspace.id);
    const name = `BoxTap-${workspace.name.replace(/[^p{L}p{N}]+/gu, '-').slice(0, 40) || 'export'}.csv`;
    await deliverFile(new File([csv], name, { type: 'text/csv;charset=utf-8' }));
  };
  // Asks twice (DATABASE_SCHEMA §6). Sync stops first: the Drive link goes in the same transaction, so an empty
  // database is never uploaded (§6.1). Ruling (build): the Drive backup is always kept; deleting it is manual.
  const eraseAll = async () => {
    if (!confirm(t('settings.eraseConfirm1'))) return;
    if (prompt(t('settings.eraseConfirm2'))?.trim().toUpperCase() !== 'ERASE') return;
    const files = await db.eraseAll();
    await Promise.all(files.map((f) => removePhotoFile(f)));
    await clearBackupKey().catch(() => {});
    forgetToken();
    toast(t('settings.erased'));
    setWorkspace(null);
    navigate('/', true);
  };
  const backup = async () => {
    setBusy(true);
    try {
      const f = await createBackupFile(db);
      const how = await deliverFile(f);
      if (how !== 'cancelled') {
        // Review finding 5: record the backup only once the file was actually shared or downloaded.
        const at = new Date().toISOString();
        await db.markBackedUp(at);
        setLast(at);
        toast(t('settings.backupDone'));
      }
    } catch (e) {
      toast(t('error.generic', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={t('settings.title')} back={() => navigate('/')}>
      <h2 className="mt-2 text-lg font-semibold">{t('settings.backup')}</h2>
      <p className="text-sm text-slate-600" data-testid="last-backup">{last ? t('settings.lastBackup', { when: new Date(last).toLocaleString() }) : t('settings.never')}</p>
      <div className="mt-3 flex flex-col gap-2">
        {ready === false
          ? <Button onClick={() => setMode('setup')}>{t('settings.setupBackup')}</Button>
          : <Button onClick={backup} disabled={busy || !ready}>{t('settings.backupNow')}</Button>}
        <Button variant="secondary" onClick={() => setMode('restore')}>{t('settings.restore')}</Button>
        {ready && <Button variant="ghost" onClick={() => setMode('changeCode')}>{t('code.change')}</Button>}
        {ready && <Button variant="ghost" onClick={() => { if (confirm(t('code.lostConfirm'))) setMode('newCode'); }}>{t('code.lost')}</Button>}
      </div>
      {!isInstalled() && <Button variant="secondary" className="mt-6 w-full" onClick={() => setGuide(true)}>{t('install.settings')}</Button>}
      {guide && <InstallGuide onClose={() => setGuide(false)} />}
      <DriveSettings onRestore={(f) => { setDriveFolder(f); setMode('driveRestore'); }} />
      <h2 className="mt-6 text-lg font-semibold">{t('labels.title')}</h2>
      <div className="mt-3 flex flex-col gap-2">
        <Button variant="secondary" onClick={() => navigate('/labels')}>{t('labels.title')}</Button>
      </div>
      {workspace?.type === 'seller' && (
        <label className="mt-6 flex min-h-12 items-center gap-3">
          <input type="checkbox" className="h-5 w-5" checked={workspace.jewelleryFields}
            onChange={async (e) => { await db.setJewelleryFields(workspace.id, e.target.checked); setWorkspace({ ...workspace, jewelleryFields: e.target.checked }); }} />
          <span>{t('settings.jewellery')}</span>
        </label>
      )}
      <h2 className="mt-6 text-lg font-semibold">{t('settings.data')}</h2>
      <div className="mt-3 flex flex-col gap-2">
        <Button variant="secondary" onClick={exportCsv}>{t('settings.exportCsv')}</Button>
        <Button variant="danger" onClick={eraseAll}>{t('settings.erase')}</Button>
      </div>
    </Page>
  );
}
