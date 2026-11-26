// The job's boxes and furniture pieces, and printing their labels (plan Phase 2).
import { useCallback, useEffect, useState } from 'react';
import { Printer, Sofa } from 'lucide-react';
import { useApp } from '../../context';
import { navigate } from '../../router';
import { Badge, Button, Field, Group, Icon, LabelTag, Page, inputClass } from '../../ui';
import { WorkerError } from '../../../core/db/client';
import type { JobPiece, JobRow } from '../../../core/repo';
import { SHEETS, type SheetId } from '../../../core/labels/layout';
import { deliverFile } from '../../../core/backup/backupFile';
import { showJobNumber } from './Jobs';

/** Job screen section: list, counts, + Box, + Furniture piece, + 10 boxes, Print labels. */
export function PiecesSection({ jobId, onChanged }: { jobId: string; onChanged: () => void }) {
  const { db, t, num, showUpgrade, toast } = useApp();
  const [pieces, setPieces] = useState<JobPiece[] | null>(null);
  const [stale, setStale] = useState<{ boxes: number; pieces: number } | null>(null);
  const load = useCallback(async () => {
    setPieces(await db.listJobPieces(jobId));
    const s = await db.jobLabelsStatus(jobId);
    setStale(s.stale ? s.printed : null);
  }, [db, jobId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => {
    const on = () => void load();
    window.addEventListener('boxtap:boxes-changed', on);
    return () => window.removeEventListener('boxtap:boxes-changed', on);
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); onChanged(); } catch (e) {
      if (e instanceof WorkerError && e.reason) showUpgrade(e.reason); else toast(t('error.generic', { msg: (e as Error).message }));
    }
  };
  // Opens the new box, unless the user has already left this screen while it was being made.
  const addOne = (isPiece: boolean) => run(async () => { const here = location.pathname; const p = await db.addJobBox(jobId, { isPiece }); if (location.pathname === here) navigate(`/box/${p.id}`); });
  const addTen = () => run(async () => { await db.quickAddBoxes(jobId, 10); toast(t('rm.add.tenDone')); });
  const boxes = pieces?.filter((p) => !p.isPiece).length ?? 0;
  const furniture = (pieces?.length ?? 0) - boxes;

  return (
    <section className="mt-6" aria-labelledby="pieces-title">
      <h2 id="pieces-title" className="flex items-baseline justify-between px-4 pb-1.5 text-footnote text-text-2">
        <span>{t('rm.pieces.title')}</span>
        <span data-testid="piece-counts">{t('rm.pieces.counts', { boxes, pieces: furniture })}</span>
      </h2>
      {stale && <p role="note" className="mb-2 rounded-md bg-surface-2 p-3 text-subhead text-warning" data-testid="labels-stale">{t('rm.labels.stale', stale)}</p>}
      {pieces && pieces.length === 0 ? (
        <p className="rounded-md bg-surface px-4 py-6 text-center text-body text-text-2">{t('rm.pieces.empty')}</p>
      ) : (
        <ul className="group-list overflow-hidden rounded-md bg-surface" aria-label={t('rm.pieces.title')}>
          {pieces?.map((p) => {
            const what = t(p.isPiece ? 'rm.piece.n' : 'rm.box.n', { n: p.jobSeq ?? 0 });
            return (
              <li key={p.id}>
                <button type="button" onClick={() => navigate(`/box/${p.id}`)} className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2">
                  {p.isPiece ? <span className="grid h-11 w-11 shrink-0 place-items-center"><Icon as={Sofa} className="text-accent" /></span> : <LabelTag n={num(p.jobSeq ?? 0)} />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-body text-text">{p.name ? `${what} · ${p.name}` : what}</span>
                    {(p.roomName || p.isFragile || p.openFirst) && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-subhead text-text-2">
                        {p.roomName && <span>{p.roomName}</span>}
                        {p.isFragile && <Badge kind="fragile">{t('box.fragile')}</Badge>}
                        {p.openFirst && <Badge kind="openFirst">{t('box.openFirst')}</Badge>}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => addOne(false)}>{t('rm.add.box')}</Button>
        <Button variant="secondary" onClick={() => addOne(true)}>{t('rm.add.piece')}</Button>
        <Button variant="secondary" onClick={addTen}>{t('rm.add.ten')}</Button>
        <Button variant="secondary" disabled={!pieces?.length} onClick={() => navigate(`/job/${jobId}/labels`)}>
          <span className="inline-flex items-center gap-1.5"><Icon as={Printer} size={20} />{t('rm.labels.print')}</span>
        </Button>
      </div>
    </section>
  );
}

/** Print labels for a job: all or chosen boxes and pieces, on the business's default sheet. */
export function JobLabelsPage({ id }: { id: string }) {
  const { db, workspace, t, num, toast } = useApp();
  const ws = workspace!;
  const [job, setJob] = useState<JobRow | null>(null);
  const [pieces, setPieces] = useState<JobPiece[]>([]);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [sheet, setSheet] = useState<SheetId>('L7165');
  const [startAt, setStartAt] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void (async () => {
      const [j, ps, p] = await Promise.all([db.getJob(id), db.listJobPieces(id), db.getBusinessProfile(ws.id)]);
      setJob(j ?? null);
      setPieces(ps);
      setChosen(new Set(ps.map((x) => x.id)));
      if (p && p.labelSheet in SHEETS) setSheet(p.labelSheet as SheetId);
    })();
  }, [db, id, ws.id]);
  if (!job || !chosen) return null;
  const jobNo = showJobNumber(job.number, num);
  const max = SHEETS[sheet].cols * SHEETS[sheet].rows;

  const make = async () => {
    if (chosen.size === 0) { setError(t('rm.labels.none')); return; }
    setBusy(true);
    setError(null);
    try {
      const [{ buildJobLabelPdf }, { canvasTextRenderer }] = await Promise.all([import('../../../core/labels/pdf'), import('../../../core/labels/textImage')]);
      const set = await db.jobLabels(id, chosen.size === pieces.length ? undefined : [...chosen]);
      const logo = await db.labelLogo(ws.id);
      const items = set.labels.map((l) => ({
        code: l.code, name: l.name, room: l.room, fragile: l.fragile, openFirst: l.openFirst,
        big: t(l.isPiece ? 'rm.label.piece' : 'rm.label.box', { n: l.seq, of: l.of }),
        owner: `${set.labelName} · ${set.jobNumber}`,
      }));
      const pdf = await buildJobLabelPdf(items, sheet, startAt - 1, { businessName: set.businessName, logo, renderText: canvasTextRenderer });
      await deliverFile(new File([new Uint8Array(pdf)], `BoxTap-${set.jobNumber}-labels-${sheet}.pdf`, { type: 'application/pdf' }));
      await db.markJobLabelsPrinted(id);
      toast(t('labels.ready'));
    } catch (e) {
      setError(t('error.generic', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const all = chosen.size === pieces.length;
  return (
    <Page title={t('rm.labels.title', { job: jobNo })} back={() => navigate(`/job/${id}`)}>
      <Field label={t('labels.sheet')}>
        <select className={inputClass} value={sheet} onChange={(e) => { setSheet(e.target.value as SheetId); setStartAt(1); }}>
          {(Object.keys(SHEETS) as SheetId[]).map((s) => <option key={s} value={s}>{SHEETS[s].name}</option>)}
        </select>
      </Field>
      <label className="flex min-h-12 items-center gap-3 py-1 text-body">
        <input type="checkbox" className="h-5 w-5 accent-accent-fill" checked={all} onChange={() => setChosen(new Set(all ? [] : pieces.map((p) => p.id)))} />
        {t('rm.labels.all', { n: pieces.length })}
      </label>
      <Group title={t('rm.labels.choose')} label={t('rm.labels.choose')}>
        {pieces.map((p) => (
          <li key={p.id}>
            <label className="flex min-h-11 items-center gap-3 px-4 py-1.5 text-body">
              <input type="checkbox" className="h-5 w-5 accent-accent-fill" checked={chosen.has(p.id)}
                onChange={() => { const n = new Set(chosen); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); setChosen(n); }} />
              {t(p.isPiece ? 'rm.piece.n' : 'rm.box.n', { n: p.jobSeq ?? 0 })}{p.name ? ` · ${p.name}` : ''}
            </label>
          </li>
        ))}
      </Group>
      <Field label={t('labels.startAt')}>
        <input type="number" min={1} max={max} className={inputClass} value={startAt} onChange={(e) => setStartAt(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} />
      </Field>
      <p className="py-2 text-subhead text-text-2">{t('labels.tip')}</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <Button className="w-full" onClick={make} disabled={busy}>{t('labels.make')}</Button>
    </Page>
  );
}
