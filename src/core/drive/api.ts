// Minimal Drive API v3 client over fetch (ARCHITECTURE §4: no Google client library beyond sign-in).
// Scope drive.file: BoxTap only sees files it created. The token lives in memory and only in the
// Authorization header (SECURITY_MODEL §2).
import { utf8 } from '../util/encoding';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export type DriveErrorKind = 'auth' | 'quota' | 'rate' | 'forbidden' | 'not_found' | 'conflict' | 'server' | 'network' | 'bad_request';

export class DriveError extends Error {
  name = 'DriveError';
  constructor(public readonly kind: DriveErrorKind, public readonly status: number, public readonly reason: string) {
    super(`drive ${kind} (${status} ${reason})`);
  }
}

export interface DriveFile {
  id: string; name: string; mimeType?: string; parents?: string[]; trashed?: boolean;
  appProperties?: Record<string, string>; modifiedTime?: string;
}

const FIELDS = 'id,name,mimeType,parents,trashed,appProperties,modifiedTime';
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function toError(res: Response): Promise<DriveError> {
  let reason = '';
  try {
    const body = await res.json();
    reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? '';
  } catch { /* non-JSON error body */ }
  const s = res.status;
  const kind: DriveErrorKind =
    s === 401 ? 'auth'
      : s === 403 && reason === 'storageQuotaExceeded' ? 'quota'
        : s === 429 || (s === 403 && /rateLimitExceeded$/i.test(reason)) ? 'rate'
          : s === 403 ? 'forbidden'
            : s === 404 ? 'not_found'
              : s === 409 ? 'conflict'
                : s >= 500 ? 'server' : 'bad_request';
  return new DriveError(kind, s, reason);
}

export class DriveApi {
  constructor(
    private readonly token: () => string | null,
    private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response> = (i, init) => fetch(i, init),
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const t = this.token();
    if (!t) throw new DriveError('auth', 401, 'noToken');
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${t}`);
    let res: Response;
    try {
      res = await this.fetchFn(url, { ...init, headers, cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch {
      throw new DriveError('network', 0, 'offline');
    }
    if (!res.ok) throw await toError(res);
    return res;
  }

  private async list(query: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let page: string | undefined;
    do {
      const u = new URL(`${API}/files`);
      u.searchParams.set('q', query);
      u.searchParams.set('fields', `nextPageToken,files(${FIELDS})`);
      u.searchParams.set('pageSize', '1000');
      u.searchParams.set('spaces', 'drive');
      if (page) u.searchParams.set('pageToken', page);
      const body = await (await this.call(u.toString())).json();
      out.push(...(body.files ?? []));
      page = body.nextPageToken;
    } while (page);
    return out;
  }

  findFolders(name: string): Promise<DriveFile[]> {
    return this.list(`name=${q(name)} and mimeType='${FOLDER_MIME}' and trashed=false`);
  }

  findChild(parentId: string, name: string): Promise<DriveFile[]> {
    return this.list(`name=${q(name)} and ${q(parentId)} in parents and trashed=false`);
  }

  listChildren(parentId: string): Promise<DriveFile[]> {
    return this.list(`${q(parentId)} in parents and trashed=false`);
  }

  async createFolder(name: string, parentId?: string): Promise<DriveFile> {
    const res = await this.call(`${API}/files?fields=${FIELDS}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
    });
    return res.json();
  }

  async getFile(id: string): Promise<DriveFile> {
    return (await this.call(`${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}`)).json();
  }

  async rename(id: string, name: string): Promise<void> {
    await this.call(`${API}/files/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  }

  async setTrashed(id: string, trashed: boolean): Promise<void> {
    await this.call(`${API}/files/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed }) });
  }

  /** Reserve ids before the first upload attempt (audit B10). */
  async generateIds(count: number): Promise<string[]> {
    const body = await (await this.call(`${API}/files/generateIds?count=${count}&space=drive&type=files`)).json();
    return body.ids;
  }

  private multipart(meta: object, bytes: Uint8Array): { body: Blob; type: string } {
    const boundary = `bt${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
    const head = utf8(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`);
    const tail = utf8(`\r\n--${boundary}--\r\n`);
    return { body: new Blob([head, new Uint8Array(bytes), tail]), type: `multipart/related; boundary=${boundary}` };
  }

  /**
   * Multipart create with a pre-reserved id. A 409 means an earlier attempt already created it: done, not a
   * duplicate (audit B10). Never resumable sessions, so no half-written file.
   */
  async upload(f: { id: string; name: string; parent: string; appProperties: Record<string, string>; bytes: Uint8Array }): Promise<{ id: string; alreadyExisted: boolean }> {
    const { body, type } = this.multipart({ id: f.id, name: f.name, parents: [f.parent], appProperties: f.appProperties, mimeType: 'application/octet-stream' }, f.bytes);
    try {
      await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'content-type': type }, body });
      return { id: f.id, alreadyExisted: false };
    } catch (e) {
      if (e instanceof DriveError && e.kind === 'conflict') return { id: f.id, alreadyExisted: true };
      throw e;
    }
  }

  /** Replace a file's content and properties (device.lock). */
  async overwrite(id: string, appProperties: Record<string, string>, bytes: Uint8Array): Promise<DriveFile> {
    const { body, type } = this.multipart({ appProperties }, bytes);
    return (await this.call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=${FIELDS}`, { method: 'PATCH', headers: { 'content-type': type }, body })).json();
  }

  async download(id: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).arrayBuffer());
  }

  /** Permanent delete (not trash, which still uses the user's quota). */
  async remove(id: string): Promise<void> {
    try {
      await this.call(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      if (!(e instanceof DriveError && e.kind === 'not_found')) throw e;
    }
  }
}
