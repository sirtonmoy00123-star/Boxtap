// One tab at a time owns the database (ARCHITECTURE §6.1, audit W2 and B13a).
const LOCK = 'boxtap-db';
const CHANNEL = 'boxtap-tabs';

export interface TabLock {
  /** Resolves when this tab must stop because another tab took over. */
  lost: Promise<void>;
  release(): void;
}

/** Tries to take the lock without waiting (or steals it). Returns null if another tab holds it. */
export async function tryAcquire(steal = false): Promise<TabLock | null> {
  if (!('locks' in navigator)) return fakeLock(); // very old browsers: no guard possible
  let release: (() => void) | undefined;
  let markLost!: () => void;
  const lost = new Promise<void>((r) => (markLost = r));
  const held = await new Promise<boolean>((resolveHeld) => {
    const opts: LockOptions = steal ? { steal: true } : { ifAvailable: true };
    navigator.locks
      .request(LOCK, opts, (lock) => {
        if (!lock) {
          resolveHeld(false);
          return undefined;
        }
        resolveHeld(true);
        return new Promise<void>((r) => (release = r));
      })
      .catch(() => markLost()); // AbortError: our lock was stolen by another tab
  });
  if (!held) return null;
  const bc = new BroadcastChannel(CHANNEL);
  if (steal) bc.postMessage({ type: 'taken' });
  bc.onmessage = (e: MessageEvent<{ type?: string }>) => {
    if (e.data?.type === 'taken') markLost();
  };
  void lost.then(() => bc.close());
  return {
    lost,
    release: () => {
      release?.();
      bc.close();
    },
  };
}

function fakeLock(): TabLock {
  return { lost: new Promise(() => {}), release: () => {} };
}

/** Steals the lock, then retries `open` for about 5 s while the old tab releases its storage handles. */
export async function takeOver(open: () => Promise<void>): Promise<TabLock> {
  const lock = await tryAcquire(true);
  if (!lock) throw new Error('could not take the lock');
  const until = Date.now() + 5000;
  for (;;) {
    try {
      await open();
      return lock;
    } catch (e) {
      if (Date.now() > until) {
        lock.release();
        throw e;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
