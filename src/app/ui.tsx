// Shared UI pieces, built only from the design tokens (boxtap-architecture/DESIGN_SYSTEM.md, ADR-023).
// Touch targets are at least 44 px; buttons 50 px; text in rem so it follows the user's text size.
import { useContext, useState, type ButtonHTMLAttributes, type ComponentType, type MouseEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, PackageOpen, ScanLine, TriangleAlert, type LucideProps } from 'lucide-react';
import { AppContext } from './context';

/** Lucide icon at the design size: 24 px, 1.75 stroke, hidden from screen readers (the text next to it speaks). */
export function Icon({ as: I, size = 24, className = '' }: { as: ComponentType<LucideProps>; size?: number; className?: string }) {
  return <I aria-hidden="true" focusable="false" size={size} strokeWidth={1.75} className={`shrink-0 ${className}`} />;
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** May return a promise: the button then stays disabled until it settles, so a double tap can't run it twice. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown;
};

export function Button({ variant = 'primary', className = '', onClick, disabled, ...p }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const styles = {
    primary: 'bg-accent-fill text-on-accent text-headline',
    // Grey fill with the darker --accent-on-grey label, which passes WCAG AA (owner decision 2026-11-26).
    secondary: 'bg-surface-2 text-accent-on-grey text-headline',
    // Destructive: danger text, no fill; kept away from the primary button (DESIGN_SYSTEM §5).
    danger: 'text-danger text-body',
    ghost: 'text-accent text-body',
  }[variant];
  const handle = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) return;
    const r = onClick?.(e);
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      setBusy(true);
      void (r as Promise<unknown>).finally(() => setBusy(false));
    }
  };
  const size = variant === 'primary' || variant === 'secondary' ? 'min-h-12.5' : 'min-h-11';
  return <button type="button" className={`${size} rounded-lg px-4 transition-opacity active:opacity-60 disabled:opacity-40 ${styles} ${className}`}
    disabled={disabled || busy} aria-busy={busy || undefined} onClick={onClick ? handle : undefined} {...p} />;
}

/** A round icon-only button. `label` is required: it is the button's name for screen readers. */
export function IconButton({ icon, label, className = '', ...p }: Omit<ButtonProps, 'children' | 'aria-label'> & { icon: ComponentType<LucideProps>; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`grid min-h-11 min-w-11 place-items-center rounded-full text-accent active:opacity-60 ${className}`}
      {...p} onClick={p.onClick ? (e) => void p.onClick!(e) : undefined}>
      <Icon as={icon} />
    </button>
  );
}

/**
 * A screen. Top-level screens (no `back`) get a large title; detail screens get a back button and a small title.
 * The top bar respects the iPhone notch; the bottom leaves room for the tab bar and the Scan button.
 */
export function Page({ title, back, actions, lead, children }: { title: ReactNode; back?: () => void; actions?: ReactNode; lead?: ReactNode; children: ReactNode }) {
  const app = useContext(AppContext);
  return (
    <div className="mx-auto max-w-[680px] px-4 pb-[calc(10rem+env(safe-area-inset-bottom))] min-[430px]:px-5">
      {/* A top-level screen without actions needs no bar, only the notch spacing. */}
      {!back && !actions ? <div className="h-[max(0.75rem,env(safe-area-inset-top))]" /> : (
      <header className="bar sticky top-0 z-10 -mx-4 flex min-h-11 items-center gap-1 px-2 pt-[env(safe-area-inset-top)] min-[430px]:-mx-5">
        {back && (
          <button type="button" aria-label={app ? app.t('box.back') : 'Back'} onClick={back}
            className="flex min-h-11 min-w-11 items-center text-accent active:opacity-60">
            <Icon as={ChevronLeft} size={28} />
          </button>
        )}
        {back ? <h1 className="flex min-w-0 flex-1 items-center gap-2 text-headline">{lead}{title}</h1> : <span className="flex-1" />}
        {actions}
      </header>)}
      {!back && <h1 className="flex items-center gap-3 pb-2 pt-1 text-large-title">{lead}{title}</h1>}
      {children}
    </div>
  );
}

/** Status banner: icon + text + at most one action (min-width 60 px, centred label; DESIGN_SYSTEM §5). */
export function Banner({ tone = 'warn', children, action }: { tone?: 'warn' | 'info' | 'danger'; children: ReactNode; action?: ReactNode }) {
  const c = { warn: 'text-warning', info: 'text-accent', danger: 'text-danger' }[tone];
  return (
    <div role="status" className="flex items-center gap-3 border-b border-separator bg-surface px-4 py-2 text-subhead">
      <Icon as={TriangleAlert} size={20} className={c} />
      <span className="flex-1 text-text">{children}</span>
      {action}
    </div>
  );
}

/** The one action of a status banner. */
export function BannerAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-h-11 min-w-[60px] rounded-lg border border-separator px-3 text-center text-subhead font-semibold text-accent active:opacity-60">{children}</button>;
}

/** Inset grouped list section (DESIGN_SYSTEM §4). Children are <li>s. */
export function Group({ title, footer, label, children, className = '' }: { title?: ReactNode; footer?: ReactNode; label?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-6 ${className}`}>
      {title && <h2 className="px-4 pb-1.5 text-footnote text-text-2">{title}</h2>}
      <ul aria-label={label} className="group-list overflow-hidden rounded-md bg-surface">{children}</ul>
      {footer && <p className="px-4 pt-1.5 text-footnote text-text-2">{footer}</p>}
    </section>
  );
}

/** A tappable list row: title, optional detail, trailing count or chevron. Always at least 44 px tall. */
export function Row({ title, detail, trailing, lead, onClick, chevron = true, tone, ...p }: {
  title: ReactNode; detail?: ReactNode; trailing?: ReactNode; lead?: ReactNode; onClick?: () => unknown; chevron?: boolean; tone?: 'danger' | 'accent';
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'onClick'>) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-text';
  return (
    <li>
      <button type="button" onClick={onClick ? () => void onClick() : undefined} className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2 disabled:opacity-40" {...p}>
        {lead}
        <span className="min-w-0 flex-1">
          <span className={`block text-body ${color}`}>{title}</span>
          {detail && <span className="block text-subhead text-text-2">{detail}</span>}
        </span>
        {trailing && <span className="text-body text-text-2">{trailing}</span>}
        {chevron && onClick && <Icon as={ChevronRight} size={20} className="text-text-2" />}
      </button>
    </li>
  );
}

/** Signature label tag: the box number in a chip shaped like the printed QR label (DESIGN_SYSTEM §6). */
export function LabelTag({ n, size = 'md' }: { n: string; size?: 'md' | 'lg' }) {
  const s = size === 'lg' ? 'min-w-14 h-14 text-title2' : 'min-w-11 h-11 text-headline';
  return (
    <span aria-hidden="true" className={`num relative inline-grid shrink-0 place-items-center rounded-md border-2 border-accent bg-surface px-2 font-bold text-text ${s}`}>
      {n}
      <svg viewBox="0 0 6 6" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 text-accent" fill="currentColor"><path d="M0 0h6v2H2v4H0z" /></svg>
    </span>
  );
}

/** Fragile / Open first / Low stock: always icon + word, never colour alone (DESIGN_SYSTEM §2). */
export function Badge({ kind, children }: { kind: 'fragile' | 'openFirst' | 'low'; children: ReactNode }) {
  const icon = kind === 'openFirst' ? PackageOpen : TriangleAlert;
  const c = kind === 'openFirst' ? 'text-text' : 'text-warning';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-caption ${c}`}>
      <Icon as={icon} size={14} />{children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block py-2">
      <span className="mb-1 block text-subhead text-text-2">{label}</span>
      {children}
    </label>
  );
}

/** Inputs are at least 17 px (iPhone does not zoom) and 44 px tall. */
export const inputClass = 'w-full min-h-11 rounded-md border border-separator bg-surface px-3 text-body text-text focus:border-accent focus:outline-none';

export interface Tab { id: string; label: string; icon: ComponentType<LucideProps>; onClick: () => void }

/**
 * Bottom tab bar (3 tabs, word labels) and the floating 56 px Scan button above it (an action, not a tab).
 * At 1024 px and wider the tabs become a sidebar.
 */
export function TabBar({ tabs, current, label, scanLabel, onScan }: { tabs: Tab[]; current: string; label: string; scanLabel: string; onScan: () => void }) {
  return (
    <>
      <nav aria-label={label} className="bar fixed inset-x-0 bottom-0 z-30 border-t border-separator pb-[env(safe-area-inset-bottom)] lg:inset-x-auto lg:bottom-auto lg:left-0 lg:top-0 lg:h-dvh lg:w-56 lg:border-r lg:border-t-0 lg:pt-[calc(1rem+env(safe-area-inset-top))]">
        <ul className="mx-auto flex max-w-[680px] lg:flex-col lg:gap-1 lg:px-2">
          {tabs.map((tab) => {
            const on = tab.id === current;
            return (
              <li key={tab.id} className="flex-1 lg:flex-none">
                <button type="button" onClick={tab.onClick} aria-current={on ? 'page' : undefined}
                  className={`flex min-h-12 w-full flex-col items-center justify-center gap-0.5 px-1 pt-1 text-caption lg:flex-row lg:justify-start lg:gap-3 lg:rounded-md lg:px-3 lg:text-body ${on ? 'text-accent' : 'text-text-2'}`}>
                  <Icon as={tab.icon} />
                  <span>{tab.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <button type="button" aria-label={scanLabel} onClick={onScan}
        className="fixed bottom-[calc(3rem+12px+env(safe-area-inset-bottom))] left-1/2 z-40 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full bg-accent-fill text-on-accent shadow-lg active:opacity-80 lg:bottom-[calc(24px+env(safe-area-inset-bottom))] lg:left-auto lg:right-6 lg:translate-x-0">
        <Icon as={ScanLine} size={28} />
      </button>
    </>
  );
}

/** Bottom sheet frame: grabber, half height or more, rounded top (DESIGN_SYSTEM §5). */
export function Sheet({ labelledBy, children, onClose }: { labelledBy: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="anim-fade fixed inset-0 z-50 grid place-items-end bg-scrim sm:place-items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="anim-in w-full max-w-md rounded-t-lg bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-lg">
        <div aria-hidden="true" className="mx-auto -mt-3 mb-3 h-1.5 w-9 rounded-full bg-surface-2" />
        {children}
      </div>
    </div>
  );
}
