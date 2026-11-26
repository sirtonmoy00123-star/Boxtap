// First launch (ARCHITECTURE §5.1, audit B2): restore options are offered before anything is created.
import { useState } from 'react';
import { useApp, makeT } from '../context';
import { Button, Field, inputClass } from '../ui';
import type { Lang } from '../../i18n/i18n';
import { RecoveryCodeSetup, RestoreFile } from './Backup';
import { DriveRestore } from './Drive';
import { driveConfigured } from '../../core/drive/googleAuth';
import { hasBackupKey } from '../../core/backup/backupFile';
import { RemovalistSetup } from './removalist/Setup';
import type { WorkspaceType } from '../../core/repo';

const MODE_TEXT: Record<WorkspaceType, ['setup.home' | 'setup.seller' | 'setup.removalist', 'setup.homeHint' | 'setup.sellerHint' | 'setup.removalistHint']> = {
  home: ['setup.home', 'setup.homeHint'], seller: ['setup.seller', 'setup.sellerHint'], removalist: ['setup.removalist', 'setup.removalistHint'],
};

export function Start() {
  const { db, setWorkspace, toast } = useApp();
  const [step, setStep] = useState<'choose' | 'setup' | 'code' | 'restore' | 'driveRestore' | 'removalist'>('choose');
  const [needCode, setNeedCode] = useState(true);
  const [lang, setLang] = useState<Lang>(navigator.language?.startsWith('bn') ? 'bn' : 'en');
  const [type, setType] = useState<WorkspaceType>('home');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const t = makeT(lang);

  const create = async () => {
    setBusy(true);
    try {
      const ws = await db.createWorkspace({
        type, language: lang,
        name: name.trim() || t(type === 'home' ? 'setup.nameHomeDefault' : 'setup.nameSellerDefault'),
        country: type === 'home' ? 'AU' : 'BD', currency: type === 'home' ? 'AUD' : 'BDT',
      });
      setWorkspace(ws);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'choose') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-large-title font-bold">{t('start.title')}</h1>
        <p className="text-text-2">{t('start.subtitle')}</p>
        <Button onClick={() => setStep('setup')}>{t('start.new')}</Button>
        {driveConfigured()
          ? <Button variant="secondary" onClick={() => setStep('driveRestore')}>{t('start.restoreDrive')}</Button>
          : <Button variant="secondary" disabled title={t('start.comingSoon')}>{t('start.restoreDrive')} · {t('start.comingSoon')}</Button>}
        <Button variant="secondary" onClick={() => setStep('restore')}>{t('start.restoreFile')}</Button>
        <div className="flex gap-2 pt-4" role="group" aria-label={t('setup.language')}>
          <Button variant={lang === 'en' ? 'primary' : 'secondary'} onClick={() => setLang('en')} className="flex-1">English</Button>
          <Button variant={lang === 'bn' ? 'primary' : 'secondary'} onClick={() => setLang('bn')} className="flex-1">বাংলা</Button>
        </div>
      </div>
    );
  }

  if (step === 'driveRestore') {
    return (
      <div className="mx-auto max-w-md px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))]">
        <DriveRestore db={db} t={t} onCancel={() => setStep('choose')} onDone={async (msg) => {
          const list = await db.listWorkspaces();
          toast(msg);
          setWorkspace(list[0] ?? null);
        }} />
      </div>
    );
  }
  if (step === 'restore') {
    return (
      <div className="mx-auto max-w-md px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))]">
        <RestoreFile db={db} t={t} onCancel={() => setStep('choose')} onDone={async (msg) => {
          const list = await db.listWorkspaces();
          toast(msg);
          setWorkspace(list[0] ?? null);
        }} />
      </div>
    );
  }
  if (step === 'removalist') {
    return <RemovalistSetup db={db} lang={lang} needCode={needCode} onCancel={() => setStep('setup')} onDone={setWorkspace} />;
  }
  if (step === 'code') {
    return <div className="mx-auto max-w-md px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))]"><RecoveryCodeSetup db={db} t={t} onDone={() => void create()} /></div>;
  }


  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="text-large-title font-bold">{t('setup.mode')}</h1>
      {(['home', 'seller', 'removalist'] as const).map((m) => (
        <button key={m} type="button" onClick={() => setType(m)} aria-pressed={type === m}
          className={`rounded-md border p-4 text-left ${type === m ? 'border-accent bg-surface-2' : 'border-separator'}`}>
          <div className="font-semibold">{t(MODE_TEXT[m][0])}</div>
          <div className="text-subhead text-text-2">{t(MODE_TEXT[m][1])}</div>
        </button>
      ))}
      {type === 'removalist' ? (
        // The business name, the data warning and the code come in the Removalist steps.
        <Button onClick={async () => { setNeedCode(!(await hasBackupKey(db))); setStep('removalist'); }}>{t('setup.start')}</Button>
      ) : (
        <>
          <Field label={t('setup.name')}>
            <input className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
              placeholder={t(type === 'home' ? 'setup.nameHomeDefault' : 'setup.nameSellerDefault')} />
          </Field>
          <p className="rounded-md bg-surface-2 p-3 text-subhead text-warning">{t('setup.warning')}</p>
          <Button onClick={() => setStep('code')} disabled={busy}>{t('setup.start')}</Button>
        </>
      )}
    </div>
  );
}
