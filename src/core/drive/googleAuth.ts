// Google Identity Services token model (ADR-020, API_CONTRACTS §6.1). The script loads only after the user
// opens the Drive screen; the token lives in this module's memory only, never in storage (SECURITY_MODEL §2).
// Renewal needs a tap (audit B3: no silent renewal in the browser), once per session and after each hour.
// When the pop-up can't open (iPhone home-screen app), the full-page sign-in in oauthRedirect.ts + /oauth is used (B17).

import { DRIVE_FILE_SCOPE } from './scopes';
import { buildAuthUrl, KEY_CLIENT, KEY_RETURN, KEY_STATE, KEY_TOKEN } from './oauthRedirect';

export const DRIVE_FILE = DRIVE_FILE_SCOPE;
const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface TokenResponse { access_token: string; expires_in: number; error?: string; error_description?: string; scope?: string }
interface TokenClient { requestAccessToken(o?: { prompt?: string; hint?: string }): void }
interface Gis {
  accounts: { oauth2: {
    initTokenClient(c: { client_id: string; scope: string; callback: (t: TokenResponse) => void; error_callback?: (e: { type: string }) => void }): TokenClient;
    hasGrantedAllScopes(t: TokenResponse, ...scopes: string[]): boolean;
    revoke(token: string, done?: () => void): void;
  } };
}
declare global { interface Window { google?: Gis } }

let loading: Promise<Gis> | null = null;
let token: { value: string; expiresAt: number } | null = null;
const listeners = new Set<() => void>();

export const clientId = (): string => import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
export const driveConfigured = (): boolean => clientId().endsWith('.apps.googleusercontent.com');

/** Loads Google's sign-in script (the one allowed third-party script). Call before the tap, so the pop-up isn't blocked. */
export function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  loading ??= new Promise<Gis>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in did not load')));
    s.onerror = () => { loading = null; reject(new Error('Google sign-in could not load (offline?)')); };
    document.head.append(s);
  });
  return loading;
}

export class DrivePermissionError extends Error { name = 'DrivePermissionError'; }
/** The pop-up could not open (e.g. iPhone home-screen app): use the full-page sign-in instead. */
export class PopupBlockedError extends Error { name = 'PopupBlockedError'; }
/** Thrown after starting the full-page sign-in: the page is leaving, stop the current action quietly. */
export class RedirectingError extends Error { name = 'RedirectingError'; }

/** iPhone/iPad home-screen app: pop-ups are unreliable there (spike R11), so go straight to the full-page sign-in. */
export const preferRedirect = (): boolean => (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Starts the full-page sign-in (audit B17). Never returns normally. */
export function startRedirectSignIn(hint?: string): never {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(KEY_STATE, state);
  sessionStorage.setItem(KEY_CLIENT, clientId());
  sessionStorage.setItem(KEY_RETURN, location.pathname);
  location.assign(buildAuthUrl({ clientId: clientId(), redirectUri: `${location.origin}/oauth`, state, hint }));
  throw new RedirectingError('redirecting to Google');
}

/** On app start: take a token left by /oauth (same tab, seconds old) into memory and remove it. */
export function adoptRedirectToken(): boolean {
  const raw = sessionStorage.getItem(KEY_TOKEN);
  if (!raw) return false;
  sessionStorage.removeItem(KEY_TOKEN);
  try {
    const t = JSON.parse(raw) as { value: string; expiresAt: number };
    if (typeof t.value !== 'string' || !(t.expiresAt > Date.now())) return false;
    token = { value: t.value, expiresAt: t.expiresAt };
    listeners.forEach((l) => l());
    return true;
  } catch {
    return false;
  }
}

/** Must run inside a tap handler, with loadGis() already resolved. Resolves with the access token. */
export function requestToken(gis: Gis, hint?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: DRIVE_FILE,
      callback: (t) => {
        if (t.error) { reject(new Error(t.error_description || t.error)); return; }
        // Audit B13: the user may untick Drive on the consent screen.
        if (!gis.accounts.oauth2.hasGrantedAllScopes(t, DRIVE_FILE)) { reject(new DrivePermissionError('BoxTap needs Drive permission to back up')); return; }
        token = { value: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
        listeners.forEach((l) => l());
        resolve(t.access_token);
      },
      error_callback: (e) => reject(e.type === 'popup_failed_to_open' ? new PopupBlockedError('pop-up blocked') : new Error(e.type === 'popup_closed' ? 'Sign-in was closed' : `Sign-in failed (${e.type})`)),
    });
    client.requestAccessToken({ prompt: '', ...(hint ? { hint } : {}) });
  });
}

/** The token if still valid, else null (then the app shows "Tap to back up"). */
export function currentToken(): string | null {
  if (token && Date.now() < token.expiresAt) return token.value;
  token = null;
  return null;
}

export function forgetToken(): void {
  token = null;
  listeners.forEach((l) => l());
}

/** Disconnect: revoke the grant at Google and forget the token. */
export async function revokeAccess(): Promise<void> {
  const t = token?.value;
  forgetToken();
  if (!t) return;
  const gis = await loadGis().catch(() => null);
  await new Promise<void>((r) => (gis ? gis.accounts.oauth2.revoke(t, () => r()) : r()));
}

export function onTokenChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
