// Removalist settings: business details, trucks and the volume list (plan §6). Opened from the Settings tab.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context';
import { navigate } from '../../router';
import { Button, Field, Group, IconButton, Page, Row, inputClass } from '../../ui';
import { Trash2 } from 'lucide-react';
import type { BusinessProfile, Truck, VolumeItem } from '../../../core/repo';
import { parseCapacity } from './Setup';
import { SHEETS, type SheetId } from '../../../core/labels/layout';

/** Rows for the Settings tab. */
export function RemovalistSettingsRows() {
  const { t } = useApp();
  return (
    <Group title={t('setup.removalist')}>
      <Row title={t('rm.settings.business')} onClick={() => navigate('/business')} />
      <Row title={t('rm.settings.trucks')} onClick={() => navigate('/trucks')} />
      <Row title={t('rm.settings.catalogue')} onClick={() => navigate('/volume-catalogue')} />
    </Group>
  );
}

export function BusinessPage() {
  const { db, workspace, setWorkspace, t, toast } = useApp();
  const ws = workspace!;
  const [p, setP] = useState<BusinessProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void db.getBusinessProfile(ws.id).then((x) => setP(x ?? null)); }, [db, ws.id]);
  if (!p) return null;
  const set = (k: keyof BusinessProfile, v: string) => { setError(null); setP({ ...p, [k]: v }); };
  const save = async () => {
    if (!p.name.trim() || !p.phone.trim()) { setError(t('rm.business.required')); return; }
    try {
      await db.updateBusinessProfile(ws.id, { name: p.name, phone: p.phone, email: p.email, abnOrLicence: p.abnOrLicence, address: p.address, volumeUnit: p.volumeUnit, labelSheet: p.labelSheet });
      setWorkspace((await db.getWorkspace(ws.id)) ?? ws);
      toast(t('rm.saved'));
    } catch (e) {
      setError(/email/.test((e as Error).message) ? t('rm.business.emailBad') : t('error.generic', { msg: (e as Error).message }));
    }
  };
  const f = (k: 'name' | 'phone' | 'email' | 'abnOrLicence' | 'address', label: string, max: number, type = 'text') => (
    <Field label={label}><input className={inputClass} type={type} maxLength={max} value={p[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Field>
  );
  return (
    <Page title={t('rm.settings.business')} back={() => navigate('/settings')}>
      <form className="flex flex-col pt-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {f('name', t('rm.business.name'), 80)}
        {f('phone', t('rm.business.phone'), 30, 'tel')}
        {f('email', t('rm.business.email'), 120, 'email')}
        {f('abnOrLicence', t('rm.business.abn'), 40)}
        {f('address', t('rm.business.address'), 200)}
        <Field label={t('rm.unit.title')}>
          <select className={inputClass} value={p.volumeUnit} onChange={(e) => setP({ ...p, volumeUnit: e.target.value as BusinessProfile['volumeUnit'] })}>
            <option value="m3">{t('rm.unit.m3')}</option>
            <option value="ft3">{t('rm.unit.ft3')}</option>
          </select>
        </Field>
        <Field label={t('rm.labels.defaultSheet')}>
          <select className={inputClass} value={p.labelSheet} onChange={(e) => setP({ ...p, labelSheet: e.target.value })}>
            {(Object.keys(SHEETS) as SheetId[]).map((s) => <option key={s} value={s}>{SHEETS[s].name}</option>)}
          </select>
        </Field>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <Button type="submit" className="mt-3">{t('box.save')}</Button>
      </form>
    </Page>
  );
}

export function TrucksPage() {
  const { db, workspace, t, toast } = useApp();
  const ws = workspace!;
  const [trucks, setTrucks] = useState<(Truck & { cap: string })[] | null>(null);
  const [add, setAdd] = useState({ name: '', cap: '' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => db.listTrucks(ws.id).then((l) => setTrucks(l.map((x) => ({ ...x, cap: String(x.capacityM3) })))), [db, ws.id]);
  useEffect(() => { void load(); }, [load]);
  const valid = (name: string, cap: string) => name.trim() && parseCapacity(cap) > 0 && parseCapacity(cap) <= 500;
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); setError(null); await load(); } catch (e) { setError(t('error.generic', { msg: (e as Error).message })); }
  };
  return (
    <Page title={t('rm.settings.trucks')} back={() => navigate('/settings')}>
      {trucks?.length === 0 && <p className="py-6 text-center text-text-2">{t('rm.trucks.empty')}</p>}
      <ul className="mt-2 flex flex-col gap-2" aria-label={t('rm.settings.trucks')}>
        {trucks?.map((tr, i) => (
          <li key={tr.id}>
            <form className="flex items-end gap-2 rounded-md bg-surface p-2" onSubmit={(e) => {
              e.preventDefault();
              if (!valid(tr.name, tr.cap)) { setError(t('rm.truck.bad')); return; }
              void run(async () => { await db.updateTruck(tr.id, { name: tr.name, capacityM3: parseCapacity(tr.cap) }); toast(t('rm.saved')); });
            }}>
              <label className="flex-1"><span className="mb-1 block text-footnote text-text-2">{t('rm.truck.name')}</span>
                <input className={inputClass} maxLength={40} value={tr.name} onChange={(e) => setTrucks(trucks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></label>
              <label className="w-24"><span className="mb-1 block text-footnote text-text-2">{t('rm.truck.capacity')}</span>
                <input className={inputClass} inputMode="decimal" value={tr.cap} onChange={(e) => setTrucks(trucks.map((x, j) => (j === i ? { ...x, cap: e.target.value } : x)))} /></label>
              <Button type="submit" variant="secondary">{t('box.save')}</Button>
              <IconButton icon={Trash2} label={t('rm.truck.remove')} className="text-danger" onClick={() => run(() => db.deleteTruck(tr.id))} />
            </form>
          </li>
        ))}
      </ul>
      <form className="mt-6 flex items-end gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!valid(add.name, add.cap)) { setError(t('rm.truck.bad')); return; }
        void run(async () => { await db.addTruck(ws.id, { name: add.name, capacityM3: parseCapacity(add.cap) }); setAdd({ name: '', cap: '' }); });
      }}>
        <label className="flex-1"><span className="mb-1 block text-footnote text-text-2">{t('rm.truck.name')}</span>
          <input className={inputClass} maxLength={40} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
        <label className="w-24"><span className="mb-1 block text-footnote text-text-2">{t('rm.truck.capacity')}</span>
          <input className={inputClass} inputMode="decimal" value={add.cap} onChange={(e) => setAdd({ ...add, cap: e.target.value })} /></label>
        <Button type="submit">{t('rm.truck.add')}</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    </Page>
  );
}

export function VolumeCataloguePage() {
  const { db, workspace, t, lang } = useApp();
  const ws = workspace!;
  const [items, setItems] = useState<VolumeItem[] | null>(null);
  const [defaultBox, setDefaultBox] = useState<string | null>(null);
  useEffect(() => {
    void db.listVolumeCatalogue(ws.id).then(setItems);
    void db.getBusinessProfile(ws.id).then((p) => setDefaultBox(p?.defaultBoxItemId ?? null));
  }, [db, ws.id]);
  const name = (v: VolumeItem) => (lang === 'bn' ? v.nameBn ?? v.nameEn : v.nameEn ?? v.nameBn) ?? '';
  const m3 = (n: number) => `${new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} m³`;
  return (
    <Page title={t('rm.settings.catalogue')} back={() => navigate('/settings')}>
      <p className="px-1 pt-2 text-footnote text-text-2" data-testid="catalogue-starter">{t('rm.catalogue.starter')}</p>
      <Group label={t('rm.settings.catalogue')}>
        {items?.map((v) => <Row key={v.id} title={name(v)} detail={v.id === defaultBox ? t('rm.catalogue.defaultBox') : undefined} trailing={<span className="num">{m3(v.volumeM3)}</span>} chevron={false} />)}
      </Group>
    </Page>
  );
}
