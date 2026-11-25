import { useState } from 'react';
import { useApp } from '../context';
import { Button } from '../ui';
import { canPromptInstall, platform, promptInstall, snoozeInstall } from '../../core/pwa/install';

/** Install guide (ARCHITECTURE §5.1). iPhone: picture steps; Android/desktop: the browser's install prompt. */
export function InstallGuide({ onClose }: { onClose: () => void }) {
  const { t } = useApp();
  const p = platform();
  const [canPrompt] = useState(canPromptInstall());
  const iosNotSafari = p === 'ios' && /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

  const later = () => { snoozeInstall(); onClose(); };
  const install = async () => { await promptInstall(); onClose(); };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="install-title" className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <h2 id="install-title" className="text-xl font-semibold">{t('install.title')}</h2>
        <p className="mt-2 text-slate-700">{t('install.why')}</p>
        {p === 'ios' ? (
          iosNotSafari ? <p className="mt-3 font-medium">{t('install.iosChrome')}</p> : (
            <>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>{t('install.iosStep1')} <ShareIcon /></li>
                <li>{t('install.iosStep2')}</li>
                <li>{t('install.iosStep3')}</li>
              </ol>
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('install.iosNote')}</p>
            </>
          )
        ) : (
          <p className="mt-3">{t(p === 'android' ? 'install.androidStep' : 'install.desktopStep')}</p>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {canPrompt && <Button onClick={() => void install()}>{t('install.button')}</Button>}
          <Button variant="secondary" onClick={later}>{t('install.later')}</Button>
        </div>
      </div>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="inline h-5 w-5 align-text-bottom text-blue-700" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12M7 8l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="11" width="16" height="10" rx="2" />
    </svg>
  );
}
