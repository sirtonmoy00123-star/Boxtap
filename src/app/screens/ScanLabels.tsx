import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Button, Field, Page, inputClass } from '../ui';
import { startScanner, type ScannerHandle } from '../../core/scan/scanner';
import { SHEETS, type SheetId } from '../../core/labels/layout';
import { deliverFile } from '../../core/backup/backupFile';

export function Scan() {
  const { db, workspace, t } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let handle: ScannerHandle | undefined;
    let live = true;
    void startScanner(video.current!, async (r) => {
      if (!live) return;
      if (r.kind === 'other') { setMsg(t('scan.notBoxtap')); return; }
      const st = await db.labelStatus(r.code);
      if (st.kind === 'unknown') { setMsg(t('label.notMine')); return; }
      // Own box, a spare label, or a box in another list on this phone: the label route handles each.
      handle?.stop();
      navigate(`/b/${r.code}`, true);
    }).then((h) => { if (live) handle = h; else h.stop(); }).catch(() => setFailed(true));
    return () => { live = false; handle?.stop(); };
  }, [db, workspace, t, attempt]);

  return (
    <Page title={t('scan.title')} back={() => navigate('/')}>
      {failed ? (
        <div className="py-6">
          <p role="alert">{t('scan.noCamera')}</p>
          <Button className="mt-4" onClick={() => { setFailed(false); setAttempt((a) => a + 1); }}>{t('scan.retry')}</Button>
        </div>
      ) : (
        <>
          <video ref={video} className="aspect-square w-full rounded-2xl bg-black object-cover" muted playsInline />
          <p className="mt-3 text-center text-slate-600">{t('scan.hint')}</p>
          {msg && <p role="status" className="mt-2 text-center font-medium">{msg}</p>}
        </>
      )}
    </Page>
  );
}

export function PrintLabels() {
  const { db, workspace, t, toast } = useApp();
  const ws = workspace!;
  const [sheet, setSheet] = useState<SheetId>('L7165');
  const [which, setWhich] = useState<'boxes' | 'spares'>('boxes');
  const [spares, setSpares] = useState(8);
  const [startAt, setStartAt] = useState(1);
  const [boxCount, setBoxCount] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void db.listBoxes(ws.id).then((b) => setBoxCount(b.length)); }, [db, ws.id]);

  const make = async () => {
    setBusy(true);
    try {
      const { buildLabelPdf } = await import('../../core/labels/pdf');
      const rooms = new Map((await db.listRooms(ws.id)).map((r) => [r.id, r.name]));
      const labels = which === 'boxes'
        ? (await db.listBoxes(ws.id)).map((b) => ({ code: b.labelCode, number: b.number, title: b.name, room: b.roomId ? rooms.get(b.roomId) ?? null : null, fragile: b.isFragile, openFirst: b.openFirst }))
        : (await db.createSpareLabels(ws.id, spares)).map((code) => ({ code, number: null, title: null, room: null, fragile: false, openFirst: false }));
      const { canvasTextRenderer } = await import('../../core/labels/textImage');
      const pdf = await buildLabelPdf(labels, sheet, startAt - 1, { renderText: canvasTextRenderer });
      await deliverFile(new File([new Uint8Array(pdf)], `BoxTap-labels-${sheet}.pdf`, { type: 'application/pdf' }));
      toast(t('labels.ready'));
    } catch (e) {
      toast(t('error.generic', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const max = SHEETS[sheet].cols * SHEETS[sheet].rows;
  return (
    <Page title={t('labels.title')} back={() => navigate('/')}>
      <Field label={t('labels.sheet')}>
        <select className={inputClass} value={sheet} onChange={(e) => { setSheet(e.target.value as SheetId); setStartAt(1); }}>
          {(Object.keys(SHEETS) as SheetId[]).map((id) => <option key={id} value={id}>{SHEETS[id].name}</option>)}
        </select>
      </Field>
      <fieldset className="py-2">
        <legend className="mb-1 text-sm text-slate-600">{t('labels.which')}</legend>
        <label className="flex min-h-12 items-center gap-2"><input type="radio" checked={which === 'boxes'} onChange={() => setWhich('boxes')} /> {t('labels.allBoxes', { n: boxCount })}</label>
        <label className="flex min-h-12 items-center gap-2"><input type="radio" checked={which === 'spares'} onChange={() => setWhich('spares')} /> {t('labels.spares')}</label>
      </fieldset>
      {which === 'spares' && (
        <Field label={t('labels.spareCount')}>
          <input type="number" min={1} max={200} className={inputClass} value={spares} onChange={(e) => setSpares(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
        </Field>
      )}
      <Field label={t('labels.startAt')}>
        <input type="number" min={1} max={max} className={inputClass} value={startAt} onChange={(e) => setStartAt(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} />
      </Field>
      <p className="py-2 text-sm text-slate-600">{t('labels.tip')}</p>
      <Button className="w-full" onClick={make} disabled={busy || (which === 'boxes' && boxCount === 0)}>{t('labels.make')}</Button>
    </Page>
  );
}
