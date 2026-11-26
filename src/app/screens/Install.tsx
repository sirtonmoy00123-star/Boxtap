import { useState } from 'react';
import { useApp } from '../context';
import { Button, Sheet } from '../ui';
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
    <Sheet labelledBy="install-title">
      <div>
        <h2 id="install-title" className="text-title2 font-semibold">{t('install.title')}</h2>
        <p className="mt-2 text-text-2">{t('install.why')}</p>
        {p === 'ios' ? (
          iosNotSafari ? <p className="mt-3 font-medium">{t('install.iosChrome')}</p> : (
            <>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>{t('install.iosStep1')} <ShareIcon /></li>
                <li>{t('install.iosStep2')}</li>
                <li>{t('install.iosStep3')}</li>
              </ol>
              <p className="mt-3 rounded-md bg-surface-2 p-3 text-subhead text-warning">{t('install.iosNote')}</p>
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
    </Sheet>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="inline h-5 w-5 align-text-bottom text-accent" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12M7 8l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="11" width="16" height="10" rx="2" />
    </svg>
  );
}
