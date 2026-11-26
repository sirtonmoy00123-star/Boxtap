// Volume estimate of a job (plan §5, Phase 5): counted boxes and furniture, extra lines with + / −, a buffer, and the
// suggested truck. Shown in the business's unit (m³ or ft³), stored in m³. Volume only: no prices, no quotes.
import { useCallback, useEffect, useState } from 'react';
import { Minus, Plus, Search, Truck } from 'lucide-react';
import { useApp } from '../../context';
import { navigate } from '../../router';
import { Button, Field, Group, Icon, IconButton, Page, Row, inputClass } from '../../ui';
import type { JobRow, JobVolume, VolumeItem } from '../../../core/repo';
import { formatVolume, parseVolume, type VolumeUnit } from '../../../core/removalist/volumeMath';
import { asciiDigits } from '../../../i18n/i18n';
import { showJobNumber } from './Jobs';

type T = ReturnType<typeof useApp>['t'];
const truckText = (t: T, v: JobVolume, unit: VolumeUnit, lang: 'en' | 'bn') => {
  if (v.truck.kind === 'fits') return t('rm.vol.truck', { name: v.truck.truck.name, size: formatVolume(v.truck.truck.capacityM3, unit, lang) });
  if (v.truck.kind === 'tooBig') return t('rm.vol.tooBig', { name: v.truck.largest.name, size: formatVolume(v.truck.largest.capacityM3, unit, lang) });
  return null;
};

/** Job screen row: total and the truck. */
export function VolumeSection({ job }: { job: JobRow }) {
  const { db, workspace, t, lang } = useApp();
  const [v, setV] = useState<JobVolume | null>(null);
  const [unit, setUnit] = useState<VolumeUnit>('m3');
  useEffect(() => {
    void db.jobVolume(job.id).then(setV);
    void db.getBusinessProfile(workspace!.id).then((p) => setUnit(p?.volumeUnit ?? 'm3'));
  }, [db, job.id, job.updatedAt, workspace]);
  const detail = v ? [formatVolume(v.totalM3, unit, lang), truckText(t, v, unit, lang)].filter(Boolean).join(' · ') : undefined;
  return (
    <Group title={t('rm.section.volume')}>
      <Row title={t('rm.vol.row')} detail={detail} lead={<Icon as={Truck} size={20} className="text-text-2" />} onClick={() => navigate(`/job/${job.id}/volume`)} />
    </Group>
  );
}

export function VolumePage({ id }: { id: string }) {
  const { db, workspace, t, lang, num } = useApp();
  const ws = workspace!;
  const [job, setJob] = useState<JobRow | null>(null);
  const [v, setV] = useState<JobVolume | null>(null);
  const [unit, setUnit] = useState<VolumeUnit>('m3');
  const [items, setItems] = useState<VolumeItem[]>([]);
  const [q, setQ] = useState('');
  const [buffer, setBuffer] = useState('');
  const [custom, setCustom] = useState({ name: '', size: '' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [j, vol, p, cat] = await Promise.all([db.getJob(id), db.jobVolume(id), db.getBusinessProfile(ws.id), db.listVolumeCatalogue(ws.id)]);
    setJob(j ?? null); setV(vol); setUnit(p?.volumeUnit ?? 'm3'); setItems(cat);
    return vol;
  }, [db, id, ws.id]);
  useEffect(() => { const timer = setTimeout(() => void load().then((vol) => setBuffer(String(vol.bufferPct))), 0); return () => clearTimeout(timer); }, [load]);
  if (!job || !v) return null;

  const name = (en: string | null, bn: string | null) => (lang === 'bn' ? bn ?? en : en ?? bn) ?? '';
  const vol = (m3: number) => formatVolume(m3, unit, lang);
  const saveBuffer = async () => {
    const n = Number(asciiDigits(buffer).trim());
    if (!Number.isInteger(n) || n < 0 || n > 100) { setError(t('rm.vol.bufferBad')); return; }
    setError(null);
    await db.setBufferPct(ws.id, n);
    await load();
  };
  const addCustom = async () => {
    const m3 = parseVolume(custom.size, unit);
    if (!custom.name.trim() || !(m3 > 0) || m3 > 50) { setError(t('rm.vol.customBad')); return; }
    setError(null);
    await db.addVolumeLine(id, { name: custom.name, m3Each: m3 });
    setCustom({ name: '', size: '' });
    await load();
  };
  const needle = q.trim().toLowerCase();
  const found = needle ? items.filter((c) => `${c.nameEn ?? ''} ${c.nameBn ?? ''}`.toLowerCase().includes(needle)).slice(0, 8) : [];
  const truck = truckText(t, v, unit, lang);

  return (
    <Page title={t('rm.vol.title', { job: showJobNumber(job.number, num) })} back={() => navigate(`/job/${id}`)}>
      <section className="mt-3 rounded-md bg-surface p-4" aria-label={t('rm.vol.total')}>
        <p className="text-subhead text-text-2">{t('rm.vol.total')}</p>
        <p className="num text-large-title" data-testid="vol-total">{vol(v.totalM3)}</p>
        <p className="num text-subhead text-text-2" data-testid="vol-needed">{t('rm.vol.withBuffer', { pct: v.bufferPct, needed: vol(v.neededM3) })}</p>
        <p className={`mt-2 flex items-center gap-2 text-headline ${v.truck.kind === 'tooBig' ? 'text-warning' : 'text-text'}`} data-testid="vol-truck">
          <Icon as={Truck} size={22} />{truck ?? t('rm.vol.noTrucks')}
        </p>
        <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void saveBuffer(); }}>
          <label className="w-28"><span className="mb-1 block text-footnote text-text-2">{t('rm.vol.buffer')}</span>
            <input className={inputClass} inputMode="numeric" value={buffer} onChange={(e) => setBuffer(e.target.value)} /></label>
          <Button type="submit" variant="secondary">{t('box.save')}</Button>
        </form>
        <p className="mt-2 text-footnote text-text-2">{t('rm.vol.noPrices')}</p>
      </section>

      <Group title={t('rm.vol.counted')} footer={t('rm.vol.countedNote')} label={t('rm.vol.counted')}>
        {v.counted.map((g) => (
          <Row key={`${g.isPiece}-${g.item.id}`} chevron={false} title={t('rm.vol.groupLine', { name: name(g.item.nameEn, g.item.nameBn), n: g.count })}
            trailing={<span className="num">{vol(g.item.m3 * g.count)}</span>} />
        ))}
        {v.counted.length === 0 && <li className="px-4 py-2.5 text-body text-text-2">{t('rm.pieces.empty')}</li>}
      </Group>
      {v.uncounted.length > 0 && (
        <p className="px-4 pt-1.5 text-footnote text-warning" data-testid="vol-uncounted">
          {t('rm.vol.uncounted', { list: v.uncounted.map((p) => `${t(p.isPiece ? 'rm.piece.n' : 'rm.box.n', { n: p.jobSeq ?? 0 })}${p.name ? ` (${p.name})` : ''}`).join(', ') })}
        </p>
      )}

      <section className="mt-6" aria-label={t('rm.vol.lines')}>
        <h2 className="px-4 pb-1.5 text-footnote text-text-2">{t('rm.vol.lines')}</h2>
        <ul className="group-list overflow-hidden rounded-md bg-surface" aria-label={t('rm.vol.lines')}>
          {v.lines.length === 0 && <li className="px-4 py-2.5 text-body text-text-2">{t('rm.vol.noLines')}</li>}
          {v.lines.map((l) => {
            const n = l.name ?? name(l.nameEn, l.nameBn);
            return (
              <li key={l.id} className="flex min-h-11 items-center gap-2 px-4 py-1.5">
                <span className="min-w-0 flex-1 text-body">{n}</span>
                <IconButton icon={Minus} label={t('rm.vol.minus', { name: n })} onClick={async () => { await db.bumpVolumeLine(l.id, -1); await load(); }} />
                <span className="num w-8 text-center text-headline" data-testid="line-qty">{num(l.quantity)}</span>
                <IconButton icon={Plus} label={t('rm.vol.plus', { name: n })} onClick={async () => { await db.bumpVolumeLine(l.id, 1); await load(); }} />
                <span className="num w-24 text-right text-subhead text-text-2">{vol(l.m3Each * l.quantity)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="relative mt-4">
        <Icon as={Search} size={18} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
        <input type="search" className="min-h-11 w-full rounded-md bg-surface-2 pl-9 pr-3 text-body text-text placeholder:text-text-2 focus:outline-none"
          placeholder={t('rm.vol.search')} aria-label={t('rm.vol.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {found.length > 0 && (
        <ul className="mt-2 group-list overflow-hidden rounded-md bg-surface" aria-label={t('rm.vol.search')}>
          {found.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left active:bg-surface-2"
                onClick={async () => { await db.addVolumeLine(id, { volumeItemId: c.id }); await load(); }}>
                {/* The visible name is part of the button's name (WCAG label in name); "Add" is read first. */}
                <span className="text-body"><span className="sr-only">{t('rm.vol.addLine')} </span>{name(c.nameEn, c.nameBn)}</span>
                <span className="num flex items-center gap-2 text-subhead text-text-2">{vol(c.volumeM3)}<Icon as={Plus} size={20} className="text-accent" /></span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="mt-4 rounded-md bg-surface p-3" onSubmit={(e) => { e.preventDefault(); void addCustom(); }} aria-label={t('rm.vol.custom')}>
        <h2 className="text-footnote text-text-2">{t('rm.vol.custom')}</h2>
        <div className="flex items-end gap-2">
          <Field label={t('rm.vol.customName')}><input className={inputClass} maxLength={80} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} /></Field>
          <div className="w-28"><Field label={t('rm.vol.customSize', { unit: unit === 'ft3' ? 'ft³' : 'm³' })}><input className={inputClass} inputMode="decimal" value={custom.size} onChange={(e) => setCustom({ ...custom, size: e.target.value })} /></Field></div>
        </div>
        <Button type="submit" variant="secondary" className="w-full">{t('rm.vol.addLine')}</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    </Page>
  );
}
