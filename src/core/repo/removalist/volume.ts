// Volume estimate of a job (Phase 5): boxes and furniture already in the job are counted by their box size or linked
// furniture type; extra lines come from the catalogue or are typed in. Stored in m³. No prices, no quoting.
import { type Ctx, newId, num, optionalText, str, write } from '../core';
import { chooseTruck, totalM3, withBuffer, type TruckChoice } from '../../removalist/volumeMath';
import { listTrucks, listVolumeCatalogue, type VolumeItem } from './business';
import { listJobPieces, type JobPiece } from './pieces';

export interface VolumeLineRow { id: string; volumeItemId: string | null; name: string | null; nameEn: string | null; nameBn: string | null; m3Each: number; quantity: number }
export interface CountedGroup { item: { id: string; nameEn: string | null; nameBn: string | null; m3: number }; isPiece: boolean; count: number }
export interface JobVolume {
  counted: CountedGroup[];
  /** Furniture pieces with no linked type: not counted (add a line, or link a type on the piece). */
  uncounted: JobPiece[];
  lines: VolumeLineRow[];
  countedM3: number; linesM3: number; totalM3: number; bufferPct: number; neededM3: number;
  truck: TruckChoice;
}

const m3Of = (v: number) => {
  if (!Number.isFinite(v) || v < 0 || v > 50) throw new RangeError('size must be 0-50 m³');
  return v;
};

function jobWs(ctx: Ctx, jobId: string): string {
  const ws = ctx.db.selectValue(`SELECT workspace_id FROM jobs WHERE id=?`, [jobId]);
  if (ws == null) throw new Error('job not found');
  return String(ws);
}

export function listVolumeLines(ctx: Ctx, jobId: string): VolumeLineRow[] {
  return ctx.db.selectObjects(`SELECT l.*, c.name_en, c.name_bn FROM job_volume_lines l LEFT JOIN volume_catalogue c ON c.id = l.volume_item_id
      WHERE l.job_id=? ORDER BY l.created_at, l.id`, [jobId])
    .map((r) => ({ id: String(r.id), volumeItemId: str(r.volume_item_id), name: str(r.custom_name), nameEn: str(r.name_en), nameBn: str(r.name_bn), m3Each: num(r.volume_m3_each), quantity: num(r.quantity) }));
}

/** Adds a catalogue item (one more if it is already a line) or a custom line. Catalogue lines keep the size they had when added. */
export function addVolumeLine(ctx: Ctx, jobId: string, l: { volumeItemId: string; quantity?: number } | { name: string; m3Each: number; quantity?: number }): void {
  const ws = jobWs(ctx, jobId);
  const qty = l.quantity ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw new RangeError('quantity must be 1-9999');
  const t = ctx.now();
  write(ctx, () => {
    if ('volumeItemId' in l) {
      const [item] = ctx.db.selectObjects(`SELECT volume_m3 FROM volume_catalogue WHERE id=? AND workspace_id=?`, [l.volumeItemId, ws]);
      if (!item) throw new RangeError('not an item of this business');
      const existing = ctx.db.selectValue(`SELECT id FROM job_volume_lines WHERE job_id=? AND volume_item_id=?`, [jobId, l.volumeItemId]);
      if (existing != null) {
        ctx.db.exec({ sql: `UPDATE job_volume_lines SET quantity=min(9999, quantity+?), updated_at=? WHERE id=?`, bind: [qty, t, existing] });
        return;
      }
      ctx.db.exec({ sql: `INSERT INTO job_volume_lines (id,job_id,volume_item_id,volume_m3_each,quantity,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
        bind: [newId(), jobId, l.volumeItemId, num(item.volume_m3), qty, t, t] });
    } else {
      const name = optionalText(l.name, 'name', 80);
      if (!name) throw new RangeError('name is needed');
      ctx.db.exec({ sql: `INSERT INTO job_volume_lines (id,job_id,custom_name,volume_m3_each,quantity,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
        bind: [newId(), jobId, name, m3Of(l.m3Each), qty, t, t] });
    }
  });
}

/** Sets a line's quantity; 0 removes the line. */
export function setVolumeLineQty(ctx: Ctx, lineId: string, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 9999) throw new RangeError('quantity must be 0-9999');
  write(ctx, () => ctx.db.exec(quantity === 0
    ? { sql: `DELETE FROM job_volume_lines WHERE id=?`, bind: [lineId] }
    : { sql: `UPDATE job_volume_lines SET quantity=?, updated_at=? WHERE id=?`, bind: [quantity, ctx.now(), lineId] }));
}

/** + / − on a line, done in the database so quick taps never use a stale count; 0 removes the line. */
export function bumpVolumeLine(ctx: Ctx, lineId: string, delta: 1 | -1): void {
  write(ctx, () => {
    ctx.db.exec({ sql: `UPDATE job_volume_lines SET quantity=min(9999, quantity+?), updated_at=? WHERE id=? AND quantity+? > 0`, bind: [delta, ctx.now(), lineId, delta] });
    if (delta < 0) ctx.db.exec({ sql: `DELETE FROM job_volume_lines WHERE id=? AND quantity=1 AND ?=0`, bind: [lineId, ctx.db.changes()] });
  });
}

export function setBufferPct(ctx: Ctx, workspaceId: string, pct: number): void {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new RangeError('buffer must be 0-100 %');
  write(ctx, () => ctx.db.exec({ sql: `UPDATE business_profile SET buffer_pct=?, updated_at=? WHERE workspace_id=?`, bind: [pct, ctx.now(), workspaceId] }));
}

/** The whole estimate: counted boxes and furniture, lines, total, buffer and the suggested truck. */
export function jobVolume(ctx: Ctx, jobId: string): JobVolume {
  const ws = jobWs(ctx, jobId);
  // Hidden catalogue items still count for the boxes that use them.
  const items = new Map(ctx.db.selectObjects(`SELECT id, name_en, name_bn, volume_m3 FROM volume_catalogue WHERE workspace_id=?`, [ws])
    .map((r) => [String(r.id), { id: String(r.id), nameEn: str(r.name_en), nameBn: str(r.name_bn), m3: num(r.volume_m3) }]));
  const groups = new Map<string, CountedGroup>();
  const uncounted: JobPiece[] = [];
  for (const p of listJobPieces(ctx, jobId)) {
    const item = p.volumeItemId ? items.get(p.volumeItemId) : undefined;
    if (!item) { uncounted.push(p); continue; }
    const key = `${p.isPiece ? 'p' : 'b'}:${item.id}`;
    const g = groups.get(key) ?? { item, isPiece: p.isPiece, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  const counted = [...groups.values()].sort((a, b) => Number(a.isPiece) - Number(b.isPiece));
  const lines = listVolumeLines(ctx, jobId);
  const countedM3 = totalM3(counted.map((g) => ({ m3Each: g.item.m3, quantity: g.count })));
  const linesM3 = totalM3(lines.map((l) => ({ m3Each: l.m3Each, quantity: l.quantity })));
  const bufferPct = num(ctx.db.selectValue(`SELECT buffer_pct FROM business_profile WHERE workspace_id=?`, [ws]) ?? 10);
  const total = countedM3 + linesM3;
  const neededM3 = withBuffer(total, bufferPct);
  return { counted, uncounted, lines, countedM3, linesM3, totalM3: total, bufferPct, neededM3, truck: chooseTruck(listTrucks(ctx, ws), neededM3) };
}

// Catalogue editing (Settings) ------------------------------------------------------------------

export interface VolumeItemInput { nameEn?: string | null; nameBn?: string | null; volumeM3: number; kind?: 'box' | 'furniture' }

function checkItem(i: VolumeItemInput) {
  const en = optionalText(i.nameEn, 'English name', 80);
  const bn = optionalText(i.nameBn, 'Bangla name', 80);
  if (!en && !bn) throw new RangeError('a name is needed');
  if (!Number.isFinite(i.volumeM3) || i.volumeM3 <= 0 || i.volumeM3 > 50) throw new RangeError('size must be above 0 and at most 50 m³');
  return { en, bn, m3: i.volumeM3 };
}

export function addVolumeItem(ctx: Ctx, workspaceId: string, i: VolumeItemInput): VolumeItem {
  const c = checkItem(i);
  const id = newId();
  const t = ctx.now();
  write(ctx, () => ctx.db.exec({
    sql: `INSERT INTO volume_catalogue (id,workspace_id,name_en,name_bn,kind,volume_m3,sort_order,is_default,created_at,updated_at)
          VALUES (?,?,?,?,?,?,(SELECT coalesce(max(sort_order),0)+1 FROM volume_catalogue WHERE workspace_id=?),0,?,?)`,
    bind: [id, workspaceId, c.en, c.bn, i.kind ?? 'furniture', c.m3, workspaceId, t, t],
  }));
  return listVolumeCatalogue(ctx, workspaceId).find((x) => x.id === id)!;
}

/** Editing an item changes future counts; lines already added keep their size. */
export function updateVolumeItem(ctx: Ctx, id: string, i: VolumeItemInput): void {
  const c = checkItem(i);
  write(ctx, () => ctx.db.exec({ sql: `UPDATE volume_catalogue SET name_en=?, name_bn=?, volume_m3=?, is_default=0, updated_at=? WHERE id=?`, bind: [c.en, c.bn, c.m3, ctx.now(), id] }));
}

/** Hidden items leave the lists but still count for boxes and lines that use them. */
export function hideVolumeItem(ctx: Ctx, id: string): void {
  const ws = str(ctx.db.selectValue(`SELECT workspace_id FROM volume_catalogue WHERE id=?`, [id]));
  if (ws && ctx.db.selectValue(`SELECT default_box_item_id FROM business_profile WHERE workspace_id=?`, [ws]) === id) throw new RangeError('the default box size cannot be hidden');
  write(ctx, () => ctx.db.exec({ sql: `UPDATE volume_catalogue SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`, bind: [ctx.now(), ctx.now(), id] }));
}

/** Moves an item one place up or down in the list (swaps with its neighbour). */
export function moveVolumeItem(ctx: Ctx, id: string, dir: -1 | 1): void {
  const ws = str(ctx.db.selectValue(`SELECT workspace_id FROM volume_catalogue WHERE id=?`, [id]));
  if (!ws) return;
  const list = listVolumeCatalogue(ctx, ws);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  write(ctx, () => list.forEach((x, k) => {
    const pos = k === i ? j : k === j ? i : k;
    ctx.db.exec({ sql: `UPDATE volume_catalogue SET sort_order=? WHERE id=?`, bind: [pos + 1, x.id] });
  }));
}
