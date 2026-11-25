// Stock (Seller mode). The ledger is append-only (ADR-004): this repository is the only writer of
// stock_movements, and nothing writes items.on_hand / reserved except the ledger trigger.
// Rules: DATABASE_SCHEMA §4 (undo within 24 h, move = two movements, count = one per changed item).
import { type Ctx, newId, num, str, write } from './core';
import { addItem, getItem, type Item } from './items';

export type StockReason = 'sold' | 'restock' | 'damaged' | 'returned' | 'booked' | 'unbooked' | 'shipped';

export class NotEnoughStockError extends Error {
  name = 'NotEnoughStockError';
  constructor(public readonly available: number) { super(`not enough stock (${available} available)`); }
}

export interface Movement {
  id: string; itemId: string; onHandDelta: number; reservedDelta: number; reason: string;
  reversesId: string | null; happenedAt: string; note: string | null; undone: boolean;
}

const DELTAS: Record<StockReason, (q: number) => [number, number]> = {
  sold: (q) => [-q, 0], damaged: (q) => [-q, 0],
  restock: (q) => [q, 0], returned: (q) => [q, 0],
  booked: (q) => [0, q], unbooked: (q) => [0, -q],
  shipped: (q) => [-q, -q],
};

function qty(q: number): number {
  if (!Number.isInteger(q) || q <= 0 || q > 1_000_000) throw new RangeError('quantity must be a whole number above 0');
  return q;
}

function insertMovement(ctx: Ctx, m: { workspaceId: string; itemId: string; onHand: number; reserved: number; reason: string; reversesId?: string | null; note?: string | null }): string {
  const id = newId();
  ctx.db.exec({
    sql: `INSERT INTO stock_movements (id,workspace_id,item_id,on_hand_delta,reserved_delta,reason,reverses_id,happened_at,note)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    bind: [id, m.workspaceId, m.itemId, m.onHand, m.reserved, m.reason, m.reversesId ?? null, ctx.now(), m.note ?? null],
  });
  return id;
}

function liveItem(ctx: Ctx, itemId: string): Item {
  const it = getItem(ctx, itemId);
  if (!it || it.deletedAt) throw new Error('item not found');
  return it;
}

/** One stock change. Selling below what's available needs allowNegative (the "sell anyway?" question). */
export function recordStock(ctx: Ctx, itemId: string, reason: StockReason, quantity: number, opts: { allowNegative?: boolean; note?: string } = {}): Movement {
  const q = qty(quantity);
  return write(ctx, () => {
    const it = liveItem(ctx, itemId);
    const available = it.onHand - it.reserved;
    if ((reason === 'sold' || reason === 'damaged') && available < q && !opts.allowNegative) throw new NotEnoughStockError(available);
    if (reason === 'booked' && available < q) throw new NotEnoughStockError(available);
    if ((reason === 'shipped' || reason === 'unbooked') && it.reserved < q) throw new NotEnoughStockError(it.reserved);
    const [onHand, reserved] = DELTAS[reason](q);
    const id = insertMovement(ctx, { workspaceId: it.workspaceId, itemId, onHand, reserved, reason, note: opts.note });
    return getMovement(ctx, id)!;
  });
}

export function getMovement(ctx: Ctx, id: string): Movement | undefined {
  const [r] = ctx.db.selectObjects(
    `SELECT m.*, EXISTS (SELECT 1 FROM stock_movements u WHERE u.reverses_id = m.id) AS undone FROM stock_movements m WHERE m.id=?`, [id]);
  return r ? toMovement(r) : undefined;
}

const toMovement = (r: Record<string, unknown>): Movement => ({
  id: String(r.id), itemId: String(r.item_id), onHandDelta: num(r.on_hand_delta), reservedDelta: num(r.reserved_delta),
  reason: String(r.reason), reversesId: str(r.reverses_id), happenedAt: String(r.happened_at), note: str(r.note), undone: num(r.undone) === 1,
});

/** Undo (S-05): same item, within 24 hours, exactly reversed, once. */
export function undoStock(ctx: Ctx, movementId: string): Movement {
  return write(ctx, () => {
    const m = getMovement(ctx, movementId);
    if (!m) throw new Error('movement not found');
    if (m.reason === 'undo') throw new Error('an undo cannot be undone');
    if (m.reason === 'moved_in' || m.reason === 'moved_out') throw new Error('undo a move by moving the stock back');
    if (m.undone) throw new Error('already undone');
    if (Date.parse(ctx.now()) - Date.parse(m.happenedAt) > 24 * 3600 * 1000) throw new Error('can only undo within 24 hours');
    const it = getItem(ctx, m.itemId)!;
    const id = insertMovement(ctx, { workspaceId: it.workspaceId, itemId: m.itemId, onHand: -m.onHandDelta, reserved: -m.reservedDelta, reason: 'undo', reversesId: m.id });
    return getMovement(ctx, id)!;
  });
}

/** Count mode (S-07): one 'count' movement per item whose counted number differs. Returns how many changed. */
export function countBox(ctx: Ctx, boxId: string, counted: Record<string, number>): number {
  return write(ctx, () => {
    let changed = 0;
    for (const [itemId, n] of Object.entries(counted)) {
      if (!Number.isInteger(n) || n < 0) throw new RangeError('counts must be whole numbers, 0 or more');
      const it = liveItem(ctx, itemId);
      if (it.locationId !== boxId) throw new Error('item is not in this box');
      const delta = n - it.onHand;
      if (delta === 0) continue;
      insertMovement(ctx, { workspaceId: it.workspaceId, itemId, onHand: delta, reserved: 0, reason: 'count' });
      changed++;
    }
    return changed;
  });
}

/**
 * Move stock to another box (ADR-006: the stock unit is an item in one location). Two movements in one
 * transaction; the target item is the same-named live item in that box, or a new copy of this one.
 */
export function moveStock(ctx: Ctx, itemId: string, targetBoxId: string, quantity: number): Item {
  const q = qty(quantity);
  return write(ctx, () => {
    const it = liveItem(ctx, itemId);
    if (it.onHand - it.reserved < q) throw new NotEnoughStockError(it.onHand - it.reserved);
    const ok = ctx.db.selectValue(`SELECT 1 FROM locations WHERE id=? AND workspace_id=? AND deleted_at IS NULL`, [targetBoxId, it.workspaceId]);
    if (!ok) throw new Error('target box not found');
    if (targetBoxId === it.locationId) throw new Error('item is already in that box');
    const existing = ctx.db.selectValue(
      `SELECT id FROM items WHERE location_id=? AND deleted_at IS NULL AND name=? AND coalesce(alt_name,'')=coalesce(?,'') LIMIT 1`,
      [targetBoxId, it.name, it.altName]);
    let targetId = existing == null ? null : String(existing);
    if (!targetId) {
      const copy = addItem(ctx, {
        workspaceId: it.workspaceId, locationId: targetBoxId, name: it.name, altName: it.altName, notes: it.notes,
        valueEstimateMinor: it.valueEstimateMinor, lowStockLevel: it.lowStockLevel, salePriceMinor: it.salePriceMinor,
        weightMg: it.weightMg, purity: it.purity, makingChargeMinor: it.makingChargeMinor, pricingMode: it.pricingMode,
      });
      targetId = copy.id;
    }
    insertMovement(ctx, { workspaceId: it.workspaceId, itemId, onHand: -q, reserved: 0, reason: 'moved_out' });
    insertMovement(ctx, { workspaceId: it.workspaceId, itemId: targetId, onHand: q, reserved: 0, reason: 'moved_in' });
    return getItem(ctx, targetId)!;
  });
}

/** Newest first. */
export function itemHistory(ctx: Ctx, itemId: string, limit = 50): Movement[] {
  return ctx.db.selectObjects(
    `SELECT m.*, EXISTS (SELECT 1 FROM stock_movements u WHERE u.reverses_id = m.id) AS undone
       FROM stock_movements m WHERE m.item_id=? ORDER BY m.happened_at DESC, m.rowid DESC LIMIT ?`, [itemId, limit]).map(toMovement);
}

export interface LowStockRow { itemId: string; name: string; available: number; level: number; boxId: string; boxNumber: number }

/** S-21: items whose available stock is at or below their low-stock level. */
export function lowStock(ctx: Ctx, workspaceId: string): LowStockRow[] {
  return ctx.db.selectObjects(
    `SELECT i.id, i.name, i.on_hand - i.reserved AS available, i.low_stock_level, l.id AS box_id, l.number
       FROM items i JOIN locations l ON l.id = i.location_id
      WHERE i.workspace_id=? AND i.deleted_at IS NULL AND l.deleted_at IS NULL
        AND i.low_stock_level IS NOT NULL AND i.on_hand - i.reserved <= i.low_stock_level
      ORDER BY available, i.name`, [workspaceId])
    .map((r) => ({ itemId: String(r.id), name: String(r.name), available: num(r.available), level: num(r.low_stock_level), boxId: String(r.box_id), boxNumber: num(r.number) }));
}
