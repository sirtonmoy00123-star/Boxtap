// /oauth: receives Google's full-page sign-in answer (audit B17). Loads nothing but this file. The token is removed
// from the address bar before anything else, accepted only for a pending sign-in with the same state, checked to be
// issued for BoxTap's own client, then handed to the app through sessionStorage (same tab, seconds only).
import { KEY_CLIENT, KEY_RETURN, KEY_STATE, KEY_TOKEN, parseRedirect } from '../core/drive/oauthRedirect';

const hash = location.hash;
history.replaceState(null, '', '/oauth');
const state = sessionStorage.getItem(KEY_STATE);
const client = sessionStorage.getItem(KEY_CLIENT);
const back = sessionStorage.getItem(KEY_RETURN);
sessionStorage.removeItem(KEY_STATE);
sessionStorage.removeItem(KEY_RETURN);
const returnTo = back && back.startsWith('/') && !back.startsWith('//') ? back : '/settings';

async function run() {
  const parsed = parseRedirect(hash, state);
  if (!parsed.ok) return `drive=${parsed.reason}`;
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(parsed.token)}`, { cache: 'no-store', referrerPolicy: 'no-referrer' });
  const info = res.ok ? await res.json() : null;
  if (!info || !client || (info.aud !== client && info.azp !== client)) return 'drive=client';
  sessionStorage.setItem(KEY_TOKEN, JSON.stringify({ value: parsed.token, expiresAt: Date.now() + (parsed.expiresIn - 60) * 1000 }));
  return 'drive=signed-in';
}

run().catch(() => 'drive=failed').then((q) => {
  location.replace(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${q}`);
});
