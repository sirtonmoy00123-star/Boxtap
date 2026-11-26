// Tiny history router: the app has a handful of routes and must work offline from the service worker.
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'box'; id: string }
  | { name: 'item'; id: string }
  | { name: 'low' }
  | { name: 'catalogue' }
  | { name: 'reports' }
  | { name: 'orders' }
  | { name: 'order'; id: string }
  | { name: 'bin' }
  | { name: 'rooms' }
  | { name: 'room'; id: string }
  | { name: 'booked' }
  | { name: 'settings' }
  | { name: 'scan' }
  | { name: 'labels' }
  | { name: 'label'; code: string }
  | { name: 'notFound' };

export function parseRoute(path: string): Route {
  if (path === '/' || path === '') return { name: 'home' };
  if (path === '/bin') return { name: 'bin' };
  if (path === '/rooms') return { name: 'rooms' };
  if (path === '/booked') return { name: 'booked' };
  const rm = /^\/room\/([0-9a-f-]{36})$/i.exec(path);
  if (rm) return { name: 'room', id: rm[1]! };
  if (path === '/settings') return { name: 'settings' };
  if (path === '/low') return { name: 'low' };
  if (path === '/catalogue') return { name: 'catalogue' };
  if (path === '/reports') return { name: 'reports' };
  if (path === '/orders') return { name: 'orders' };
  const om = /^\/order\/([0-9a-f-]{36})$/i.exec(path);
  if (om) return { name: 'order', id: om[1]! };
  const im = /^\/item\/([0-9a-f-]{36})$/i.exec(path);
  if (im) return { name: 'item', id: im[1]! };
  if (path === '/scan') return { name: 'scan' };
  if (path === '/labels') return { name: 'labels' };
  let m = /^\/box\/([0-9a-f-]{36})$/i.exec(path);
  if (m) return { name: 'box', id: m[1]! };
  m = /^\/b\/([^/]+)$/.exec(path);
  if (m) return { name: 'label', code: m[1]! };
  return { name: 'notFound' };
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener('popstate', fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('popstate', fn);
  };
};

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  return parseRoute(path);
}
