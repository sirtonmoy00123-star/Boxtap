// Small shared UI pieces. Large touch targets (48 px) for phones.
import { useContext, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { AppContext } from './context';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** May return a promise: the button then stays disabled until it settles, so a double tap can't run it twice. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown;
};

export function Button({ variant = 'primary', className = '', onClick, disabled, ...p }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const styles = {
    primary: 'bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-300',
    secondary: 'bg-white text-blue-800 border border-blue-700 hover:bg-blue-50 disabled:text-slate-400 disabled:border-slate-300',
    danger: 'bg-white text-red-700 border border-red-600 hover:bg-red-50',
    ghost: 'text-blue-800 hover:bg-blue-50',
  }[variant];
  const handle = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) return;
    const r = onClick?.(e);
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      setBusy(true);
      void (r as Promise<unknown>).finally(() => setBusy(false));
    }
  };
  return <button type="button" className={`min-h-12 rounded-xl px-4 font-medium ${styles} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} onClick={onClick ? handle : undefined} {...p} />;
}

export function Page({ title, back, actions, children }: { title: ReactNode; back?: () => void; actions?: ReactNode; children: ReactNode }) {
  const app = useContext(AppContext);
  return (
    <div className="mx-auto max-w-xl px-4 pb-28">
      <header className="sticky top-0 z-10 -mx-4 flex items-center gap-2 bg-white/95 px-4 py-3 backdrop-blur">
        {back && <Button variant="ghost" aria-label={app ? app.t('box.back') : 'Back'} onClick={back} className="px-2">←</Button>}
        <h1 className="flex-1 truncate text-xl font-semibold">{title}</h1>
        {actions}
      </header>
      {children}
    </div>
  );
}

export function Banner({ tone = 'warn', children }: { tone?: 'warn' | 'info' | 'danger'; children: ReactNode }) {
  const c = { warn: 'bg-amber-50 text-amber-900 border-amber-300', info: 'bg-blue-50 text-blue-900 border-blue-200', danger: 'bg-red-50 text-red-900 border-red-300' }[tone];
  return <div role="status" className={`border-b px-4 py-2 text-sm ${c}`}>{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block py-2">
      <span className="mb-1 block text-sm text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = 'w-full min-h-12 rounded-xl border border-slate-300 px-3 text-base focus:border-blue-700 focus:outline-none';
