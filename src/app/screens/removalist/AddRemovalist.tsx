// Settings → add a Removalist list: the same onboarding as first launch. The recovery code belongs to the phone,
// so its step is skipped when this phone already has a backup key (plan §3 C4).
import { useEffect, useState } from 'react';
import { useApp } from '../../context';
import { navigate } from '../../router';
import { hasBackupKey } from '../../../core/backup/backupFile';
import { RemovalistSetup } from './Setup';

export function AddRemovalistPage() {
  const { db, workspace, setWorkspace } = useApp();
  const [needCode, setNeedCode] = useState<boolean | null>(null);
  useEffect(() => { void hasBackupKey(db).then((has) => setNeedCode(!has)); }, [db]);
  if (needCode === null) return null;
  return (
    <RemovalistSetup db={db} lang={workspace?.language ?? 'en'} needCode={needCode}
      onCancel={() => navigate('/settings')}
      onDone={(ws) => { setWorkspace(ws); navigate('/', true); }} />
  );
}
