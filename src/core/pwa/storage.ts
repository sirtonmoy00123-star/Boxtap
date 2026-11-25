// Persistent storage and private-window detection (ARCHITECTURE §6.1, audit W9 and B14).

export interface StorageStatus {
  persisted: boolean;
  /** Likely a private window: tiny quota (Safari/Chrome incognito heuristics). */
  likelyPrivate: boolean;
  quotaBytes: number | null;
}

export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persisted) return false;
  if (await navigator.storage.persisted()) return true;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageStatus(): Promise<StorageStatus> {
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const quota = est?.quota ?? null;
  // Incognito windows typically get a quota far below normal (well under 1 GB on desktop and phones).
  const likelyPrivate = quota != null && quota < 200 * 1024 * 1024;
  return { persisted, likelyPrivate, quotaBytes: quota };
}
