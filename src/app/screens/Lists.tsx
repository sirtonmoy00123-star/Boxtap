// Settings → this list (name, language) and every list on this phone (C-02: several workspaces, never mixed).
import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Field, inputClass } from '../ui';
import type { Workspace } from '../../core/repo';
import type { Lang } from '../../i18n/i18n';

export function ListSettings() {
  const { db, workspace, setWorkspace, t, toast } = useApp();
  const ws = workspace!;
  const [name, setName] = useState(ws.name);
  const [all, setAll] = useState<Workspace[]>([]);
  const [adding, setAdding] = useState<{ type: 'home' | 'seller'; name: string } | null>(null);

  useEffect(() => { void db.listWorkspaces().then(setAll); }, [db, ws.id]);
  useEffect(() => { setName(ws.name); }, [ws.id, ws.name]);

  const saveName = async () => {
    if (!name.trim() || name.trim() === ws.name) return;
    await db.renameWorkspace(ws.id, name);
    setWorkspace((await db.getWorkspace(ws.id)) ?? ws);
    toast(t('box.saved'));
  };
  const setLang = async (language: Lang) => {
    await db.setWorkspaceLanguage(ws.id, language);
    setWorkspace({ ...ws, language });
  };
  const switchTo = (w: Workspace) => { setWorkspace(w); navigate('/', true); };
  const create = async () => {
    if (!adding) return;
    const type = adding.type;
    const w = await db.createWorkspace({
      type, language: ws.language, country: type === 'home' ? 'AU' : 'BD', currency: type === 'home' ? 'AUD' : 'BDT',
      name: adding.name.trim() || t(type === 'home' ? 'setup.nameHomeDefault' : 'setup.nameSellerDefault'),
    });
    setAdding(null);
    switchTo(w);
  };

  return (
    <section className="mt-2" aria-label={t('lists.this')}>
      <h2 className="text-headline font-semibold">{t('lists.this')}</h2>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void saveName(); }}>
        <input className={inputClass} maxLength={80} aria-label={t('setup.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={!name.trim() || name.trim() === ws.name}>{t('box.save')}</Button>
      </form>
      <div className="mt-2 flex gap-2" role="group" aria-label={t('setup.language')}>
        <Button variant={ws.language === 'en' ? 'primary' : 'secondary'} aria-pressed={ws.language === 'en'} className="flex-1" onClick={() => void setLang('en')}>English</Button>
        <Button variant={ws.language === 'bn' ? 'primary' : 'secondary'} aria-pressed={ws.language === 'bn'} className="flex-1" onClick={() => void setLang('bn')}>বাংলা</Button>
      </div>

      <h2 className="mt-6 text-headline font-semibold">{t('lists.all')}</h2>
      <ul className="divide-y divide-separator" aria-label={t('lists.all')}>
        {all.map((w) => (
          <li key={w.id} className="flex items-center justify-between py-2">
            <span>{w.name} <span className="text-subhead text-text-2">· {t(w.type === 'home' ? 'setup.home' : 'setup.seller')}</span></span>
            {w.id === ws.id
              ? <span className="text-subhead font-medium text-accent">{t('lists.current')}</span>
              : <Button variant="secondary" onClick={() => switchTo(w)}>{t('lists.open')}</Button>}
          </li>
        ))}
      </ul>
      {adding ? (
        <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          {(['home', 'seller'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setAdding({ ...adding, type: m })} aria-pressed={adding.type === m}
              className={`rounded-md border p-3 text-left ${adding.type === m ? 'border-accent bg-surface-2' : 'border-separator'}`}>
              <div className="font-semibold">{t(m === 'home' ? 'setup.home' : 'setup.seller')}</div>
              <div className="text-subhead text-text-2">{t(m === 'home' ? 'setup.homeHint' : 'setup.sellerHint')}</div>
            </button>
          ))}
          <Field label={t('setup.name')}>
            <input className={inputClass} maxLength={80} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })}
              placeholder={t(adding.type === 'home' ? 'setup.nameHomeDefault' : 'setup.nameSellerDefault')} />
          </Field>
          <Button type="submit">{t('lists.create')}</Button>
          <Button variant="ghost" onClick={() => setAdding(null)}>{t('box.back')}</Button>
        </form>
      ) : (
        <Button variant="secondary" className="mt-2 w-full" onClick={() => setAdding({ type: ws.type === 'home' ? 'seller' : 'home', name: '' })}>{t('lists.add')}</Button>
      )}
    </section>
  );
}
