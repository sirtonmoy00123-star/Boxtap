// Service worker registration with an "update available" prompt (updates are offered, never forced; W3).
import { registerSW } from 'virtual:pwa-register';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const update = registerSW({
    onNeedRefresh() {
      showUpdateBar(() => void update(true));
    },
  });
}

function showUpdateBar(apply: () => void): void {
  if (document.getElementById('bt-update')) return;
  const bar = document.createElement('div');
  bar.id = 'bt-update';
  bar.setAttribute('role', 'status');
  bar.className = 'fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-blue-800 px-4 py-3 text-white';
  const text = document.createElement('span');
  text.textContent = navigator.language?.startsWith('bn') ? 'নতুন সংস্করণ এসেছে' : 'New version available';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rounded-lg bg-white px-3 py-2 font-medium text-blue-900';
  btn.textContent = navigator.language?.startsWith('bn') ? 'আপডেট করুন' : 'Tap to update';
  btn.onclick = apply;
  bar.append(text, btn);
  document.body.append(bar);
}
