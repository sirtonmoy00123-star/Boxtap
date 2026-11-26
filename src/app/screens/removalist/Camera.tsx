// In-app camera for condition photos (plan §3 C9, Phase 4). Reuses the scanner's camera opener; a still frame is
// taken from the video, so the photo's time is the moment the button was pressed (stored as source=camera).
import { useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, X } from 'lucide-react';
import { useApp } from '../../context';
import { Button, Icon, IconButton } from '../../ui';
import { openCamera } from '../../../core/scan/scanner';

export function CameraCapture({ onShot, onClose }: { onShot: (file: Blob, at: Date) => void; onClose: () => void }) {
  const { t } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'on' | 'off'>('starting');
  useEffect(() => {
    let stream: MediaStream | undefined;
    let live = true;
    void openCamera(video.current!, 1920).then((s) => { if (live) { stream = s; setState('on'); } else s.getTracks().forEach((x) => x.stop()); })
      .catch(() => { if (live) setState('off'); });
    return () => { live = false; stream?.getTracks().forEach((x) => x.stop()); };
  }, []);

  const shoot = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const at = new Date();
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92));
    if (blob) onShot(blob, at);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('rm.cam.title')} className="fixed inset-0 z-50 flex flex-col bg-camera text-on-accent">
      <div className="flex items-center justify-between px-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <IconButton icon={X} label={t('rm.cam.close')} className="bg-scrim text-on-accent" onClick={onClose} />
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={video} className={`h-full w-full object-contain ${state === 'off' ? 'hidden' : ''}`} muted playsInline aria-hidden="true" />
        {state === 'off' && <p role="alert" className="p-6 text-center text-body">{t('rm.cam.none')}</p>}
      </div>
      <div className="flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button onClick={shoot} disabled={state !== 'on'} className="min-w-40">
          <span className="inline-flex items-center gap-2"><Icon as={CameraIcon} />{t('rm.cam.shoot')}</span>
        </Button>
      </div>
    </div>
  );
}
