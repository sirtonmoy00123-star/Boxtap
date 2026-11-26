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
  | { name: 'jobNew' }
  | { name: 'job'; id: string }
  | { name: 'jobEdit'; id: string }
  | { name: 'jobLabels'; id: string }
  | { name: 'jobVolume'; id: string }
  | { name: 'loadCheck'; id: string; direction: 'load' | 'unload' }
  | { name: 'scanJob' }
  | { name: 'conditionStage'; id: string; stage: 'pickup' | 'delivery' }
  | { name: 'conditionPiece'; id: string; stage: 'pickup' | 'delivery'; boxId: string }
  | { name: 'signOff'; id: string; stage: 'pickup' | 'delivery' }
  | { name: 'business' }
  | { name: 'trucks' }
  | { name: 'volumeCatalogue' }
  | { name: 'addRemovalist' }
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
  if (path === '/job/new') return { name: 'jobNew' };
  if (path === '/scan-job') return { name: 'scanJob' };
  const cp = /^\/job\/([0-9a-f-]{36})\/condition\/(pickup|delivery)(?:\/([0-9a-f-]{36}))?$/i.exec(path);
  if (cp) return cp[3] ? { name: 'conditionPiece', id: cp[1]!, stage: cp[2] as 'pickup' | 'delivery', boxId: cp[3] } : { name: 'conditionStage', id: cp[1]!, stage: cp[2] as 'pickup' | 'delivery' };
  const sg = /^\/job\/([0-9a-f-]{36})\/sign\/(pickup|delivery)$/i.exec(path);
  if (sg) return { name: 'signOff', id: sg[1]!, stage: sg[2] as 'pickup' | 'delivery' };
  const cm = /^\/job\/([0-9a-f-]{36})\/check\/(load|unload)$/i.exec(path);
  if (cm) return { name: 'loadCheck', id: cm[1]!, direction: cm[2] as 'load' | 'unload' };
  const jm = /^\/job\/([0-9a-f-]{36})(\/edit|\/labels|\/volume)?$/i.exec(path);
  if (jm) {
    if (jm[2] === '/edit') return { name: 'jobEdit', id: jm[1]! };
    if (jm[2] === '/labels') return { name: 'jobLabels', id: jm[1]! };
    if (jm[2] === '/volume') return { name: 'jobVolume', id: jm[1]! };
    return { name: 'job', id: jm[1]! };
  }
  if (path === '/business') return { name: 'business' };
  if (path === '/trucks') return { name: 'trucks' };
  if (path === '/volume-catalogue') return { name: 'volumeCatalogue' };
  if (path === '/add-removalist') return { name: 'addRemovalist' };
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
