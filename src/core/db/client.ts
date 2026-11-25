// Main-thread client for the database worker. Typed proxy over the Service.
import type { Service, ServiceMethod } from '../service/service';
import type { OpenInfo, Request, Response, RestoreResult } from './protocol';
import type { BlockReason } from '../licensing/can';

export class WorkerError extends Error {
  constructor(name: string, message: string, public readonly reason?: BlockReason) {
    super(message);
    this.name = name;
  }
}

type Async<S> = { [K in keyof S]: S[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };
export type Db = Async<Service> & {
  info: OpenInfo;
  close(): Promise<void>;
  exportSnapshot(): Promise<Uint8Array>;
  restore(bytes: Uint8Array): Promise<RestoreResult>;
};

/** allowMemory=false when taking over from another tab: a busy file must fail (and be retried), not fall back. */
/** Rescue copy of the raw database file, from a fresh worker that doesn't try to open it. */
export async function rescueExport(): Promise<Uint8Array> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'boxtap-rescue' });
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<Response>) => (ev.data.ok ? resolve(ev.data.value as Uint8Array) : reject(new Error(ev.data.error.message)));
      worker.postMessage({ id: 1, type: 'rescueExport' } as Request);
    });
  } finally {
    worker.terminate();
  }
}

export async function openDb(allowMemory = true): Promise<Db> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'boxtap-db' });
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  worker.onmessage = (ev: MessageEvent<Response>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) p.resolve(ev.data.value);
    else p.reject(new WorkerError(ev.data.error.name, ev.data.error.message, ev.data.error.reason as BlockReason | undefined));
  };
  type NoId<T> = T extends unknown ? Omit<T, "id"> : never;
  const send = (r: NoId<Request>) => new Promise<unknown>((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...r, id } as Request);
  });
  let info: OpenInfo;
  try {
    info = (await send({ type: 'open', allowMemory })) as OpenInfo;
  } catch (e) {
    worker.terminate(); // a fresh worker per attempt: the VFS caches a failed install
    throw e;
  }
  const close = async () => { await send({ type: 'close' }); worker.terminate(); };
  const exportSnapshot = async () => (await send({ type: 'exportSnapshot' })) as Uint8Array;
  const restore = async (bytes: Uint8Array) => (await send({ type: 'restore', bytes })) as RestoreResult;
  return new Proxy({ info, close, exportSnapshot, restore } as Db, {
    get(target, prop: string) {
      if (prop in target) return (target as unknown as Record<string, unknown>)[prop];
      if (prop === 'then') return undefined;
      return (...args: unknown[]) => send({ type: 'call', method: prop as ServiceMethod, args });
    },
  });
}
