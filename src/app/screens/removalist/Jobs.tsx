// Removalist Jobs tab, the job form and the job screen (plan §6). Other job sections come in later phases.
import { useCallback, useEffect, useState, type InputHTMLAttributes } from 'react';
import { MapPin, Phone, Plus, Search, X } from 'lucide-react';
import { PiecesSection } from './Pieces';
import { ChecksSection } from './LoadCheck';
import { useApp } from '../../context';
import { navigate } from '../../router';
import { Button, Field, Group, Icon, IconButton, Page, Row, inputClass } from '../../ui';
import { WorkerError } from '../../../core/db/client';
import { defaultLabelName, JOB_STATUSES, type JobFilter, type JobInput, type JobRow, type JobStatus } from '../../../core/repo/removalist/jobs';
import type { Key } from '../../../i18n/i18n';

const FILTERS: readonly JobFilter[] = ['upcoming', 'today', 'in_progress', 'closed'];

/** "J-0042" with the screen language's digits. */
export const showJobNumber = (n: number, num: (n: number) => string): string => `J-${num(n).padStart(4, num(0))}`;

/** The phone's local date, YYYY-MM-DD (move dates are stored as local time). */
export function localToday(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Suburb or area from an address: the last part after a comma, skipping a trailing "NSW 2150" or postcode. */
export function areaOf(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  let last = parts[parts.length - 1] ?? null;
  if (last && parts.length > 1 && /^([A-Z]{2,3}\s*)?\d{3,4}$/.test(last)) last = parts[parts.length - 2] ?? last;
  return last;
}

export function StatusChip({ status, archived }: { status: JobStatus; archived?: boolean }) {
  const { t } = useApp();
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-surface-2 px-2 py-0.5 text-caption text-text">
      {archived ? t('rm.jobs.archived') : t(`rm.status.${status}` as Key)}
    </span>
  );
}

export function JobsPage() {
  const { db, workspace, t, date, num } = useApp();
  const ws = workspace!;
  const [filter, setFilter] = useState<JobFilter | null>(null);
  const [q, setQ] = useState('');
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [any, setAny] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const today = localToday();
    setJobs(await db.listJobs(ws.id, { filter, q, today }));
    // Any job at all? Open jobs (no filter) plus Closed and archived ones cover every job outside the Bin.
    if (any !== true) setAny((await db.listJobs(ws.id, { today })).length + (await db.listJobs(ws.id, { filter: 'closed', today })).length > 0);
  }, [db, ws.id, filter, q, any]);
  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 120 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  const moveText = (j: JobRow) => (j.moveAt ? date(j.moveAt.length === 10 ? `${j.moveAt}T00:00` : j.moveAt, j.moveAt.length > 10) : t('rm.jobs.noDate'));
  const progress = (j: JobRow) => (j.loaded > 0 ? t('rm.jobs.loaded', { loaded: j.loaded, n: j.pieces }) : t('rm.jobs.pieces', { n: j.pieces }));

  return (
    <Page title={t('rm.jobs.title')} actions={<IconButton icon={Plus} label={t('rm.jobs.new')} onClick={() => navigate('/job/new')} />}>
      <div className="relative">
        <Icon as={Search} size={18} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
        <input type="search" className="min-h-11 w-full rounded-md bg-surface-2 pl-9 pr-10 text-body text-text placeholder:text-text-2 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          placeholder={t('rm.jobs.search')} aria-label={t('rm.jobs.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <IconButton icon={X} label={t('home.searchClear')} className="absolute right-0 top-0 text-text-2" onClick={() => setQ('')} />}
      </div>
      <div role="group" aria-label={t('rm.jobs.filters')} className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(filter === f ? null : f)}
            className={`min-h-11 rounded-full px-4 text-subhead font-semibold ${filter === f ? 'bg-accent-fill text-on-accent' : 'bg-surface-2 text-accent-on-grey'}`}>
            {t(`rm.filter.${f}` as Key)}
          </button>
        ))}
      </div>
      {any === false && !q ? (
        <div className="py-10 text-center">
          <p className="text-body text-text-2">{t('rm.jobs.empty')}</p>
          <Button className="mt-4 w-full" onClick={() => navigate('/job/new')}>{t('rm.jobs.addFirst')}</Button>
        </div>
      ) : jobs && jobs.length === 0 ? (
        <p className="py-10 text-center text-body text-text-2">{q ? t('home.noResults') : t('rm.jobs.none')}</p>
      ) : (
        <ul className="group-list mt-4 overflow-hidden rounded-md bg-surface" aria-label="jobs">
          {jobs?.map((j) => {
            const area = areaOf(j.pickupAddress) ?? areaOf(j.deliveryAddress);
            return (
              <li key={j.id}>
                <button type="button" onClick={() => navigate(`/job/${j.id}`)} className="flex min-h-11 w-full items-start gap-3 px-4 py-2.5 text-left active:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-text">{j.customerName}</span>
                    <span className="block text-subhead text-text-2">
                      <span className="num">{showJobNumber(j.number, num)}</span> · {moveText(j)}{area ? ` · ${area}` : ''}
                    </span>
                    <span className="block text-footnote text-text-2">{progress(j)}</span>
                  </span>
                  <StatusChip status={j.status} archived={!!j.archivedAt} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}

type Draft = Required<{ [K in keyof JobInput]: string }>;
const empty: Draft = { customerName: '', customerLabelName: '', customerPhone: '', customerEmail: '', pickupAddress: '', deliveryAddress: '', moveAt: '', crewLeader: '', notes: '', truckId: '' };

/** New job and edit job. The label name follows the customer's last name until it is typed over. */
export function JobForm({ id }: { id?: string }) {
  const { db, workspace, t, showUpgrade, toast } = useApp();
  const [d, setD] = useState<Draft>(empty);
  const [labelTouched, setLabelTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    if (!id) return;
    void db.getJob(id).then((j) => {
      if (!j) return;
      setD({
        customerName: j.customerName, customerLabelName: j.customerLabelName, customerPhone: j.customerPhone ?? '', customerEmail: j.customerEmail ?? '',
        pickupAddress: j.pickupAddress ?? '', deliveryAddress: j.deliveryAddress ?? '', moveAt: j.moveAt ?? '', crewLeader: j.crewLeader ?? '',
        notes: j.notes ?? '', truckId: j.truckId ?? '',
      });
      setLabelTouched(true);
      setLoaded(true);
    });
  }, [db, id]);

  const set = (k: keyof Draft, v: string) => {
    setError(null);
    if (k === 'customerName' && !labelTouched) setD({ ...d, customerName: v, customerLabelName: defaultLabelName(v) });
    else setD({ ...d, [k]: v });
  };
  const save = async () => {
    if (!d.customerName.trim()) { setError(t('rm.job.customerRequired')); return; }
    const input: JobInput = {
      customerName: d.customerName, customerLabelName: d.customerLabelName.trim() || defaultLabelName(d.customerName),
      customerPhone: d.customerPhone, customerEmail: d.customerEmail, pickupAddress: d.pickupAddress, deliveryAddress: d.deliveryAddress,
      moveAt: d.moveAt || null, crewLeader: d.crewLeader, notes: d.notes,
    };
    try {
      if (id) {
        await db.updateJob(id, input);
        toast(t('rm.saved'));
        navigate(`/job/${id}`, true);
      } else {
        const j = await db.createJob(workspace!.id, input);
        navigate(`/job/${j.id}`, true);
      }
    } catch (e) {
      if (e instanceof WorkerError && e.reason) showUpgrade(e.reason);
      else setError(t('error.generic', { msg: (e as Error).message }));
    }
  };
  const input = (k: keyof Draft, label: string, max: number, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <Field label={label}>
      <input className={inputClass} maxLength={max} value={d[k]} onChange={(e) => set(k, e.target.value)} {...extra} />
    </Field>
  );
  if (!loaded) return null;
  return (
    <Page title={id ? t('rm.job.editTitle') : t('rm.jobs.new')} back={() => navigate(id ? `/job/${id}` : '/')}>
      <form className="flex flex-col pt-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {input('customerName', t('rm.job.customer'), 80, { autoComplete: 'off', required: true })}
        <Field label={t('rm.job.labelName')}>
          <input className={inputClass} maxLength={40} value={d.customerLabelName} onChange={(e) => { setLabelTouched(true); set('customerLabelName', e.target.value); }} />
          <span className="mt-1 block text-footnote text-text-2">{t('rm.job.labelNameHint')}</span>
        </Field>
        {input('customerPhone', t('rm.job.phone'), 30, { type: 'tel', autoComplete: 'off' })}
        {input('customerEmail', t('rm.job.email'), 120, { type: 'email', autoComplete: 'off' })}
        {input('pickupAddress', t('rm.job.pickup'), 200, { autoComplete: 'off' })}
        {input('deliveryAddress', t('rm.job.delivery'), 200, { autoComplete: 'off' })}
        {input('moveAt', t('rm.job.moveAt'), 16, { type: 'datetime-local' })}
        {input('crewLeader', t('rm.job.crewLeader'), 80, { autoComplete: 'off' })}
        <Field label={t('rm.job.notes')}>
          <textarea className={`${inputClass} py-2`} rows={3} maxLength={2000} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <Button type="submit" className="mt-3">{t('rm.job.save')}</Button>
      </form>
    </Page>
  );
}

export function JobPage({ id }: { id: string }) {
  const { db, t, date, toast, num } = useApp();
  const [job, setJob] = useState<JobRow | null | undefined>(undefined);
  const load = useCallback(() => db.getJob(id).then((j) => setJob(j && !j.deletedAt ? j : null)), [db, id]);
  useEffect(() => { void load(); }, [load]);

  if (job === undefined) return null;
  if (job === null) {
    return <Page title={t('rm.jobs.title')} back={() => navigate('/')}><p className="py-6">{t('rm.job.notFound')}</p></Page>;
  }
  const shownNumber = showJobNumber(job.number, num);
  const changeStatus = async (s: JobStatus) => {
    if (s === job.status) return;
    if (!confirm(t('rm.job.statusConfirm', { status: t(`rm.status.${s}` as Key) }))) { setJob({ ...job }); return; }
    await db.setJobStatus(job.id, s);
    await load();
  };
  const bin = async () => {
    if (!confirm(t('rm.job.binConfirm', { job: shownNumber }))) return;
    await db.binJob(job.id);
    toast(t('rm.job.binned', { job: shownNumber }));
    navigate('/', true);
  };
  const archive = async (on: boolean) => { await db.archiveJob(job.id, on); await load(); };
  const mapUrl = (a: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;
  const moveText = job.moveAt ? date(job.moveAt.length === 10 ? `${job.moveAt}T00:00` : job.moveAt, job.moveAt.length > 10) : t('rm.jobs.noDate');

  return (
    <Page title={<><span className="num">{shownNumber}</span> · {job.customerLabelName}</>} back={() => navigate('/')}
      actions={<button type="button" className="min-h-11 px-2 text-body text-accent active:opacity-60" onClick={() => navigate(`/job/${job.id}/edit`)}>{t('rm.job.edit')}</button>}>
      <h2 className="pt-3 text-title2">{job.customerName}</h2>
      <p className="flex items-center gap-2 pt-1 text-subhead text-text-2"><StatusChip status={job.status} archived={!!job.archivedAt} /> {moveText}</p>

      <Group title={t('rm.job.overview')}>
        <li className="flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
          <label htmlFor="job-status" className="text-body">{t('rm.job.status')}</label>
          <select id="job-status" className="min-h-11 rounded-md bg-surface-2 px-3 text-body text-accent-on-grey" value={job.status}
            onChange={(e) => void changeStatus(e.target.value as JobStatus)}>
            {JOB_STATUSES.map((s) => <option key={s} value={s}>{t(`rm.status.${s}` as Key)}</option>)}
          </select>
        </li>
        {job.customerPhone && (
          <li><a href={`tel:${job.customerPhone.replace(/[^\d+]/g, '')}`} className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-body text-accent active:bg-surface-2">
            <Icon as={Phone} size={20} />{t('rm.job.call', { phone: job.customerPhone })}</a></li>
        )}
        {job.customerEmail && <Row title={job.customerEmail} detail={t('rm.job.email')} chevron={false} />}
        {([['pickupAddress', 'rm.job.pickup'], ['deliveryAddress', 'rm.job.delivery']] as const).map(([k, label]) => job[k] && (
          <li key={k}><a href={mapUrl(job[k]!)} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-3 px-4 py-2.5 active:bg-surface-2">
            <Icon as={MapPin} size={20} className="text-accent" />
            <span className="min-w-0 flex-1"><span className="block text-subhead text-text-2">{t(label)}</span><span className="block text-body text-text">{job[k]}</span></span>
            <span className="text-subhead text-accent">{t('rm.job.map')}</span>
          </a></li>
        ))}
        {job.crewLeader && <Row title={job.crewLeader} detail={t('rm.job.crewLeader')} chevron={false} />}
        {job.notes && <li className="whitespace-pre-wrap px-4 py-2.5 text-body"><span className="block text-subhead text-text-2">{t('rm.job.notes')}</span>{job.notes}</li>}
      </Group>

      <PiecesSection jobId={job.id} onChanged={() => void load()} />
      <ChecksSection job={job} />

      <Group title={t('rm.job.sections')} footer={t('rm.section.soon')}>
        {(['rm.section.volume', 'rm.section.condition', 'rm.section.share'] as const).map((k) => (
          <Row key={k} title={t(k)} chevron={false} disabled aria-disabled="true" />
        ))}
      </Group>

      <div className="mt-8 flex flex-col items-center gap-2">
        {job.signed ? (
          <p className="px-4 text-center text-footnote text-text-2" data-testid="signed-note">{t('rm.job.signedArchiveOnly')}</p>
        ) : (
          <Button variant="danger" onClick={bin}>{t('rm.job.bin')}</Button>
        )}
        {job.archivedAt
          ? <Button variant="ghost" onClick={() => archive(false)}>{t('rm.job.unarchive')}</Button>
          : (job.signed || job.status === 'closed') && <Button variant="ghost" onClick={() => archive(true)}>{t('rm.job.archive')}</Button>}
        {job.archivedAt && <p className="text-footnote text-text-2">{t('rm.job.archivedNote')}</p>}
      </div>
    </Page>
  );
}
