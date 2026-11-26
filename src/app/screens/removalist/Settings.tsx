// Removalist settings: business details, trucks and the volume list (plan §6). Opened from the Settings tab.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context';
import { navigate } from '../../router';
import { Button, Field, Group, IconButton, Page, Row, inputClass } from '../../ui';
import { ChevronDown, ChevronUp, EyeOff, Trash2 } from 'lucide-react';
import type { BusinessProfile, Truck, VolumeItem } from '../../../core/repo';
import { formatVolume, parseVolume, roundFor, toUnit, type VolumeUnit } from '../../../core/removalist/volumeMath';
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

/** The business's volume unit (m³ or ft³) for showing and typing sizes. */
function useUnit(): VolumeUnit {
  const { db, workspace } = useApp();
  const [unit, setUnit] = useState<VolumeUnit>('m3');
  useEffect(() => { void db.getBusinessProfile(workspace!.id).then((p) => setUnit(p?.volumeUnit ?? 'm3')); }, [db, workspace]);
  return unit;
}
const unitName = (u: VolumeUnit) => (u === 'ft3' ? 'ft³' : 'm³');
/** A size in the unit, for an input box (no unit text, Western digits as typed). */
const sizeText = (m3: number, u: VolumeUnit) => String(roundFor(toUnit(m3, u), u));

export function TrucksPage() {
  const { db, workspace, t, toast } = useApp();
  const ws = workspace!;
  const unit = useUnit();
  const [trucks, setTrucks] = useState<(Truck & { cap: string })[] | null>(null);
  const [add, setAdd] = useState({ name: '', cap: '' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => db.listTrucks(ws.id).then((l) => setTrucks(l.map((x) => ({ ...x, cap: sizeText(x.capacityM3, unit) })))), [db, ws.id, unit]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  const m3 = (cap: string) => parseVolume(cap, unit);
  const valid = (name: string, cap: string) => name.trim() && m3(cap) > 0 && m3(cap) <= 500;
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); setError(null); await load(); } catch (e) { setError(t('error.generic', { msg: (e as Error).message })); }
  };
  const capLabel = t('rm.truck.capacityIn', { unit: unitName(unit) });
  return (
    <Page title={t('rm.settings.trucks')} back={() => navigate('/settings')}>
      {trucks?.length === 0 && <p className="py-6 text-center text-text-2">{t('rm.trucks.empty')}</p>}
      <ul className="mt-2 flex flex-col gap-2" aria-label={t('rm.settings.trucks')}>
        {trucks?.map((tr, i) => (
          <li key={tr.id}>
            <form className="flex items-end gap-2 rounded-md bg-surface p-2" onSubmit={(e) => {
              e.preventDefault();
              if (!valid(tr.name, tr.cap)) { setError(t('rm.truck.bad')); return; }
              void run(async () => { await db.updateTruck(tr.id, { name: tr.name, capacityM3: m3(tr.cap) }); toast(t('rm.saved')); });
            }}>
              <label className="flex-1"><span className="mb-1 block text-footnote text-text-2">{t('rm.truck.name')}</span>
                <input className={inputClass} maxLength={40} value={tr.name} onChange={(e) => setTrucks(trucks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></label>
              <label className="w-28"><span className="mb-1 block text-footnote text-text-2">{capLabel}</span>
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
        void run(async () => { await db.addTruck(ws.id, { name: add.name, capacityM3: m3(add.cap) }); setAdd({ name: '', cap: '' }); });
      }}>
        <label className="flex-1"><span className="mb-1 block text-footnote text-text-2">{t('rm.truck.name')}</span>
          <input className={inputClass} maxLength={40} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
        <label className="w-28"><span className="mb-1 block text-footnote text-text-2">{capLabel}</span>
          <input className={inputClass} inputMode="decimal" value={add.cap} onChange={(e) => setAdd({ ...add, cap: e.target.value })} /></label>
        <Button type="submit">{t('rm.truck.add')}</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    </Page>
  );
}

/** The volume list: starter values, edit, add, hide and reorder. Sizes in the business's unit, stored in m³. */
export function VolumeCataloguePage() {
  const { db, workspace, t, lang } = useApp();
  const ws = workspace!;
  const unit = useUnit();
  const [items, setItems] = useState<VolumeItem[] | null>(null);
  const [defaultBox, setDefaultBox] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; en: string; bn: string; size: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setItems(await db.listVolumeCatalogue(ws.id));
    setDefaultBox((await db.getBusinessProfile(ws.id))?.defaultBoxItemId ?? null);
  }, [db, ws.id]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  const name = (v: VolumeItem) => (lang === 'bn' ? v.nameBn ?? v.nameEn : v.nameEn ?? v.nameBn) ?? '';
  const save = async () => {
    if (!editing) return;
    const m3 = parseVolume(editing.size, unit);
    if ((!editing.en.trim() && !editing.bn.trim()) || !(m3 > 0) || m3 > 50) { setError(t('rm.cat.bad')); return; }
    const input = { nameEn: editing.en || null, nameBn: editing.bn || null, volumeM3: m3 };
    if (editing.id) await db.updateVolumeItem(editing.id, input); else await db.addVolumeItem(ws.id, input);
    setEditing(null);
    setError(null);
    await load();
  };
  const form = editing && (
    <form className="rounded-md bg-surface p-3" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label={editing.id ? t('rm.cat.edit') : t('rm.cat.add')}>
      <Field label={t('rm.cat.nameEn')}><input className={inputClass} maxLength={80} value={editing.en} onChange={(e) => setEditing({ ...editing, en: e.target.value })} /></Field>
      <Field label={t('rm.cat.nameBn')}><input className={inputClass} maxLength={80} value={editing.bn} onChange={(e) => setEditing({ ...editing, bn: e.target.value })} /></Field>
      <Field label={t('rm.cat.size', { unit: unitName(unit) })}><input className={inputClass} inputMode="decimal" value={editing.size} onChange={(e) => setEditing({ ...editing, size: e.target.value })} /></Field>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button type="submit" className="flex-1">{t('box.save')}</Button>
        <Button variant="ghost" onClick={() => { setEditing(null); setError(null); }}>{t('box.back')}</Button>
      </div>
    </form>
  );
  return (
    <Page title={t('rm.settings.catalogue')} back={() => navigate('/settings')}>
      <p className="px-1 pt-2 text-footnote text-text-2" data-testid="catalogue-starter">{t('rm.catalogue.starter')}</p>
      <ul aria-label={t('rm.settings.catalogue')} className="group-list mt-4 overflow-hidden rounded-md bg-surface">
        {items?.map((v, i) => (editing?.id === v.id ? <li key={v.id} className="p-1">{form}</li> : (
          <li key={v.id} className="flex min-h-11 items-center gap-1 px-2 py-1">
            <button type="button" className="min-h-11 min-w-0 flex-1 px-2 text-left" onClick={() => { setError(null); setEditing({ id: v.id, en: v.nameEn ?? '', bn: v.nameBn ?? '', size: sizeText(v.volumeM3, unit) }); }}>
              <span className="block text-body">{name(v)}</span>
              {v.id === defaultBox && <span className="block text-subhead text-text-2">{t('rm.catalogue.defaultBox')}</span>}
            </button>
            <span className="num text-body text-text-2">{formatVolume(v.volumeM3, unit, lang)}</span>
            <IconButton icon={ChevronUp} label={t('rm.cat.up', { name: name(v) })} disabled={i === 0} onClick={async () => { await db.moveVolumeItem(v.id, -1); await load(); }} />
            <IconButton icon={ChevronDown} label={t('rm.cat.down', { name: name(v) })} disabled={i === items.length - 1} onClick={async () => { await db.moveVolumeItem(v.id, 1); await load(); }} />
            {v.id !== defaultBox && (
              <IconButton icon={EyeOff} label={`${t('rm.cat.hide')} ${name(v)}`} className="text-text-2"
                onClick={async () => { if (confirm(t('rm.cat.hideConfirm', { name: name(v) }))) { await db.hideVolumeItem(v.id); await load(); } }} />
            )}
          </li>
        )))}
      </ul>
      <div className="mt-4">
        {editing && editing.id == null ? form : <Button variant="secondary" className="w-full" onClick={() => { setError(null); setEditing({ id: null, en: '', bn: '', size: '' }); }}>{t('rm.cat.add')}</Button>}
      </div>
    </Page>
  );
}
