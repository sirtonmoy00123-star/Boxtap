// Workspaces, rooms, boxes (locations) and labels.
import { bool, clean, type Ctx, newId, num, optionalText, requireText, str, write } from './core';
import { isLabelCode, newLabelCode } from './labels';
import { assertNotInOpenOrder } from './items';

export type WorkspaceType = 'home' | 'seller' | 'removalist';
export interface Workspace {
  id: string; type: WorkspaceType; name: string; country: 'AU' | 'BD'; currency: 'AUD' | 'BDT';
  language: 'en' | 'bn'; jewelleryFields: boolean; createdAt: string;
}
export interface Room { id: string; workspaceId: string; name: string; colour: string; sortOrder: number }
export type BoxKind = 'box' | 'tub' | 'drawer' | 'shelf' | 'bag' | 'other';
export type MoveStatus = 'packed' | 'moved' | 'unpacked';
export interface Box {
  id: string; workspaceId: string; number: number; name: string | null; kind: BoxKind; roomId: string | null;
  spot: string | null; colour: string | null; isFragile: boolean; openFirst: boolean; moveStatus: MoveStatus | null;
  notes: string | null; labelCode: string; createdAt: string; updatedAt: string; deletedAt: string | null;
  /** Removalist (v6): the job this box or piece belongs to, whether it is a furniture piece, and its number in the job. */
  jobId: string | null; isPiece: boolean; jobSeq: number | null;
}

const toWorkspace = (r: Record<string, unknown>): Workspace => ({
  id: String(r.id), type: r.type as WorkspaceType, name: String(r.name), country: r.country as Workspace['country'],
  currency: r.currency as Workspace['currency'], language: r.language as Workspace['language'],
  jewelleryFields: bool(r.jewellery_fields), createdAt: String(r.created_at),
});

export function createWorkspace(ctx: Ctx, w: Pick<Workspace, 'type' | 'name' | 'country' | 'currency' | 'language'>): Workspace {
  const id = newId();
  const t = ctx.now();
  write(ctx, () => ctx.db.exec({
    sql: `INSERT INTO workspaces (id,type,name,country,currency,language,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    bind: [id, w.type, requireText(w.name, 'name', 80), w.country, w.currency, w.language, t, t],
  }));
  return getWorkspace(ctx, id)!;
}

export function getWorkspace(ctx: Ctx, id: string): Workspace | undefined {
  const [r] = ctx.db.selectObjects(`SELECT * FROM workspaces WHERE id=? AND deleted_at IS NULL`, [id]);
  return r ? toWorkspace(r) : undefined;
}

export function listWorkspaces(ctx: Ctx): Workspace[] {
  return ctx.db.selectObjects(`SELECT * FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at`).map(toWorkspace);
}

export function renameWorkspace(ctx: Ctx, id: string, name: string): void {
  write(ctx, () => ctx.db.exec({ sql: `UPDATE workspaces SET name=?, updated_at=? WHERE id=?`, bind: [requireText(name, 'name', 80), ctx.now(), id] }));
}

// Rooms ---------------------------------------------------------------------------------------------

export function createRoom(ctx: Ctx, workspaceId: string, name: string, colour = 'blue'): Room {
  const id = newId();
  const t = ctx.now();
  write(ctx, () => ctx.db.exec({
    sql: `INSERT INTO rooms (id,workspace_id,name,colour,sort_order,created_at,updated_at)
          VALUES (?,?,?,?,(SELECT coalesce(max(sort_order),0)+1 FROM rooms WHERE workspace_id=?),?,?)`,
    bind: [id, workspaceId, requireText(name, 'name', 60), colour, workspaceId, t, t],
  }));
  return listRooms(ctx, workspaceId).find((r) => r.id === id)!;
}

export function listRooms(ctx: Ctx, workspaceId: string): Room[] {
  return ctx.db.selectObjects(`SELECT * FROM rooms WHERE workspace_id=? AND deleted_at IS NULL ORDER BY sort_order, name`, [workspaceId])
    .map((r) => ({ id: String(r.id), workspaceId: String(r.workspace_id), name: String(r.name), colour: String(r.colour), sortOrder: num(r.sort_order) }));
}

export function renameRoom(ctx: Ctx, id: string, name: string): void {
  write(ctx, () => ctx.db.exec({ sql: `UPDATE rooms SET name=?, updated_at=? WHERE id=?`, bind: [requireText(name, 'name', 60), ctx.now(), id] }));
}

/** Ruling (build): deleting a room is not binned; its boxes simply have no room afterwards. */
export function deleteRoom(ctx: Ctx, id: string): void {
  const t = ctx.now();
  write(ctx, () => {
    ctx.db.exec({ sql: `UPDATE locations SET room_id=NULL, updated_at=? WHERE room_id=?`, bind: [t, id] });
    ctx.db.exec({ sql: `UPDATE rooms SET deleted_at=?, updated_at=? WHERE id=?`, bind: [t, t, id] });
  });
}

// Boxes ---------------------------------------------------------------------------------------------

const BOX_SELECT = `SELECT l.*, (SELECT code FROM labels WHERE location_id=l.id AND retired_at IS NULL ORDER BY created_at LIMIT 1) AS label_code
                      FROM locations l`;

const toBox = (r: Record<string, unknown>): Box => ({
  id: String(r.id), workspaceId: String(r.workspace_id), number: num(r.number), name: str(r.name), kind: r.kind as BoxKind,
  roomId: str(r.room_id), spot: str(r.spot), colour: str(r.colour), isFragile: bool(r.is_fragile), openFirst: bool(r.open_first),
  moveStatus: (r.move_status as MoveStatus | null) ?? null, notes: str(r.notes), labelCode: String(r.label_code ?? ''),
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), deletedAt: str(r.deleted_at),
  jobId: str(r.job_id), isPiece: bool(r.is_piece), jobSeq: r.job_seq == null ? null : num(r.job_seq),
});

export interface BoxInput {
  name?: string | null; kind?: BoxKind; roomId?: string | null; spot?: string | null; colour?: string | null;
  isFragile?: boolean; openFirst?: boolean; moveStatus?: MoveStatus | null; notes?: string | null;
}

function insertLabel(ctx: Ctx, workspaceId: string, locationId: string | null): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newLabelCode();
    const exists = ctx.db.selectValue(`SELECT 1 FROM labels WHERE code=?`, [code]);
    if (exists) continue; // rare clash: retry
    ctx.db.exec({ sql: `INSERT INTO labels (code,workspace_id,location_id,created_at) VALUES (?,?,?,?)`, bind: [code, workspaceId, locationId, ctx.now()] });
    return code;
  }
  throw new Error('could not create a unique label code');
}

/** Creates a box with the next number and a fresh label, in one transaction. */
export function createBox(ctx: Ctx, workspaceId: string, b: BoxInput): Box {
  const id = newId();
  const t = ctx.now();
  write(ctx, () => {
    const n = num(ctx.db.selectValue(`SELECT next_box_number FROM workspaces WHERE id=?`, [workspaceId]));
    if (!n) throw new Error('workspace not found');
    ctx.db.exec({ sql: `UPDATE workspaces SET next_box_number=next_box_number+1, updated_at=? WHERE id=?`, bind: [t, workspaceId] });
    ctx.db.exec({
      sql: `INSERT INTO locations (id,workspace_id,number,name,kind,room_id,spot,colour,is_fragile,open_first,move_status,notes,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      bind: [id, workspaceId, n, optionalText(b.name, 'name', 80), b.kind ?? 'box', b.roomId ?? null, optionalText(b.spot, 'spot', 80),
        b.colour ?? null, b.isFragile ? 1 : 0, b.openFirst ? 1 : 0, b.moveStatus ?? null, optionalText(b.notes, 'notes', 2000), t, t],
    });
    insertLabel(ctx, workspaceId, id);
  });
  return getBox(ctx, id)!;
}

export function getBox(ctx: Ctx, id: string): Box | undefined {
  const [r] = ctx.db.selectObjects(`${BOX_SELECT} WHERE l.id=?`, [id]);
  return r ? toBox(r) : undefined;
}

export function listBoxes(ctx: Ctx, workspaceId: string): Box[] {
  return ctx.db.selectObjects(`${BOX_SELECT} WHERE l.workspace_id=? AND l.deleted_at IS NULL ORDER BY l.number`, [workspaceId]).map(toBox);
}

export function updateBox(ctx: Ctx, id: string, b: BoxInput): void {
  const cols: string[] = [];
  const bind: unknown[] = [];
  const set = (c: string, v: unknown) => { cols.push(`${c}=?`); bind.push(v); };
  if ('name' in b) set('name', optionalText(b.name, 'name', 80));
  if (b.kind) set('kind', b.kind);
  if ('roomId' in b) set('room_id', b.roomId ?? null);
  if ('spot' in b) set('spot', optionalText(b.spot, 'spot', 80));
  if ('colour' in b) set('colour', b.colour ?? null);
  if ('isFragile' in b) set('is_fragile', b.isFragile ? 1 : 0);
  if ('openFirst' in b) set('open_first', b.openFirst ? 1 : 0);
  if ('moveStatus' in b) set('move_status', b.moveStatus ?? null);
  if ('notes' in b) set('notes', optionalText(b.notes, 'notes', 2000));
  if (!cols.length) return;
  set('updated_at', ctx.now());
  write(ctx, () => ctx.db.exec({ sql: `UPDATE locations SET ${cols.join(', ')} WHERE id=?`, bind: [...bind, id] }));
}

/** Bins the box and its live items with the same timestamp, so restore brings back exactly those. */
export function deleteBox(ctx: Ctx, id: string): void {
  const t = ctx.now();
  assertNotInOpenOrder(ctx, 'i.location_id = ?', [id]);
  write(ctx, () => {
    ctx.db.exec({ sql: `UPDATE items SET deleted_at=?, updated_at=? WHERE location_id=? AND deleted_at IS NULL`, bind: [t, t, id] });
    ctx.db.exec({ sql: `UPDATE photos SET deleted_at=?, updated_at=? WHERE location_id=? AND deleted_at IS NULL`, bind: [t, t, id] });
    ctx.db.exec({ sql: `UPDATE locations SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`, bind: [t, t, id] });
  });
}

export function restoreBox(ctx: Ctx, id: string): void {
  const t = ctx.now();
  write(ctx, () => {
    const at = ctx.db.selectValue(`SELECT deleted_at FROM locations WHERE id=?`, [id]);
    if (at == null) return;
    ctx.db.exec({ sql: `UPDATE items SET deleted_at=NULL, updated_at=? WHERE location_id=? AND deleted_at=?`, bind: [t, id, at] });
    ctx.db.exec({ sql: `UPDATE photos SET deleted_at=NULL, updated_at=? WHERE location_id=? AND deleted_at=?`, bind: [t, id, at] });
    ctx.db.exec({ sql: `UPDATE locations SET deleted_at=NULL, updated_at=? WHERE id=?`, bind: [t, id] });
  });
}

/** Looks a scanned code up in this device's data. Undefined = "This box isn't in your BoxTap". */
export function boxByLabel(ctx: Ctx, code: string): Box | undefined {
  const [r] = ctx.db.selectObjects(
    `${BOX_SELECT} JOIN labels lb ON lb.location_id = l.id WHERE lb.code=? AND lb.retired_at IS NULL AND l.deleted_at IS NULL`, [code]);
  return r ? toBox(r) : undefined;
}

export function createSpareLabels(ctx: Ctx, workspaceId: string, n: number): string[] {
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new RangeError('n must be 1-500');
  return write(ctx, () => Array.from({ length: n }, () => insertLabel(ctx, workspaceId, null)));
}

/** Sticks a spare (unused) label of the same workspace onto a box. */
export function assignLabel(ctx: Ctx, code: string, boxId: string): void {
  const c = clean(code)?.toUpperCase() ?? '';
  if (!isLabelCode(c)) throw new RangeError('not a label code');
  write(ctx, () => {
    ctx.db.exec({
      sql: `UPDATE labels SET location_id=? WHERE code=? AND location_id IS NULL AND retired_at IS NULL
              AND workspace_id=(SELECT workspace_id FROM locations WHERE id=?)`,
      bind: [boxId, c, boxId],
    });
    if (ctx.db.changes() !== 1) throw new Error('label is not a spare label of this workspace');
  });
}

export function spareLabels(ctx: Ctx, workspaceId: string): string[] {
  return ctx.db.selectValues(`SELECT code FROM labels WHERE workspace_id=? AND location_id IS NULL AND retired_at IS NULL ORDER BY created_at`, [workspaceId]).map(String);
}

export type LabelStatus =
  | { kind: 'box'; workspaceId: string; boxId: string }
  | { kind: 'spare'; workspaceId: string }
  | { kind: 'unknown' };

/** What a scanned code is on this device: a live box's label, an unused spare label, or nothing we know. */
export function labelStatus(ctx: Ctx, code: string): LabelStatus {
  const [r] = ctx.db.selectObjects(
    `SELECT lb.workspace_id, lb.location_id, l.deleted_at AS box_deleted FROM labels lb LEFT JOIN locations l ON l.id = lb.location_id
      WHERE lb.code=? AND lb.retired_at IS NULL`, [code]);
  if (!r) return { kind: 'unknown' };
  if (r.location_id == null) return { kind: 'spare', workspaceId: String(r.workspace_id) };
  if (r.box_deleted != null) return { kind: 'unknown' };
  return { kind: 'box', workspaceId: String(r.workspace_id), boxId: String(r.location_id) };
}
