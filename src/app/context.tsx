import { createContext, useContext } from 'react';
import type { Db } from '../core/db/client';
import type { Workspace } from '../core/repo';
import { formatDate, formatNumber, translate, type Key, type Lang } from '../i18n/i18n';

export interface ToastAction { label: string; run: () => unknown }

export interface AppState {
  db: Db;
  workspace: Workspace | null;
  setWorkspace: (w: Workspace | null) => void;
  lang: Lang;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  /** A number as shown on screen (Bangla digits in Bangla). */
  num: (n: number) => string;
  /** A date as shown on screen ("26 Nov 2026" in English). */
  date: (iso: string | number | Date, withTime?: boolean) => string;
  /** Shows the upgrade screen for a blocked write. */
  showUpgrade: (reason: string) => void;
  /** A short message at the bottom. With an action (e.g. Undo) it stays 5 s (DESIGN_SYSTEM §7). */
  toast: (msg: string, action?: ToastAction) => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const s = useContext(AppContext);
  if (!s) throw new Error('useApp outside AppContext');
  return s;
}

/** Screen text: numbers in placeholders get the language's digits (ADR-023). */
export const makeT = (lang: Lang) => (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars, { localDigits: true });
export const makeNum = (lang: Lang) => (n: number) => formatNumber(lang, n);
export const makeDate = (lang: Lang) => (iso: string | number | Date, withTime = false) => formatDate(lang, iso, withTime);
