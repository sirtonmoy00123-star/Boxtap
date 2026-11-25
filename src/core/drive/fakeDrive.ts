// Test double for the small part of Drive API v3 that BoxTap uses. Mirrors the documented behaviour the design
// relies on: generateIds, create-with-id returning 409 when reused, trashed=false queries, appProperties.
// Real-API behaviour a fake can't copy (listing lag, exact 403 reasons) is for the nightly real-API suite.

interface FakeFile {
  id: string; name: string; mimeType: string; parents: string[]; trashed: boolean;
  appProperties: Record<string, string>; modifiedTime: string; data: Uint8Array;
}

export class FakeDrive {
  files = new Map<string, FakeFile>();
  token = 'good-token';
  quotaBytes = Infinity;
  /** Next request to fail with this status (and reason), once. */
  failNext: { status: number; reason?: string; afterCommit?: boolean } | null = null;
  calls: string[] = [];
  private n = 0;
  private clock = Date.parse('2026-11-25T00:00:00Z');

  private used() { let b = 0; for (const f of this.files.values()) b += f.data.length; return b; }
  private time() { this.clock += 1000; return new Date(this.clock).toISOString(); }
  private json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
  private err(status: number, reason = 'error') { return this.json(status, { error: { code: status, errors: [{ reason }], message: reason } }); }

  private matches(f: FakeFile, q: string): boolean {
    for (const part of q.split(' and ')) {
      let m: RegExpMatchArray | null;
      if ((m = part.match(/^name='(.*)'$/))) { if (f.name !== m[1]!.replace(/\\'/g, "'")) return false; }
      else if ((m = part.match(/^mimeType='(.*)'$/))) { if (f.mimeType !== m[1]) return false; }
      else if (part === 'trashed=false') { if (f.trashed) return false; }
      else if ((m = part.match(/^'(.*)' in parents$/))) { if (!f.parents.includes(m[1]!)) return false; }
      else throw new Error(`fake drive: unsupported query part ${part}`);
    }
    return true;
  }

  private view(f: FakeFile) {
    return { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, trashed: f.trashed, appProperties: f.appProperties, modifiedTime: f.modifiedTime };
  }

  private parseMultipart(body: Uint8Array, contentType: string): { meta: Record<string, unknown>; data: Uint8Array } {
    const boundary = /boundary=([^;]+)/.exec(contentType)![1]!;
    let text = ''; // byte-for-byte (TextDecoder 'latin1' is really windows-1252)
    for (let i = 0; i < body.length; i += 8192) text += String.fromCharCode(...body.subarray(i, i + 8192));
    const parts = text.split(`--${boundary}`).slice(1, -1);
    const metaPart = parts[0]!.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    const dataStr = parts[1]!.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    return { meta: JSON.parse(metaPart), data: Uint8Array.from(dataStr, (c) => c.charCodeAt(0)) };
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    this.calls.push(`${method} ${url.pathname}`);
    const auth = new Headers(init.headers).get('authorization');
    if (auth !== `Bearer ${this.token}`) return this.err(401, 'authError');
    let commitThenFail: { status: number; reason?: string } | null = null;
    if (this.failNext) {
      const f = this.failNext;
      this.failNext = null;
      if (!f.afterCommit) return this.err(f.status, f.reason);
      commitThenFail = f;
    }
    const res = await this.route(url, method, init);
    return commitThenFail ? this.err(commitThenFail.status, commitThenFail.reason) : res;
  };

  private async route(url: URL, method: string, init: RequestInit): Promise<Response> {
    const p = url.pathname;
    if (p === '/drive/v3/files/generateIds') {
      const count = Number(url.searchParams.get('count') ?? 10);
      return this.json(200, { ids: Array.from({ length: count }, () => `gen${++this.n}`) });
    }
    if (p === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      return this.json(200, { files: [...this.files.values()].filter((f) => this.matches(f, q)).map((f) => this.view(f)) });
    }
    if (p === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(String(init.body));
      const id = meta.id ?? `f${++this.n}`;
      if (this.files.has(id)) return this.err(409, 'fileIdInUse');
      const f: FakeFile = { id, name: meta.name, mimeType: meta.mimeType ?? 'application/octet-stream', parents: meta.parents ?? [], trashed: false, appProperties: meta.appProperties ?? {}, modifiedTime: this.time(), data: new Uint8Array() };
      this.files.set(id, f);
      return this.json(200, this.view(f));
    }
    if (p === '/upload/drive/v3/files' && method === 'POST') {
      const body = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
      const { meta, data } = this.parseMultipart(body, new Headers(init.headers).get('content-type')!);
      if (this.used() + data.length > this.quotaBytes) return this.err(403, 'storageQuotaExceeded');
      const id = String(meta.id ?? `f${++this.n}`);
      if (this.files.has(id)) return this.err(409, 'fileIdInUse');
      const f: FakeFile = { id, name: String(meta.name), mimeType: String(meta.mimeType ?? 'application/octet-stream'), parents: (meta.parents as string[]) ?? [], trashed: false, appProperties: (meta.appProperties as Record<string, string>) ?? {}, modifiedTime: this.time(), data };
      this.files.set(id, f);
      return this.json(200, this.view(f));
    }
    let m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (m && method === 'PATCH') {
      const f = this.files.get(m[1]!);
      if (!f) return this.err(404, 'notFound');
      const body = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
      const { meta, data } = this.parseMultipart(body, new Headers(init.headers).get('content-type')!);
      Object.assign(f.appProperties, meta.appProperties ?? {});
      f.data = data;
      f.modifiedTime = this.time();
      return this.json(200, this.view(f));
    }
    m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (m) {
      const f = this.files.get(m[1]!);
      if (!f) return this.err(404, 'notFound');
      if (method === 'GET') {
        if (url.searchParams.get('alt') === 'media') return new Response(new Uint8Array(f.data), { status: 200 });
        return this.json(200, this.view(f));
      }
      if (method === 'PATCH') {
        const meta = JSON.parse(String(init.body ?? '{}'));
        if (meta.name) f.name = meta.name;
        if (typeof meta.trashed === 'boolean') f.trashed = meta.trashed;
        if (meta.appProperties) Object.assign(f.appProperties, meta.appProperties);
        f.modifiedTime = this.time();
        return this.json(200, this.view(f));
      }
      if (method === 'DELETE') {
        this.files.delete(f.id);
        for (const c of [...this.files.values()]) if (c.parents.includes(f.id)) this.files.delete(c.id);
        return new Response(null, { status: 204 });
      }
    }
    return this.err(400, `fake drive: unsupported ${method} ${p}`);
  }
}
