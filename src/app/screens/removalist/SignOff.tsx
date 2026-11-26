// Sign-off (plan §8, Phase 4): summary, disclaimer, customer signature (or "refused"), crew leader signature,
// then one transaction locks the stage with its report hash. Delivery sign-off closes the job.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context';
import { navigate } from '../../router';
import { Button, Field, Page, inputClass } from '../../ui';
import type { JobRow, Stage, StageSummary } from '../../../core/repo';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { showJobNumber } from './Jobs';

export function SignOffPage({ id, stage }: { id: string; stage: Stage }) {
  const { db, t, num, date, toast } = useApp();
  const [job, setJob] = useState<JobRow | null>(null);
  const [s, setS] = useState<StageSummary | null>(null);
  const [step, setStep] = useState<'customer' | 'crew'>('customer');
  const [customer, setCustomer] = useState<{ name: string; refused: boolean; png: Uint8Array | null; at: string } | null>(null);
  const [name, setName] = useState('');
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const pad = useRef<SignaturePadHandle>(null);
  useEffect(() => {
    void db.getJob(id).then((j) => { setJob(j ?? null); setName(j?.customerName ?? ''); });
    void db.stageSummary(id, stage).then(setS);
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, [db, id, stage]);
  if (!job || !s) return null;
  const stageName = t(stage === 'pickup' ? 'rm.stage.pickup' : 'rm.stage.delivery');
  if (s.locked) return <Page title={t('rm.sign.title', { stage: stageName })} back={() => navigate(`/job/${id}/condition/${stage}`)}><p className="py-6">{t('rm.cond.locked')}</p></Page>;

  const take = async () => {
    if (!name.trim()) { setError(t('rm.sign.needName')); return null; }
    if (!pad.current || pad.current.isEmpty()) { setError(t('rm.sign.needSignature')); return null; }
    setError(null);
    return { name: name.trim(), png: await pad.current.toPng(), at: new Date().toISOString() };
  };
  const nextToCrew = async () => {
    if (refused) setCustomer({ name: name.trim() || job.customerName, refused: true, png: null, at: new Date().toISOString() });
    else { const c = await take(); if (!c) return; setCustomer({ ...c, refused: false }); }
    setName(job.crewLeader ?? '');
    setStep('crew');
  };
  const lock = async () => {
    const c = await take();
    if (!c || !customer) return;
    try {
      await db.signStage({
        jobId: id, stage, crew: { name: c.name, signedAt: c.at, png: c.png },
        customer: customer.refused ? null : { name: customer.name, signedAt: customer.at, png: customer.png! },
      });
      toast(stage === 'delivery' ? t('rm.sign.closed') : t('rm.sign.done', { stage: stageName }));
      navigate(`/job/${id}/condition/${stage}`, true);
    } catch (e) {
      setError(t('error.generic', { msg: (e as Error).message }));
    }
  };

  const who = step === 'customer' ? t('rm.sign.customer') : t('rm.sign.crew');
  return (
    <Page title={t('rm.sign.title', { stage: stageName })} back={() => (step === 'crew' ? setStep('customer') : navigate(`/job/${id}/condition/${stage}`))}>
      <p className="pt-3 text-headline"><span className="num">{showJobNumber(job.number, num)}</span> · {t('rm.cond.summary', { total: s.total, damage: s.withDamage })}</p>
      <p className="mt-3 rounded-md bg-surface-2 p-3 text-subhead" data-testid="disclaimer">{t('rm.sign.disclaimer')}</p>
      <h2 className="mt-5 text-title2">{who}</h2>
      <Field label={`${t('rm.sign.name')} (${who})`}>
        <input className={inputClass} maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setError(null); }} autoComplete="off" />
      </Field>
      {step === 'customer' && (
        <label className="flex min-h-11 items-center gap-3 py-1 text-body">
          <input type="checkbox" className="h-5 w-5 accent-accent-fill" checked={refused} onChange={(e) => { setRefused(e.target.checked); setError(null); }} />
          {t('rm.sign.refused')}
        </label>
      )}
      {!(step === 'customer' && refused) && <SignaturePad key={step} ref={pad} label={t('rm.sign.pad', { who })} />}
      <p className="text-footnote text-text-2">{t('rm.sign.time', { when: date(now, true) })}</p>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
      {step === 'customer'
        ? <Button className="mt-4 w-full" onClick={nextToCrew}>{t('rm.sign.next')}</Button>
        : <Button className="mt-4 w-full" onClick={lock}>{t('rm.sign.lock')}</Button>}
    </Page>
  );
}
