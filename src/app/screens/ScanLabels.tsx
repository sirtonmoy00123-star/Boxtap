import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { navigate } from '../router';
import { Flashlight, X } from 'lucide-react';
import { Button, Field, IconButton, LabelTag, Page, inputClass } from '../ui';
import { platform } from '../../core/pwa/install';
import { startScanner, type ScannerHandle } from '../../core/scan/scanner';
import { SHEETS, type SheetId } from '../../core/labels/layout';
import { deliverFile } from '../../core/backup/backupFile';

/**
 * Full-screen scan view (DESIGN_SYSTEM §5): camera, rounded guide, close top left, torch where the camera has one.
 * A found box is announced ("Box 12 found", role=status), the guide flashes the success colour, then the box opens.
 */
export function Scan() {
  const { db, workspace, t, num } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [found, setFound] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [torch, setTorch] = useState<{ handle: ScannerHandle; on: boolean } | null>(null);

  useEffect(() => {
    let handle: ScannerHandle | undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void startScanner(video.current!, async (r) => {
      if (!live) return;
      if (r.kind === 'other') { setMsg(t('scan.notBoxtap')); return; }
      const st = await db.labelStatus(r.code);
      if (st.kind === 'unknown') { setMsg(t('label.notMine')); return; }
      handle?.stop();
      // Own box, a spare label, or a box in another list on this phone: the label route handles each.
      const box = st.kind === 'box' ? await db.getBox(st.boxId) : null;
      if (box && live) {
        setFound(box.number);
        if (platform() === 'android') navigator.vibrate?.(30); // a bonus only (DESIGN_SYSTEM §7)
        timer = setTimeout(() => navigate(`/b/${r.code}`, true), 450);
      } else navigate(`/b/${r.code}`, true);
    }).then((h) => {
      if (!live) { h.stop(); return; }
      handle = h;
      if (h.hasTorch) setTorch({ handle: h, on: false });
    }).catch(() => setFailed(true));
    return () => { live = false; clearTimeout(timer); handle?.stop(); setTorch(null); };
  }, [db, workspace, t, attempt]);

  const close = () => navigate('/');
  return (
    <div className="fixed inset-0 z-50 bg-camera text-on-accent" role="region" aria-label={t('scan.title')}>
      <h1 className="sr-only">{t('scan.title')}</h1>
      {!failed && <video ref={video} className="absolute inset-0 h-full w-full object-cover" muted playsInline />}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <IconButton icon={X} label={t('scan.close')} className="bg-scrim text-on-accent" onClick={close} />
        {torch && (
          <IconButton icon={Flashlight} label={t('scan.torch')} aria-pressed={torch.on} className={torch.on ? 'bg-on-accent text-camera' : 'bg-scrim text-on-accent'}
            onClick={async () => { const on = !torch.on; if (await torch.handle.setTorch(on)) setTorch({ ...torch, on }); }} />
        )}
      </div>
      {failed ? (
        <div className="absolute inset-x-6 top-1/3 mx-auto max-w-md text-center">
          <p role="alert" className="text-body">{t('scan.noCamera')}</p>
          <Button className="mt-4" onClick={() => { setFailed(false); setAttempt((a) => a + 1); }}>{t('scan.retry')}</Button>
        </div>
      ) : (
        <>
          <div aria-hidden="true" className={`absolute left-1/2 top-1/2 aspect-square w-[min(70vw,320px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border-4 transition-[transform,opacity] duration-300 ease-out ${found != null ? 'scale-50 border-success opacity-0' : 'border-on-accent'}`} />
          {found != null && (
            <div aria-hidden="true" className="anim-fade absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><LabelTag n={num(found)} size="lg" /></div>
          )}
          <div className="absolute inset-x-4 bottom-[calc(2rem+env(safe-area-inset-bottom))] mx-auto max-w-md text-center">
            <p className="text-body">{t('scan.hint')}</p>
            <p role="status" aria-live="polite" className="mt-2 min-h-6 text-headline">
              {found != null ? t('scan.found', { n: found }) : msg}
            </p>
          </div>
        </>
      )}
    </div>
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
    <Page title={t('labels.title')} back={() => navigate('/settings')}>
      <Field label={t('labels.sheet')}>
        <select className={inputClass} value={sheet} onChange={(e) => { setSheet(e.target.value as SheetId); setStartAt(1); }}>
          {(Object.keys(SHEETS) as SheetId[]).map((id) => <option key={id} value={id}>{SHEETS[id].name}</option>)}
        </select>
      </Field>
      <fieldset className="py-2">
        <legend className="mb-1 text-subhead text-text-2">{t('labels.which')}</legend>
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
      <p className="py-2 text-subhead text-text-2">{t('labels.tip')}</p>
      <Button className="w-full" onClick={make} disabled={busy || (which === 'boxes' && boxCount === 0)}>{t('labels.make')}</Button>
    </Page>
  );
}
