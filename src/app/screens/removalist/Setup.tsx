// Removalist onboarding (plan §6): business details -> country and unit -> data warning -> recovery code (skipped
// when this phone already has a backup key) -> optional trucks. Nothing is saved until the last step, in one go.
import { useState, type ReactNode } from 'react';
import { makeT } from '../../context';
import { Button, Field, IconButton, inputClass } from '../../ui';
import { X } from 'lucide-react';
import type { Db } from '../../../core/db/client';
import type { Workspace } from '../../../core/repo';
import { asciiDigits, type Lang } from '../../../i18n/i18n';
import { RecoveryCodeSetup } from '../Backup';

type Step = 'business' | 'country' | 'warning' | 'code' | 'trucks';
interface TruckDraft { name: string; capacity: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const parseCapacity = (s: string): number => Number(asciiDigits(s).replace(',', '.').trim());

export function RemovalistSetup({ db, lang, needCode, onDone, onCancel }: {
  db: Db; lang: Lang; needCode: boolean; onDone: (ws: Workspace) => void; onCancel: () => void;
}) {
  const t = makeT(lang);
  const [step, setStep] = useState<Step>('business');
  const [biz, setBiz] = useState({ name: '', phone: '', email: '', abn: '', address: '' });
  const [country, setCountry] = useState<'AU' | 'BD'>('AU');
  const [unit, setUnit] = useState<'m3' | 'ft3'>('ft3'); // Bangladesh default (owner); Australia always m³
  const [trucks, setTrucks] = useState<TruckDraft[]>(() => [20, 30, 45].map((c, i) => ({ name: t('rm.truck.exampleName', { n: i + 1 }), capacity: String(c) })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeDone, setCodeDone] = useState(false); // going back must not make a second recovery code

  const nextFromBusiness = () => {
    if (!biz.name.trim() || !biz.phone.trim()) { setError(t('rm.business.required')); return; }
    if (biz.email.trim() && !EMAIL.test(biz.email.trim())) { setError(t('rm.business.emailBad')); return; }
    setError(null);
    setStep('country');
  };

  const create = async (withTrucks: boolean) => {
    const list = withTrucks ? trucks.map((tr) => ({ name: tr.name.trim(), capacityM3: parseCapacity(tr.capacity) })) : [];
    if (list.some((tr) => !tr.name || !(tr.capacityM3 > 0) || tr.capacityM3 > 500)) { setError(t('rm.truck.bad')); return; }
    setError(null);
    setBusy(true);
    try {
      const ws = await db.createRemovalistWorkspace({
        language: lang, country, volumeUnit: country === 'AU' ? 'm3' : unit, trucks: list,
        name: biz.name, phone: biz.phone, email: biz.email || null, abnOrLicence: biz.abn || null, address: biz.address || null,
      });
      onDone(ws);
    } catch (e) {
      setError(t('error.generic', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const wrap = (children: ReactNode) => (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))]">{children}</div>
  );
  const back = (to: Step | null) => <Button variant="ghost" onClick={() => (to ? setStep(to) : onCancel())}>{t('box.back')}</Button>;
  const err = error && <p role="alert" className="text-danger">{error}</p>;

  if (step === 'business') {
    const f = (k: keyof typeof biz, label: string, max: number, type = 'text', auto?: string) => (
      <Field label={label}>
        <input className={inputClass} type={type} maxLength={max} autoComplete={auto} value={biz[k]}
          onChange={(e) => { setBiz({ ...biz, [k]: e.target.value }); setError(null); }} />
      </Field>
    );
    return wrap(
      <form className="flex flex-col" onSubmit={(e) => { e.preventDefault(); nextFromBusiness(); }}>
        <h1 className="text-large-title font-bold">{t('rm.setup.businessTitle')}</h1>
        <p className="pb-2 text-text-2">{t('rm.setup.businessHint')}</p>
        {f('name', t('rm.business.name'), 80, 'text', 'organization')}
        {f('phone', t('rm.business.phone'), 30, 'tel', 'tel')}
        {f('email', t('rm.business.email'), 120, 'email', 'email')}
        {f('abn', t('rm.business.abn'), 40)}
        {f('address', t('rm.business.address'), 200, 'text', 'street-address')}
        {err}
        <Button type="submit" className="mt-3">{t('rm.next')}</Button>
        {back(null)}
      </form>,
    );
  }

  if (step === 'country') {
    return wrap(
      <>
        <h1 className="text-large-title font-bold">{t('rm.setup.countryTitle')}</h1>
        {(['AU', 'BD'] as const).map((c) => (
          <button key={c} type="button" onClick={() => setCountry(c)} aria-pressed={country === c}
            className={`rounded-md border p-4 text-left ${country === c ? 'border-accent bg-surface-2' : 'border-separator'}`}>
            <div className="font-semibold">{t(c === 'AU' ? 'rm.country.AU' : 'rm.country.BD')}</div>
            <div className="text-subhead text-text-2">{t(c === 'AU' ? 'rm.country.AUHint' : 'rm.country.BDHint')}</div>
          </button>
        ))}
        {country === 'BD' && (
          <fieldset className="mt-2">
            <legend className="mb-1 text-subhead text-text-2">{t('rm.unit.title')}</legend>
            <div className="flex gap-2">
              {(['ft3', 'm3'] as const).map((u) => (
                <Button key={u} variant={unit === u ? 'primary' : 'secondary'} aria-pressed={unit === u} className="flex-1" onClick={() => setUnit(u)}>
                  {t(u === 'm3' ? 'rm.unit.m3' : 'rm.unit.ft3')}
                </Button>
              ))}
            </div>
          </fieldset>
        )}
        <Button className="mt-3" onClick={() => setStep('warning')}>{t('rm.next')}</Button>
        {back('business')}
      </>,
    );
  }

  if (step === 'warning') {
    return wrap(
      <>
        <h1 className="text-large-title font-bold">{t('rm.setup.warningTitle')}</h1>
        <p className="rounded-md bg-surface-2 p-3 text-subhead text-warning">{t('rm.setup.warning')}</p>
        <Button className="mt-3" onClick={() => setStep(needCode && !codeDone ? 'code' : 'trucks')}>{t('rm.setup.understood')}</Button>
        {back('country')}
      </>,
    );
  }

  if (step === 'code') {
    return <div className="mx-auto max-w-md px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))]"><RecoveryCodeSetup db={db} t={t} onDone={() => { setCodeDone(true); setStep('trucks'); }} /></div>;
  }

  return wrap(
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void create(true); }}>
      <h1 className="text-large-title font-bold">{t('rm.setup.trucksTitle')}</h1>
      <p className="text-text-2">{t('rm.setup.trucksHint')}</p>
      <p className="text-subhead font-semibold text-warning">{t('rm.setup.example')}</p>
      <ul className="flex flex-col gap-2" aria-label={t('rm.settings.trucks')}>
        {trucks.map((tr, i) => (
          <li key={i} className="flex items-end gap-2 rounded-md bg-surface p-2">
            <label className="flex-1">
              <span className="mb-1 block text-footnote text-text-2">{t('rm.truck.name')}</span>
              <input className={inputClass} maxLength={40} value={tr.name}
                onChange={(e) => setTrucks(trucks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            </label>
            <label className="w-28">
              <span className="mb-1 block text-footnote text-text-2">{t('rm.truck.capacity')}</span>
              <input className={inputClass} inputMode="decimal" value={tr.capacity}
                onChange={(e) => setTrucks(trucks.map((x, j) => (j === i ? { ...x, capacity: e.target.value } : x)))} />
            </label>
            <IconButton icon={X} label={t('rm.truck.remove')} className="text-text-2" onClick={() => setTrucks(trucks.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ul>
      {trucks.length < 10 && (
        <Button variant="secondary" onClick={() => setTrucks([...trucks, { name: t('rm.truck.exampleName', { n: trucks.length + 1 }), capacity: '' }])}>{t('rm.truck.add')}</Button>
      )}
      {err}
      <Button type="submit" className="mt-2" disabled={busy}>{busy ? t('rm.setup.creating') : t('rm.setup.finish')}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => void create(false)}>{t('rm.setup.skipTrucks')}</Button>
      {back('warning')}
    </form>,
  );
}
