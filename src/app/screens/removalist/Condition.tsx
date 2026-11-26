// Condition reports (plan §8, Phase 4): per piece at pickup and delivery — tags, note, photos — with a fast
// "Next piece" walk, the sign-off, and amendments after the lock.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Lock } from 'lucide-react';
import { useApp } from '../../context';
import { navigate } from '../../router';
import { Button, Field, Group, Icon, Page, Row, inputClass } from '../../ui';
import { WorkerError } from '../../../core/db/client';
import { addConditionPhotoFromFile, conditionCaption } from '../../../core/photos/condition';
import { photoUrl } from '../../../core/photos/save';
import { StorageFullError } from '../../../core/photos/store';
import { CONDITION_TAGS, type Comparison, type ConditionPhoto, type ConditionRecord, type ConditionTag, type JobPiece, type JobRow, type Stage, type StageSummary } from '../../../core/repo';
import { jobNumber } from '../../../core/repo/removalist/jobs';
import { CameraCapture } from './Camera';
import { showJobNumber } from './Jobs';
import type { Key } from '../../../i18n/i18n';

const stageKey = (s: Stage): Key => (s === 'pickup' ? 'rm.stage.pickup' : 'rm.stage.delivery');

/** Job screen rows: pickup and delivery condition with progress or "Signed … · locked". */
export function ConditionSection({ job }: { job: JobRow }) {
  const { db, t, date } = useApp();
  const [s, setS] = useState<Record<Stage, StageSummary> | null>(null);
  useEffect(() => {
    void Promise.all([db.stageSummary(job.id, 'pickup'), db.stageSummary(job.id, 'delivery')]).then(([pickup, delivery]) => setS({ pickup, delivery }));
  }, [db, job.id, job.status]);
  const detail = (x?: StageSummary) => (!x ? undefined : x.locked ? t('rm.cond.signedOn', { when: date(x.locked.at, true) }) : t('rm.cond.progress', { recorded: x.recorded, total: x.total }));
  return (
    <Group title={t('rm.section.condition')}>
      <Row title={t('rm.cond.pickupRow')} detail={detail(s?.pickup)} lead={s?.pickup.locked ? <Icon as={Lock} size={20} className="text-text-2" /> : undefined} onClick={() => navigate(`/job/${job.id}/condition/pickup`)} />
      <Row title={t('rm.cond.deliveryRow')} detail={detail(s?.delivery)} lead={s?.delivery.locked ? <Icon as={Lock} size={20} className="text-text-2" /> : undefined} onClick={() => navigate(`/job/${job.id}/condition/delivery`)} />
    </Group>
  );
}

const what = (t: ReturnType<typeof useApp>['t'], p: JobPiece) => t(p.isPiece ? 'rm.piece.n' : 'rm.box.n', { n: p.jobSeq ?? 0 });
const tagList = (t: ReturnType<typeof useApp>['t'], tags: readonly ConditionTag[]) => (tags.length ? tags.map((x) => t(`rm.tag.${x}` as Key)).join(', ') : t('rm.cond.noTag'));

/** One stage: summary, the pieces, start / next, sign-off, and (delivery) the comparison with pickup. */
export function ConditionStagePage({ id, stage }: { id: string; stage: Stage }) {
  const { db, t, num, date } = useApp();
  const [job, setJob] = useState<JobRow | null>(null);
  const [s, setS] = useState<StageSummary | null>(null);
  const [cmp, setCmp] = useState<Comparison | null>(null);
  useEffect(() => {
    void db.getJob(id).then((j) => setJob(j ?? null));
    void db.stageSummary(id, stage).then(setS);
    if (stage === 'delivery') void db.compareStages(id).then(setCmp);
  }, [db, id, stage]);
  if (!job || !s) return null;
  const first = s.notRecorded[0] ?? s.pieces[0]?.piece;
  return (
    <Page title={t('rm.cond.title', { stage: t(stageKey(stage)), job: showJobNumber(job.number, num) })} back={() => navigate(`/job/${id}`)}>
      <p className="pt-3 text-headline" data-testid="cond-summary">{t('rm.cond.summary', { total: s.total, damage: s.withDamage })}</p>
      <p className="text-subhead text-text-2">{t('rm.cond.progress', { recorded: s.recorded, total: s.total })}</p>
      {s.locked && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-surface-2 p-3 text-subhead" data-testid="stage-locked">
          <Icon as={Lock} size={20} />
          <span>{t('rm.cond.signedOn', { when: date(s.locked.at, true) })}. {t('rm.cond.locked')}{s.locked.customerRefused ? ` ${t('rm.sign.refusedNote')}` : ''}</span>
        </p>
      )}
      {cmp && s.locked == null && <ComparisonList cmp={cmp} />}
      {cmp && s.locked != null && <ComparisonList cmp={cmp} />}
      <Group title={t('rm.pieces.title')} label={t('rm.pieces.title')}>
        {s.pieces.map((pc) => {
          const rec = !s.notRecorded.some((x) => x.id === pc.piece.id);
          return (
            <Row key={pc.piece.id} title={pc.piece.name ? `${what(t, pc.piece)} · ${pc.piece.name}` : what(t, pc.piece)}
              detail={rec ? `${tagList(t, pc.record?.tags ?? [])} · ${t('rm.cond.photoCount', { n: pc.record?.photos.length ?? 0 })}${pc.amendments.length ? ` · ${t('rm.cond.amendmentPrefix')}` : ''}` : t('rm.cond.none')}
              onClick={() => navigate(`/job/${id}/condition/${stage}/${pc.piece.id}`)} />
          );
        })}
      </Group>
      {!s.locked && first && (
        <Button className="mt-4 w-full" onClick={() => navigate(`/job/${id}/condition/${stage}/${first.id}`)}>{t('rm.cond.start')}</Button>
      )}
      {!s.locked && (
        <Button variant="secondary" className="mt-2 w-full" onClick={() => navigate(`/job/${id}/sign/${stage}`)}>{t('rm.cond.signOff', { stage: t(stageKey(stage)) })}</Button>
      )}
    </Page>
  );
}

function ComparisonList({ cmp }: { cmp: Comparison }) {
  const { t } = useApp();
  return (
    <section className="mt-4" aria-label={t('rm.cond.compareTitle')} data-testid="comparison">
      <h2 className="px-1 pb-1.5 text-footnote text-text-2">{t('rm.cond.compareTitle')}</h2>
      {cmp.changed.length === 0 && cmp.missing.length === 0 ? <p className="rounded-md bg-surface p-3 text-body">{t('rm.cond.noChanges')}</p> : (
        <ul className="group-list overflow-hidden rounded-md bg-surface">
          {cmp.changed.map((c) => (
            <li key={c.piece.id} className="px-4 py-2.5 text-body text-warning">
              {t('rm.cond.changed', { what: what(t, c.piece), before: tagList(t, c.pickup), after: tagList(t, c.delivery) })}
            </li>
          ))}
          {cmp.missing.map((m) => (
            <li key={m.piece.id} className="px-4 py-2.5 text-body text-danger">
              {t(m.why === 'missing_on_unload' ? 'rm.cond.missingUnload' : 'rm.cond.missingNotRecorded', { what: what(t, m.piece) })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface Shown { p: ConditionPhoto; url: string | null }
function PhotoGrid({ photos }: { photos: ConditionPhoto[] }) {
  const { t, date } = useApp();
  const [shown, setShown] = useState<Shown[]>([]);
  useEffect(() => {
    let urls: string[] = [];
    void Promise.all(photos.map(async (p) => ({ p, url: await photoUrl(p.thumbName) }))).then((s) => { urls = s.map((x) => x.url).filter((u): u is string => !!u); setShown(s); });
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [photos]);
  if (!shown.length) return null;
  return (
    <ul className="mt-2 grid grid-cols-3 gap-2" aria-label={t('rm.cond.photos')}>
      {shown.map(({ p, url }) => (
        <li key={p.photoId} className="text-caption text-text-2">
          <span className="block aspect-square overflow-hidden rounded-md bg-surface-2">{url && <img src={url} alt="" className="h-full w-full object-cover" />}</span>
          <span className="block pt-0.5">{date(p.capturedAt, true)}</span>
          {p.source === 'library' && <span className="block">{t('rm.cond.imported')}</span>}
          {p.clockSuspect && <span className="block text-warning">{t('rm.cond.clockWrong')}</span>}
        </li>
      ))}
    </ul>
  );
}

/** One piece at one stage: tags, note, photos (camera first, Import second), Next piece; amendments once locked. */
export function ConditionPiecePage({ id, stage, boxId }: { id: string; stage: Stage; boxId: string }) {
  const { db, workspace, t, num, showUpgrade, toast } = useApp();
  const [job, setJob] = useState<JobRow | null>(null);
  const [s, setS] = useState<StageSummary | null>(null);
  const [rec, setRec] = useState<ConditionRecord | null>(null);
  const [amends, setAmends] = useState<ConditionRecord[]>([]);
  const [note, setNote] = useState('');
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amend, setAmend] = useState<{ note: string; tags: ConditionTag[]; id: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // Tags shown at once and saved one after another, so quick taps never overwrite each other with stale values.
  const [tags, setTagsState] = useState<ConditionTag[]>([]);
  const tagsRef = useRef<ConditionTag[]>([]);
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    const [j, sum, r, a] = await Promise.all([db.getJob(id), db.stageSummary(id, stage), db.getConditionRecord(id, boxId, stage), db.pieceAmendments(id, boxId, stage)]);
    setJob(j ?? null); setS(sum); setRec(r ?? null); setAmends(a);
    return r;
  }, [db, id, stage, boxId]);
  useEffect(() => {
    const timer = setTimeout(() => void load().then((r) => { setNote(r?.note ?? ''); tagsRef.current = r?.tags ?? []; setTagsState(tagsRef.current); }), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const piece = s?.pieces.find((x) => x.piece.id === boxId)?.piece;
  if (!job || !s || !piece) return null;
  const locked = !!s.locked;
  const w = what(t, piece);
  const save = (nextTags: ConditionTag[], nextNote = note) => {
    saving.current = saving.current.then(async () => {
      try { await db.saveCondition({ jobId: id, locationId: boxId, stage, tags: nextTags, note: nextNote || null, createdBy: job.crewLeader }); await load(); }
      catch (e) { toast(t('error.generic', { msg: (e as Error).message })); }
    });
    return saving.current;
  };
  const toggle = (tag: ConditionTag) => {
    if (locked) return;
    const cur = tagsRef.current;
    let next = cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag];
    if (tag === 'ok' && next.includes('ok')) next = ['ok', ...next.filter((x) => x === 'pre_existing')];
    else if (tag !== 'ok') next = next.filter((x) => x !== 'ok');
    tagsRef.current = next;
    setTagsState(next);
    void save(next);
  };
  const addPhoto = async (blob: Blob, at: Date, source: 'camera' | 'library') => {
    setBusy(true);
    try {
      await addConditionPhotoFromFile(db, {
        workspaceId: workspace!.id, jobId: id, boxId, stage, file: blob, source, capturedAt: at,
        caption: conditionCaption(at, jobNumber(job.number), piece.isPiece, piece.jobSeq ?? 0, stage), amendmentId: amend?.id ?? undefined,
      });
      await load();
    } catch (e) {
      if (e instanceof WorkerError && e.reason) showUpgrade(e.reason);
      else if (e instanceof StorageFullError) toast(t('photos.full'));
      else toast(t('error.generic', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  const next = () => {
    const order = s.pieces.map((x) => x.piece.id);
    const after = s.notRecorded.find((p) => order.indexOf(p.id) > order.indexOf(boxId) && p.id !== boxId) ?? s.notRecorded.find((p) => p.id !== boxId);
    navigate(after ? `/job/${id}/condition/${stage}/${after.id}` : `/job/${id}/condition/${stage}`, true);
  };
  const saveAmendment = async () => {
    if (!amend) return;
    if (!amend.note.trim()) { setError(t('rm.cond.amendmentNeedsNote')); return; }
    const a = await db.addAmendment({ jobId: id, locationId: boxId, stage, note: amend.note, tags: amend.tags, createdBy: job.crewLeader });
    setAmend({ ...amend, id: a.id });
    setError(null);
    await load();
  };
  const others = s.notRecorded.filter((p) => p.id !== boxId);

  const photoButtons = (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <Button onClick={() => setCamera(true)} disabled={busy}><span className="inline-flex items-center gap-1.5"><Icon as={Camera} size={20} />{t('rm.cond.takePhoto')}</span></Button>
      <Button variant="secondary" onClick={() => file.current?.click()} disabled={busy}><span className="inline-flex items-center gap-1.5"><Icon as={ImagePlus} size={20} />{t('rm.cond.importPhoto')}</span></Button>
      {/* Import: the file picker (gallery). Stored as source=library; reports say the time isn't verified. */}
      <input ref={file} type="file" accept="image/*" className="sr-only" aria-label={t('rm.cond.importPhoto')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPhoto(f, new Date(), 'library'); }} />
    </div>
  );

  return (
    <Page title={`${w} · ${t(stageKey(stage))}`} back={() => navigate(`/job/${id}/condition/${stage}`)}>
      <p className="px-1 pt-2 text-footnote text-text-2"><span className="num">{showJobNumber(job.number, num)}</span>{piece.name ? ` · ${piece.name}` : ''}</p>
      {locked && <p className="mt-2 flex items-start gap-2 rounded-md bg-surface-2 p-3 text-subhead" data-testid="stage-locked"><Icon as={Lock} size={20} />{t('rm.cond.locked')}</p>}

      <fieldset className="mt-4">
        <legend className="px-1 pb-1.5 text-footnote text-text-2">{t('rm.cond.tags')}</legend>
        <div className="flex flex-wrap gap-2">
          {CONDITION_TAGS.map((tag) => (
            <button key={tag} type="button" aria-pressed={tags.includes(tag)} disabled={locked} onClick={() => toggle(tag)}
              className={`min-h-11 rounded-full border px-4 text-subhead disabled:opacity-60 ${tags.includes(tag) ? 'border-accent bg-accent-fill text-on-accent' : 'border-separator bg-surface text-text'}`}>
              {t(`rm.tag.${tag}` as Key)}
            </button>
          ))}
        </div>
      </fieldset>
      <Field label={t('rm.cond.note')}>
        <textarea className={`${inputClass} py-2`} rows={2} maxLength={1000} value={note} disabled={locked}
          onChange={(e) => setNote(e.target.value)} onBlur={() => { if (!locked && note !== (rec?.note ?? '')) void save(tagsRef.current, note); }} />
      </Field>

      <section className="mt-2">
        <h2 className="px-1 text-footnote text-text-2">{t('rm.cond.photos')}</h2>
        <PhotoGrid photos={rec?.photos ?? []} />
        {busy && <p role="status" className="pt-2 text-subhead text-text-2">{t('rm.cond.saving')}</p>}
        {!locked && photoButtons}
      </section>

      {amends.map((a) => (
        <section key={a.id} className="mt-4 rounded-md bg-surface p-3" data-testid="amendment">
          <p className="text-subhead font-semibold">{t('rm.cond.amendmentPrefix')}: {a.note}</p>
          {a.tags.length > 0 && <p className="text-subhead text-text-2">{tagList(t, a.tags)}</p>}
          <PhotoGrid photos={a.photos} />
        </section>
      ))}

      {locked && !amend && <Button variant="secondary" className="mt-4 w-full" onClick={() => setAmend({ note: '', tags: [], id: null })}>{t('rm.cond.addAmendment')}</Button>}
      {locked && amend && (
        <section className="mt-4 rounded-md bg-surface p-3">
          {!amend.id ? (
            <>
              <Field label={t('rm.cond.amendmentNote')}>
                <textarea className={`${inputClass} py-2`} rows={2} maxLength={1000} value={amend.note} onChange={(e) => setAmend({ ...amend, note: e.target.value })} />
              </Field>
              <div className="flex flex-wrap gap-2">
                {CONDITION_TAGS.filter((x) => x !== 'ok').map((tag) => (
                  <button key={tag} type="button" aria-pressed={amend.tags.includes(tag)} onClick={() => setAmend({ ...amend, tags: amend.tags.includes(tag) ? amend.tags.filter((x) => x !== tag) : [...amend.tags, tag] })}
                    className={`min-h-11 rounded-full border px-4 text-subhead ${amend.tags.includes(tag) ? 'border-accent bg-accent-fill text-on-accent' : 'border-separator bg-surface text-text'}`}>
                    {t(`rm.tag.${tag}` as Key)}
                  </button>
                ))}
              </div>
              {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
              <Button className="mt-3 w-full" onClick={saveAmendment}>{t('rm.cond.addAmendment')}</Button>
            </>
          ) : (
            <>
              <p className="text-subhead">{t('rm.cond.amendmentPhoto')}</p>
              {photoButtons}
            </>
          )}
        </section>
      )}

      {!locked && (
        <>
          <Button className="mt-6 w-full" onClick={next}>{others.length ? t('rm.cond.next') : t('rm.cond.done')}</Button>
          <p className="pt-2 text-footnote text-text-2" data-testid="not-recorded">
            {others.length ? t('rm.cond.notRecorded', { list: others.map((p) => what(t, p)).join(', ') }) : t('rm.cond.allRecorded')}
          </p>
        </>
      )}
      {camera && <CameraCapture onClose={() => setCamera(false)} onShot={(b, at) => { setCamera(false); void addPhoto(b, at, 'camera'); }} />}
    </Page>
  );
}
