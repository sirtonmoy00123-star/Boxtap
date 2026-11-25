import { describe, it, expect } from 'vitest';
import { buildAuthUrl, parseRedirect } from './oauthRedirect';

describe('full-page Google sign-in (audit B17)', () => {
  it('asks only for drive.file, with a token response and the state', () => {
    const u = new URL(buildAuthUrl({ clientId: 'abc.apps.googleusercontent.com', redirectUri: 'https://boxtap.app/oauth', state: 's123' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('response_type')).toBe('token');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('state')).toBe('s123');
    expect(u.searchParams.get('redirect_uri')).toBe('https://boxtap.app/oauth');
  });

  it('accepts a token only when a sign-in is pending and the state matches', () => {
    const hash = '#access_token=ya29.tok&token_type=Bearer&expires_in=3599&state=s123&scope=https://www.googleapis.com/auth/drive.file';
    expect(parseRedirect(hash, 's123')).toEqual({ ok: true, token: 'ya29.tok', expiresIn: 3599 });
    expect(parseRedirect(hash, 'other')).toEqual({ ok: false, reason: 'state' });
    expect(parseRedirect(hash, null)).toEqual({ ok: false, reason: 'state' });
  });

  it('reports a refusal or a missing Drive permission', () => {
    expect(parseRedirect('#error=access_denied&state=s1', 's1')).toEqual({ ok: false, reason: 'denied' });
    expect(parseRedirect('#access_token=t&expires_in=10&state=s1&scope=email', 's1')).toEqual({ ok: false, reason: 'scope' });
    expect(parseRedirect('', 's1')).toEqual({ ok: false, reason: 'missing' });
  });
});
