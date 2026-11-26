// Continuous scanning for the load and unload check (plan §8, Phase 3): the camera stays open, every new code is
// handled one at a time, with a short beep (Web Audio), a vibration on Android only, and the screen kept on
// (Wake Lock) where the browser supports it. Works offline: nothing here uses the network.
import { parseLabelUrl } from '../repo/labels';
import { startScanner, type ScannerHandle, type ScanResult } from './scanner';

export type Handler = (r: ScanResult, seenAt: number) => Promise<void> | void;

/**
 * Runs scans strictly one after another (a second code seen while the first is being saved waits its turn), and
 * ignores the same text again within `sameWithinMs` (a label held in view). Pure: no camera, easy to test.
 */
export function serialFeed(handle: Handler, sameWithinMs = 1500, now: () => number = () => performance.now()) {
  let chain: Promise<void> = Promise.resolve();
  const recent = new Map<string, number>();
  return (r: ScanResult, seenAt = now()): Promise<void> => {
    const key = r.kind === 'label' ? r.code : r.text;
    const at = recent.get(key);
    if (at != null && seenAt - at < sameWithinMs) return chain;
    recent.set(key, seenAt);
    chain = chain.then(() => handle(r, seenAt)).catch((e) => console.warn('scan handling failed', e));
    return chain;
  };
}

/** Starts the camera for continuous scanning. Repeats of one code are allowed again after 1.5 s without it. */
export function startContinuousScan(video: HTMLVideoElement, handle: Handler): Promise<ScannerHandle> {
  const feed = serialFeed(handle);
  return startScanner(video, (r, seenAt) => void feed(r, seenAt), { intervalMs: 80, repeatAfterMs: 1500 });
}

export type Signal = 'ok' | 'already' | 'warn';

let audio: AudioContext | undefined;
/** A short beep: high for a counted box, soft for "already", three loud low tones for a wrong job or bad code. */
export function beep(kind: Signal): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const tones = kind === 'ok' ? [[1320, 0.09, 0.25]] : kind === 'already' ? [[660, 0.07, 0.12]] : [[330, 0.18, 0.6], [330, 0.18, 0.6], [330, 0.18, 0.6]];
    let t = audio.currentTime;
    for (const [freq, dur, vol] of tones as [number, number, number][]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = kind === 'warn' ? 'square' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.06;
    }
  } catch {
    // No audio (some browsers before a tap): the big counter and the message still show.
  }
}

/** Vibration is a bonus on Android only (DESIGN_SYSTEM §7); iPhone Safari has none. */
export function buzz(kind: Signal, isAndroid: boolean): void {
  if (!isAndroid) return;
  navigator.vibrate?.(kind === 'ok' ? 30 : kind === 'warn' ? [200, 100, 200] : 15);
}

interface WakeLockLike { release(): Promise<void>; released: boolean }
/**
 * Keeps the screen on while scanning (Wake Lock API; iPhone home-screen apps from iOS 18.4). Taken again when the
 * page comes back into view. Returns whether it is supported, and a release function.
 */
export async function keepScreenOn(): Promise<{ supported: boolean; release: () => void }> {
  const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockLike> } }).wakeLock;
  if (!wl) return { supported: false, release: () => {} };
  let lock: WakeLockLike | null = null;
  let on = true;
  const take = async () => { try { if (on && document.visibilityState === 'visible') lock = await wl.request('screen'); } catch { /* denied: carry on */ } };
  const onVis = () => { if (document.visibilityState === 'visible' && (!lock || lock.released)) void take(); };
  document.addEventListener('visibilitychange', onVis);
  await take();
  return { supported: true, release: () => { on = false; document.removeEventListener('visibilitychange', onVis); void lock?.release().catch(() => {}); } };
}

/**
 * Test-only scan input, compiled in only when VITE_E2E_SCAN_HOOK=1 (like the Pro preview build). The browser tests
 * have no camera; this feeds QR text through the same handling as a real scan. Never set for real customers.
 */
export function installScanHook(handle: (r: ScanResult) => void): () => void {
  if (import.meta.env.VITE_E2E_SCAN_HOOK !== '1') return () => {};
  const w = window as Window & { __boxtapScan?: (text: string) => void };
  w.__boxtapScan = (text: string) => { const code = parseLabelUrl(text); handle(code ? { kind: 'label', code } : { kind: 'other', text }); };
  return () => { delete w.__boxtapScan; };
}
