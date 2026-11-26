// Signature pad (Phase 4): a canvas drawn with a finger, pen or mouse (pointer events), no library.
// Exports a small black-on-white PNG. The typed name beside it is the accessible way to identify the signer.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from 'react';
import { useApp } from '../../context';
import { Button } from '../../ui';

export interface SignaturePadHandle { isEmpty(): boolean; toPng(): Promise<Uint8Array>; clear(): void }

export const SignaturePad = forwardRef<SignaturePadHandle, { label: string; onChange?: (empty: boolean) => void }>(function SignaturePad({ label, onChange }, ref) {
  const { t } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef(0);
  const [empty, setEmpty] = useState(true);

  const ctx = () => canvas.current!.getContext('2d')!;
  const reset = useCallback(() => {
    const c = canvas.current!;
    const g = ctx();
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    strokes.current = 0;
    setEmpty(true);
    onChange?.(true);
  }, [onChange]);
  useEffect(() => { reset(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on mount

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.current!.width, y: ((e.clientY - r.top) / r.height) * canvas.current!.height };
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    canvas.current!.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const g = ctx();
    const p = point(e);
    g.strokeStyle = '#000000';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(p.x, p.y);
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = point(e);
    const g = ctx();
    g.lineTo(p.x, p.y);
    g.stroke();
    strokes.current++;
    if (empty && strokes.current > 2) { setEmpty(false); onChange?.(false); }
  };
  const up = () => { drawing.current = false; };

  useImperativeHandle(ref, () => ({
    isEmpty: () => strokes.current <= 2,
    clear: reset,
    toPng: () => new Promise<Uint8Array>((res, rej) => canvas.current!.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error('could not save the signature'))), 'image/png')),
  }), [reset]);

  return (
    <div>
      <canvas ref={canvas} width={600} height={200} role="img" aria-label={label} data-testid="signature-pad"
        className="block w-full touch-none rounded-md border border-separator bg-white" style={{ aspectRatio: '3 / 1' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
      <Button variant="ghost" className="px-0" onClick={reset}>{t('rm.sign.clear')}</Button>
    </div>
  );
});
