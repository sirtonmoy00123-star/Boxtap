import { createContext, useContext } from 'react';
import type { Db } from '../core/db/client';
import type { Workspace } from '../core/repo';
import { translate, type Key, type Lang } from '../i18n/i18n';

export interface AppState {
  db: Db;
  workspace: Workspace | null;
  setWorkspace: (w: Workspace | null) => void;
  lang: Lang;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  /** Shows the upgrade screen for a blocked write. */
  showUpgrade: (reason: string) => void;
  toast: (msg: string) => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const s = useContext(AppContext);
  if (!s) throw new Error('useApp outside AppContext');
  return s;
}

export const makeT = (lang: Lang) => (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars);
