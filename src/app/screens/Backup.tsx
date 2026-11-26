import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Printer, Trash2, TriangleAlert } from 'lucide-react';
import { Button, Field, Group, Icon, Page, Row, inputClass } from '../ui';
import { isValidRecoveryCode, newRecoveryCode, normaliseRecoveryCode, WrongCodeError, BadFileError, FutureVersionError } from '../../core/backup/crypto';
import { changeRecoveryCode, checkRecoveryCode, createBackupFile, deliverFile, hasBackupKey, replaceRecoveryCode, restoreBackupFile, setUpBackupKey } from '../../core/backup/backupFile';
import type { Db } from '../../core/db/client';
import type { Key } from '../../i18n/i18n';
import { DriveRestore, DriveSettings } from './Drive';
import { ListSettings } from './Lists';
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
        <h1 className="text-large-title font-bold">{t('code.confirmTitle')}</h1>
        {ask.map((idx, i) => (
          <Field key={idx} label={t('code.confirmWord', { n: idx + 1 })}>
            <input className={inputClass} autoCapitalize="none" autoComplete="off" spellCheck={false} value={answers[i]}
              onChange={(e) => { const a = [...answers]; a[i] = e.target.value; setAnswers(a); setError(false); }} />
          </Field>
        ))}
        {error && <p role="alert" className="text-danger">{t('code.mismatch')}</p>}
        <Button type="submit">{t('code.confirm')}</Button>
        <Button variant="ghost" onClick={() => setStep('show')}>{t('box.back')}</Button>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-large-title font-bold">{t('code.title')}</h1>
      <p className="text-text-2">{t('code.explain')}</p>
      <ol className="grid grid-cols-2 gap-2 rounded-md border border-separator p-3 font-mono text-headline sm:grid-cols-3" data-testid="recovery-code">
        {words.map((w, i) => <li key={i}><span className="text-text-2">{i + 1}.</span> {w}</li>)}
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
      <h1 className="text-large-title font-bold">{t('restore.title')}</h1>
      <p className="text-subhead text-warning">{t('restore.replaceWarning')}</p>
      <Field label={t('restore.pick')}>
        <input type="file" accept=".btbak,application/octet-stream" className="block py-2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label={t('restore.code')}>
        <textarea className={`${inputClass} py-2 font-mono`} rows={3} autoCapitalize="none" autoComplete="off" spellCheck={false}
          value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <Button type="submit" disabled={!file || !code.trim() || busy}>{busy ? t('restore.working') : t('restore.go')}</Button>
      <Button variant="ghost" onClick={onCancel}>{t('box.back')}</Button>
    </form>
  );
}

export function Settings() {
  const { db, t, date, toast, setWorkspace, workspace, showUpgrade } = useApp();
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
      <div className="mx-auto max-w-md px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))]">
        {codeStep === 'old' ? (
          <form className="flex flex-col gap-2" onSubmit={async (e) => {
            e.preventDefault();
            const ok = isValidRecoveryCode(oldCode) && (await checkRecoveryCode(db, oldCode));
            if (ok) { setCodeError(null); setCodeStep('new'); } else setCodeError(t('code.wrongOld'));
          }}>
            <h1 className="text-large-title font-bold">{t('code.changeTitle')}</h1>
            <Field label={t('code.oldCode')}>
              <textarea className={`${inputClass} py-2 font-mono`} rows={3} autoCapitalize="none" autoComplete="off" spellCheck={false} value={oldCode} onChange={(e) => setOldCode(e.target.value)} />
            </Field>
            {codeError && <p role="alert" className="text-danger">{codeError}</p>}
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
      <div className="mx-auto max-w-md px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))]">
        <RecoveryCodeSetup db={db} t={t} apply={(code) => replaceRecoveryCode(db, code)} onDone={() => { setMode('main'); toast(t('code.replaced')); }} />
      </div>
    );
  }
  if (mode === 'setup') return <div className="mx-auto max-w-md px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))]"><RecoveryCodeSetup db={db} t={t} onDone={() => setMode('main')} /></div>;
  const afterRestore = async (msg: string) => {
    const list = await db.listWorkspaces();
    setWorkspace(list[0] ?? null);
    toast(msg);
    navigate('/', true);
  };
  if (mode === 'driveRestore') {
    return <div className="mx-auto max-w-md px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))]"><DriveRestore db={db} t={t} folderId={driveFolder} onCancel={() => setMode('main')} onDone={afterRestore} /></div>;
  }
  if (mode === 'restore') {
    return (
      <div className="mx-auto max-w-md px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))]">
        <RestoreFile db={db} t={t} onCancel={() => setMode('main')} onDone={async (msg) => {
          const list = await db.listWorkspaces();
          setWorkspace(list[0] ?? null);
          toast(msg);
          navigate('/', true);
        }} />
      </div>
    );
  }

  const shareList = async (kind: 'removalist' | 'family' | 'insurance') => {
    if (!workspace) return;
    if (kind !== 'removalist') {
      const ok = await db.check(kind === 'family' ? 'share_pdf' : 'insurance_pdf', workspace.id);
      if (!ok.allowed) { showUpgrade(ok.reason); return; }
    }
    setBusy(true);
    try {
      const [{ buildListPdf }, { gatherListBoxes }, { canvasTextRenderer }] = await Promise.all([
        import('../../core/pdf/lists'), import('../../core/pdf/gather'), import('../../core/labels/textImage')]);
      const boxes = await gatherListBoxes(db, workspace.id, kind !== 'removalist');
      const pdf = await buildListPdf(kind, boxes, { title: workspace.name, currency: workspace.currency, renderText: canvasTextRenderer });
      await deliverFile(new File([new Uint8Array(pdf)], `BoxTap-${kind}-list.pdf`, { type: 'application/pdf' }));
      toast(t('lists.ready'));
    } catch (e) {
      toast(t('error.generic', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };
  const exportCsv = async () => {
    if (!workspace) return;
    const csv = await db.exportCsv(workspace.id);
    const name = `BoxTap-${workspace.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40) || 'export'}.csv`;
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

  // Settings tab (ADR-023): this list, backup, Drive, labels, the Bin, lists and data, as inset grouped lists.
  return (
    <Page title={t('settings.title')}>
      <ListSettings />
      <section className="mt-6">
        <h2 className="px-4 pb-1.5 text-footnote text-text-2">{t('settings.backup')}</h2>
        <div className="rounded-md bg-surface p-4">
          <p className="flex items-center gap-2 text-subhead text-text-2" data-testid="last-backup">
            {!last && <Icon as={TriangleAlert} size={18} className="text-warning" />}
            {last ? t('settings.lastBackup', { when: date(last, true) }) : t('settings.never')}
          </p>
          {ready === false
            ? <Button className="mt-3 w-full" onClick={() => setMode('setup')}>{t('settings.setupBackup')}</Button>
            : <Button className="mt-3 w-full" onClick={backup} disabled={busy || !ready}>{t('settings.backupNow')}</Button>}
        </div>
      </section>
      <Group>
        <Row title={t('settings.restore')} onClick={() => setMode('restore')} />
        {ready && <Row title={t('code.change')} onClick={() => setMode('changeCode')} />}
        {ready && <Row title={t('code.lost')} onClick={() => { if (confirm(t('code.lostConfirm'))) setMode('newCode'); }} />}
        {!isInstalled() && <Row title={t('install.settings')} onClick={() => setGuide(true)} />}
      </Group>
      {guide && <InstallGuide onClose={() => setGuide(false)} />}
      <DriveSettings onRestore={(f) => { setDriveFolder(f); setMode('driveRestore'); }} />
      <Group title={t('settings.more')}>
        <Row title={t('labels.title')} lead={<Icon as={Printer} className="text-text-2" />} onClick={() => navigate('/labels')} />
        <Row title={t('bin.title')} detail={t('settings.binHint')} lead={<Icon as={Trash2} className="text-text-2" />} onClick={() => navigate('/bin')} />
      </Group>
      {workspace?.type === 'seller' && (
        <div className="mt-6 rounded-md bg-surface px-4">
          <label className="flex min-h-11 items-center gap-3 py-2">
            <input type="checkbox" className="h-5 w-5 accent-accent-fill" checked={workspace.jewelleryFields}
              onChange={async (e) => { await db.setJewelleryFields(workspace.id, e.target.checked); setWorkspace({ ...workspace, jewelleryFields: e.target.checked }); }} />
            <span className="text-body">{t('settings.jewellery')}</span>
          </label>
        </div>
      )}
      {workspace?.type === 'home' && (
        <Group title={t('lists.title')}>
          <Row title={t('lists.removalist')} disabled={busy} onClick={() => shareList('removalist')} />
          <Row title={t('lists.family')} disabled={busy} onClick={() => shareList('family')} />
          <Row title={t('lists.insurance')} disabled={busy} onClick={() => shareList('insurance')} />
        </Group>
      )}
      <Group title={t('settings.data')}>
        <Row title={t('settings.exportCsv')} onClick={exportCsv} />
      </Group>
      <Group>
        <Row title={t('settings.erase')} tone="danger" chevron={false} onClick={eraseAll} />
      </Group>
    </Page>
  );
}
