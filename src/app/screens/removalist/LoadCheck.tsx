// Load and unload check (plan §8, Phase 3): continuous scanning with a big counter, manual ticks for damaged
// labels, and a finish step that asks why each missing piece is missing.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Hand, Sofa, TriangleAlert } from 'lucide-react';
import { useApp } from '../../context';
import { navigate } from '../../router';
import { Button, Field, Group, Icon, LabelTag, Page, Row, inputClass } from '../../ui';
import { platform } from '../../../core/pwa/install';
import { beep, buzz, installScanHook, keepScreenOn, serialFeed, startContinuousScan, type Signal } from '../../../core/scan/continuous';
import type { ScannerHandle, ScanResult } from '../../../core/scan/scanner';
import type { CheckState, Direction, JobRow, MissingReason, ScanOutcome } from '../../../core/repo';
import { MISSING_REASONS } from '../../../core/repo/removalist/events';
import { showJobNumber } from './Jobs';
import type { Key } from '../../../i18n/i18n';

type Msg = { tone: Signal; text: string } | null;

export function LoadCheckPage({ id, direction }: { id: string; direction: Direction }) {
  const { db, t, num, toast } = useApp();
  const d = direction;
  const [job, setJob] = useState<JobRow | null>(null);
  const [state, setState] = useState<CheckState | null>(null);
  const [counter, setCounter] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('starting');
  const [awake, setAwake] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [reasons, setReasons] = useState<Record<string, { reason: MissingReason | ''; note: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const seenAt = useRef<number | null>(null);
  const counterEl = useRef<HTMLParagraphElement>(null);

  const reload = useCallback(async () => {
    const s = await db.checkState(id, d);
    setState(s);
    setCounter({ done: s.done, total: s.total });
  }, [db, id, d]);
  useEffect(() => {
    void db.getJob(id).then((j) => setJob(j ?? null));
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [db, id, reload]);

  const what = useCallback((isPiece: boolean, seq: number) => t(isPiece ? 'rm.piece.n' : 'rm.box.n', { n: seq }), [t]);
  const signal = useCallback((kind: Signal, text: string) => {
    setMsg({ tone: kind, text });
    beep(kind);
    buzz(kind, platform() === 'android');
  }, []);

  // One handler for camera scans and the test hook: save, then show the outcome and the counter at once.
  const handle = useCallback(async (r: ScanResult, at: number) => {
    if (r.kind === 'other') { signal('warn', t('scan.notBoxtap')); return; }
    const o: ScanOutcome = await db.recordScan(id, d, r.code);
    if (o.kind === 'counted' || o.kind === 'already') {
      seenAt.current = at;
      setCounter({ done: o.done, total: o.total });
      const w = what(o.isPiece, o.seq);
      if (o.kind === 'already') signal('already', t(d === 'load' ? 'rm.load.already' : 'rm.unload.already', { what: w }));
      else signal('ok', o.notLoaded ? t('rm.unload.notLoaded', { what: w }) : t(d === 'load' ? 'rm.load.counted' : 'rm.unload.counted', { what: w }));
      void reload();
    } else if (o.kind === 'otherJob') {
      signal('warn', t('rm.scan.otherJob', { what: what(o.isPiece, o.seq), job: o.jobNumber, name: o.labelName }));
    } else if (o.kind === 'notInJob') {
      signal('warn', t('rm.scan.notInJob'));
    } else {
      signal('warn', t('label.notMine'));
    }
  }, [db, id, d, reload, signal, t, what]);
  const handleRef = useRef(handle);
  useEffect(() => { handleRef.current = handle; }, [handle]);

  // Camera, wake lock and the test hook live as long as the screen (not while finishing).
  const ready = !!(job && state && counter);
  useEffect(() => {
    if (finishing || !ready || !video.current) return;
    let live = true;
    let scanner: ScannerHandle | undefined;
    let release = () => {};
    const feed = serialFeed((r, at) => handleRef.current(r, at));
    const unhook = installScanHook((r) => void feed(r));
    void keepScreenOn().then((w) => { if (live) { setAwake(w.supported); release = w.release; } else w.release(); });
    void startContinuousScan(video.current!, (r, at) => handleRef.current(r, at))
      .then((h) => { if (live) { scanner = h; setCamera('on'); } else h.stop(); })
      .catch(() => { if (live) setCamera('off'); });
    return () => { live = false; unhook(); scanner?.stop(); release(); };
  }, [finishing, ready]);

  // Speed: time from the frame that held the code to the counter on screen (plan §8; measured in the E2E test).
  useLayoutEffect(() => {
    if (seenAt.current == null || !counterEl.current) return;
    const at = seenAt.current;
    requestAnimationFrame(() => { counterEl.current?.setAttribute('data-latency-ms', String(Math.round(performance.now() - at))); });
    seenAt.current = null;
  }, [counter]);

  if (!job || !state || !counter) return null;
  const jobNo = showJobNumber(job.number, num);
  const back = () => navigate(`/job/${id}`);
  const open = state.rows.filter((r) => !r.done && !r.missing);

  const finish = async () => {
    const bad = open.filter((r) => { const x = reasons[r.piece.id]; return !x?.reason || (x.reason === 'other' && !x.note.trim()); });
    if (bad.length) { setError(t('rm.check.needReason')); return; }
    try {
      await db.finishCheck(id, d, Object.fromEntries(open.map((r) => [r.piece.id, { reason: reasons[r.piece.id]!.reason as MissingReason, note: reasons[r.piece.id]!.note || null }])));
      toast(t(d === 'load' ? 'rm.load.done' : 'rm.unload.done'));
      back();
    } catch (e) {
      setError(t('error.generic', { msg: (e as Error).message }));
    }
  };

  if (finishing) {
    return (
      <Page title={t(d === 'load' ? 'rm.load.finish' : 'rm.unload.finish')} back={() => setFinishing(false)}>
        <p className="pt-3 text-headline num">{t(d === 'load' ? 'rm.load.counter' : 'rm.unload.counter', counter)}</p>
        {open.length === 0 ? <p className="py-4 text-body">{t('rm.check.missingNone')}</p> : (
          <section className="mt-4" aria-label={t('rm.check.missingTitle')}>
            <h2 className="px-1 pb-1.5 text-footnote text-text-2">{t('rm.check.missingTitle')}</h2>
            <ul className="flex flex-col gap-2">
              {open.map((r) => {
                const w = what(r.piece.isPiece, r.piece.jobSeq ?? 0);
                const x = reasons[r.piece.id] ?? { reason: '', note: '' };
                return (
                  <li key={r.piece.id} className="rounded-md bg-surface px-4 py-2">
                    <p className="text-body font-semibold">{r.piece.name ? `${w} · ${r.piece.name}` : w}</p>
                    <Field label={`${t('rm.reason.pick')} (${w})`}>
                      <select className={inputClass} value={x.reason} onChange={(e) => { setError(null); setReasons({ ...reasons, [r.piece.id]: { ...x, reason: e.target.value as MissingReason } }); }}>
                        <option value="">—</option>
                        {MISSING_REASONS.map((m) => <option key={m} value={m}>{t(`rm.reason.${m}` as Key)}</option>)}
                      </select>
                    </Field>
                    {x.reason === 'other' && (
                      <Field label={`${t('rm.reason.note')} (${w})`}>
                        <input className={inputClass} maxLength={200} value={x.note} onChange={(e) => setReasons({ ...reasons, [r.piece.id]: { ...x, note: e.target.value } })} />
                      </Field>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
        <Button className="mt-4 w-full" onClick={finish}>{t('rm.check.confirm')}</Button>
      </Page>
    );
  }

  return (
    <Page title={t(d === 'load' ? 'rm.load.title' : 'rm.unload.title', { job: jobNo })} back={back}>
      <div className="relative mt-2 overflow-hidden rounded-lg bg-camera" style={{ aspectRatio: camera === 'off' ? undefined : '4 / 3' }}>
        <video ref={video} className={`h-full w-full object-cover ${camera === 'off' ? 'hidden' : ''}`} muted playsInline aria-hidden="true" />
        {camera === 'off' && <p className="p-4 text-body text-on-accent">{t('rm.scan.noCamera')}</p>}
        {camera === 'on' && <p className="absolute inset-x-0 bottom-0 bg-scrim px-3 py-1.5 text-subhead text-on-accent">{t('rm.scan.cameraHint')}</p>}
      </div>
      <p ref={counterEl} className="num pt-4 text-center text-large-title" data-testid="check-counter">
        {t(d === 'load' ? 'rm.load.counter' : 'rm.unload.counter', counter)}
      </p>
      <div aria-live="assertive" className="min-h-12 pt-2" data-testid="check-message">
        {msg && (
          <p role={msg.tone === 'warn' ? 'alert' : 'status'}
            className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-center text-headline ${msg.tone === 'warn' ? 'bg-danger text-on-accent' : msg.tone === 'ok' ? 'text-success' : 'text-text-2'}`}>
            {msg.tone === 'warn' && <Icon as={TriangleAlert} size={22} />}{msg.text}
          </p>
        )}
      </div>
      {awake && <p className="text-center text-footnote text-text-2">{t(d === 'load' ? 'rm.load.keepOn' : 'rm.unload.keepOn')}</p>}
      {!awake && <p className="text-center text-footnote text-warning">{t(d === 'load' ? 'rm.load.keepOn' : 'rm.unload.keepOn')}</p>}

      <Group title={t('rm.pieces.title')} label={t('rm.pieces.title')}>
        {state.rows.map((r) => {
          const w = what(r.piece.isPiece, r.piece.jobSeq ?? 0);
          return (
            <li key={r.piece.id} className="flex min-h-11 items-center gap-3 px-4 py-1.5">
              {r.piece.isPiece ? <span className="grid h-11 w-11 shrink-0 place-items-center"><Icon as={Sofa} className="text-accent" /></span> : <LabelTag n={num(r.piece.jobSeq ?? 0)} />}
              <span className="min-w-0 flex-1 text-body">{r.piece.name ? `${w} · ${r.piece.name}` : w}</span>
              {r.done === 'scan' && <span className="flex items-center gap-1 text-subhead text-success"><Icon as={Check} size={18} />{t('rm.check.scanned')}</span>}
              {r.done === 'manual' && <span className="flex items-center gap-1 text-subhead text-success" data-testid="manual-tick"><Icon as={Hand} size={18} />{t('rm.check.manual')}</span>}
              {!r.done && r.missing && <span className="text-subhead text-text-2">{t(`rm.reason.${r.missing.reason}` as Key)}</span>}
              {!r.done && !r.missing && (
                <Button variant="secondary" aria-label={t('rm.check.tickLabel', { what: w })} onClick={async () => { await db.manualTick(id, d, r.piece.id); await reload(); }}>
                  <span className="inline-flex items-center gap-1.5"><Icon as={Hand} size={20} />{t('rm.check.tick')}</span>
                </Button>
              )}
            </li>
          );
        })}
      </Group>
      <Button className="mt-6 w-full" onClick={() => setFinishing(true)}>{t(d === 'load' ? 'rm.load.finish' : 'rm.unload.finish')}</Button>
    </Page>
  );
}

/** Job screen section: start the load or unload check, with progress. */
export function ChecksSection({ job }: { job: JobRow }) {
  const { db, t } = useApp();
  const [c, setC] = useState<{ load: { done: number; total: number }; unload: { done: number; total: number } } | null>(null);
  useEffect(() => { void db.checkCounts(job.id).then(setC); }, [db, job.id, job.status]);
  const loadDone = ['loaded', 'delivered', 'closed'].includes(job.status);
  const unloadDone = ['delivered', 'closed'].includes(job.status);
  return (
    <Group title={t('rm.section.checks')}>
      <Row title={t('rm.load.start')} detail={loadDone ? t('rm.check.finished') : c ? t('rm.check.progress', c.load) : undefined}
        onClick={() => navigate(`/job/${job.id}/check/load`)} />
      <Row title={t('rm.unload.start')} detail={unloadDone ? t('rm.check.finished') : c && c.unload.total ? t('rm.check.progress', c.unload) : t('rm.unload.needLoad')}
        onClick={() => navigate(`/job/${job.id}/check/unload`)} />
    </Group>
  );
}

/** The round Scan button in Removalist mode: pick the job, then Loading or Unloading (or just find a box). */
export function ScanJobPicker() {
  const { db, workspace, t, num } = useApp();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  useEffect(() => {
    const p = (n: number) => String(n).padStart(2, '0');
    const d = new Date();
    void db.listJobs(workspace!.id, { today: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }).then(setJobs);
  }, [db, workspace]);
  return (
    <Page title={t('rm.pick.title')} back={() => navigate('/')}>
      {jobs?.length === 0 && <p className="py-6 text-center text-text-2">{t('rm.pick.none')}</p>}
      <ul className="mt-2 flex flex-col gap-3" aria-label={t('rm.pick.title')}>
        {jobs?.map((j) => (
          <li key={j.id} className="rounded-md bg-surface p-3">
            <p className="text-body font-semibold"><span className="num">{showJobNumber(j.number, num)}</span> · {j.customerName}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="secondary" aria-label={`${t('rm.pick.loading')} ${showJobNumber(j.number, num)}`} onClick={() => navigate(`/job/${j.id}/check/load`)}>{t('rm.pick.loading')}</Button>
              <Button variant="secondary" aria-label={`${t('rm.pick.unloading')} ${showJobNumber(j.number, num)}`} onClick={() => navigate(`/job/${j.id}/check/unload`)}>{t('rm.pick.unloading')}</Button>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="ghost" className="mt-4 w-full" onClick={() => navigate('/scan')}>{t('rm.pick.findBox')}</Button>
    </Page>
  );
}
