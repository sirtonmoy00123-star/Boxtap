// Full-page Google sign-in, used when the pop-up can't open (iPhone home-screen app; API_CONTRACTS §6.1,
// SECURITY_MODEL audit B17). Token model, scope drive.file only, a random state per attempt.
import { DRIVE_FILE_SCOPE } from './scopes';

export function buildAuthUrl(o: { clientId: string; redirectUri: string; state: string; hint?: string }): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', o.clientId);
  u.searchParams.set('redirect_uri', o.redirectUri);
  u.searchParams.set('response_type', 'token');
  u.searchParams.set('scope', DRIVE_FILE_SCOPE);
  u.searchParams.set('state', o.state);
  u.searchParams.set('include_granted_scopes', 'true');
  if (o.hint) u.searchParams.set('login_hint', o.hint);
  return u.toString();
}

export type Parsed = { ok: true; token: string; expiresIn: number } | { ok: false; reason: 'state' | 'denied' | 'scope' | 'missing' };

/** Reads the fragment Google returns. Accepted only while a sign-in is pending with the same state. */
export function parseRedirect(hash: string, expectedState: string | null): Parsed {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (!p.get('access_token') && !p.get('error')) return { ok: false, reason: 'missing' };
  if (!expectedState || p.get('state') !== expectedState) return { ok: false, reason: 'state' };
  if (p.get('error')) return { ok: false, reason: 'denied' };
  const scopes = (p.get('scope') ?? '').split(/\s+/);
  if (!scopes.includes(DRIVE_FILE_SCOPE)) return { ok: false, reason: 'scope' };
  return { ok: true, token: p.get('access_token')!, expiresIn: Number(p.get('expires_in') ?? 3600) };
}

// sessionStorage keys for the hand-off within the same tab.
export const KEY_STATE = 'boxtap.oauth.state';
export const KEY_RETURN = 'boxtap.oauth.return';
export const KEY_CLIENT = 'boxtap.oauth.client';
/** The token waits here for seconds only: written by /oauth, read and removed by the app on its next start. */
export const KEY_TOKEN = 'boxtap.oauth.token';
