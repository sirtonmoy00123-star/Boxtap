// In-app QR scanner (ADR-007): camera via getUserMedia, the browser's BarcodeDetector where it exists
// (Android Chrome), zxing-wasm elsewhere (Safari). The zxing .wasm is self-hosted (CSP: no third-party code).
import { parseLabelUrl } from '../repo/labels';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

type Decode = (frame: HTMLVideoElement | ImageData) => Promise<string[]>;

interface BarcodeDetectorLike { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare const BarcodeDetector: {
  new (o: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
} | undefined;

async function nativeDecoder(): Promise<Decode | null> {
  if (typeof BarcodeDetector === 'undefined') return null;
  try {
    if (!(await BarcodeDetector.getSupportedFormats()).includes('qr_code')) return null;
    const d = new BarcodeDetector({ formats: ['qr_code'] });
    return async (frame) => (await d.detect(frame as CanvasImageSource)).map((r) => r.rawValue);
  } catch {
    return null;
  }
}

async function zxingDecoder(): Promise<Decode> {
  const { readBarcodes, prepareZXingModule } = await import('zxing-wasm/reader');
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
  return async (frame) => {
    const img = frame as ImageData;
    return (await readBarcodes(img, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 })).map((r) => r.text);
  };
}

export type ScanResult = { kind: 'label'; code: string } | { kind: 'other'; text: string };

export interface ScannerHandle {
  stop(): void;
  /** True when the camera reports a torch (most Android phones; not iPhone Safari). */
  hasTorch: boolean;
  /** Turns the torch on or off. Resolves false when the camera refused. */
  setTorch(on: boolean): Promise<boolean>;
}

interface TorchCapabilities extends MediaTrackCapabilities { torch?: boolean }

/**
 * Starts the camera into `video` and calls onResult once per distinct decoded text. Only boxtap.app/b/<code>
 * links count as labels (SECURITY_MODEL: malicious QR codes are ignored, never opened).
 */
export interface ScannerOptions {
  /** Pause between decode attempts (ms). Default 120. */
  intervalMs?: number;
  /**
   * Continuous scanning: after this long with no code in view, the same code counts again (so a box scanned twice
   * gets "Already loaded"). Default: a code repeats only after a different one was seen.
   */
  repeatAfterMs?: number;
}

/** Opens the back camera into `video` (shared by the scanner and the condition-photo camera). */
export async function openCamera(video: HTMLVideoElement, width = 1280): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: width } }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true'); // iPhone: no fullscreen takeover
  video.muted = true;
  await video.play();
  return stream;
}

export async function startScanner(video: HTMLVideoElement, onResult: (r: ScanResult, seenAt: number) => void, opts: ScannerOptions = {}): Promise<ScannerHandle> {
  const stream = await openCamera(video);

  const native = await nativeDecoder();
  const decode = native ?? (await zxingDecoder());
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let stopped = false;
  let last = '';
  let lastSeen = 0;
  const interval = opts.intervalMs ?? 120;

  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        const seenAt = performance.now(); // when this frame was taken
        let texts: string[];
        if (native) {
          texts = await decode(video);
        } else {
          const scale = Math.min(1, 960 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          texts = await decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
        }
        const text = texts[0];
        if (!text && opts.repeatAfterMs != null && last && seenAt - lastSeen > opts.repeatAfterMs) last = '';
        if (text) lastSeen = seenAt;
        if (text && text !== last) {
          last = text;
          const code = parseLabelUrl(text);
          onResult(code ? { kind: 'label', code } : { kind: 'other', text }, seenAt);
        }
      }
    } catch (e) {
      console.warn('scan frame failed', e);
    }
    if (!stopped) setTimeout(() => void tick(), interval);
  };
  void tick();

  const track = stream.getVideoTracks()[0];
  const caps = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
  return {
    hasTorch: !!caps.torch,
    async setTorch(on: boolean) {
      try {
        await track!.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
        return true;
      } catch {
        return false;
      }
    },
    stop() {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
