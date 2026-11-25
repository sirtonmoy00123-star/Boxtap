// Install to the home screen (ARCHITECTURE §5.1, §6; audit W1, B14). iPhone has no install prompt, so the app
// shows a picture guide; Android and desktop Chrome get the browser's own prompt when it has offered one.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we offer it at the right moment instead
    deferred = e as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => { deferred = null; });
}

export type Platform = 'ios' | 'android' | 'desktop';

export function platform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** True when running as the installed app (home-screen icon or desktop app window). */
export function isInstalled(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export const canPromptInstall = (): boolean => deferred != null;

/** Shows the browser's install prompt. Must run from a tap. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

const SNOOZE_KEY = 'boxtap.installGuideSnoozedAt';

/** Ask before the 5th box (iPhone always; elsewhere only if storage isn't protected yet), at most once a day. */
export function shouldOfferInstall(boxCount: number, persisted: boolean): boolean {
  if (isInstalled() || boxCount < 4) return false;
  if (platform() !== 'ios' && persisted) return false;
  const at = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
  return Date.now() - at > 24 * 3600 * 1000;
}

export const snoozeInstall = (): void => localStorage.setItem(SNOOZE_KEY, String(Date.now()));
