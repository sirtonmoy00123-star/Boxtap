// Items, search and counts.
import { clean, type Ctx, newId, num, optionalText, requireText, str, write } from './core';

export interface Item {
  id: string; workspaceId: string; locationId: string; name: string; altName: string | null; notes: string | null;
  valueEstimateMinor: number | null; onHand: number; reserved: number; createdAt: string; deletedAt: string | null;
  // Seller fields (S-01..S-10, ADR-012 jewellery)
  lowStockLevel: number | null; salePriceMinor: number | null; pricingMode: 'per_piece' | 'by_weight';
  weightMg: number | null; purity: string | null; makingChargeMinor: number | null;
  /** Pro: what the seller paid for one (single owner device for now). */
  costPriceMinor: number | null;
  /** Pro variants: the product this item belongs to, and its variant label (e.g. "Size 7"). */
  productId: string | null; variantLabel: string | null;
}
export interface ItemInput {
  workspaceId: string; locationId: string; name: string; altName?: string | null; notes?: string | null;
  valueEstimateMinor?: number | null;
  lowStockLevel?: number | null; salePriceMinor?: number | null; pricingMode?: 'per_piece' | 'by_weight';
  weightMg?: number | null; purity?: string | null; makingChargeMinor?: number | null;
  costPriceMinor?: number | null;
}

const toItem = (r: Record<string, unknown>): Item => ({
  id: String(r.id), workspaceId: String(r.workspace_id), locationId: String(r.location_id), name: String(r.name),
  altName: str(r.alt_name), notes: str(r.notes), valueEstimateMinor: r.value_estimate_minor == null ? null : num(r.value_estimate_minor),
  onHand: num(r.on_hand), reserved: num(r.reserved), createdAt: String(r.created_at), deletedAt: str(r.deleted_at),
  lowStockLevel: r.low_stock_level == null ? null : num(r.low_stock_level), salePriceMinor: r.sale_price_minor == null ? null : num(r.sale_price_minor),
  pricingMode: (r.pricing_mode as Item['pricingMode']) ?? 'per_piece', weightMg: r.weight_mg == null ? null : num(r.weight_mg),
  purity: str(r.purity), makingChargeMinor: r.making_charge_minor == null ? null : num(r.making_charge_minor),
  costPriceMinor: r.cost_price_minor == null ? null : num(r.cost_price_minor),
  productId: str(r.product_id), variantLabel: str(r.variant_label),
});

function wholeOrNull(v: number | null | undefined, field: string, min: number): number | null {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < min) throw new RangeError(`${field} must be a whole number of at least ${min}`);
  return v;
}

function money(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < 0) throw new RangeError('value must be a whole number of cents');
  return v;
}

export function addItem(ctx: Ctx, i: ItemInput): Item {
  const id = newId();
  const t = ctx.now();
  write(ctx, () => ctx.db.exec({
    sql: `INSERT INTO items (id,workspace_id,location_id,name,alt_name,notes,value_estimate_minor,low_stock_level,sale_price_minor,
            pricing_mode,weight_mg,purity,making_charge_minor,cost_price_minor,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM locations WHERE id=? AND workspace_id=? AND deleted_at IS NULL)`,
    bind: [id, i.workspaceId, i.locationId, requireText(i.name, 'name', 120), optionalText(i.altName, 'alt_name', 120),
      optionalText(i.notes, 'notes', 2000), money(i.valueEstimateMinor), wholeOrNull(i.lowStockLevel, 'low stock level', 0),
      money(i.salePriceMinor), i.pricingMode ?? 'per_piece', wholeOrNull(i.weightMg, 'weight', 1), optionalText(i.purity, 'purity', 20),
      money(i.makingChargeMinor), money(i.costPriceMinor), t, t, i.locationId, i.workspaceId],
  }));
  const item = getItem(ctx, id);
  if (!item) throw new Error('box not found in this workspace');
  return item;
}

export function getItem(ctx: Ctx, id: string): Item | undefined {
  const [r] = ctx.db.selectObjects(`SELECT * FROM items WHERE id=?`, [id]);
  return r ? toItem(r) : undefined;
}

export function listItems(ctx: Ctx, locationId: string): Item[] {
  return ctx.db.selectObjects(`SELECT * FROM items WHERE location_id=? AND deleted_at IS NULL ORDER BY created_at`, [locationId]).map(toItem);
}

export function updateItem(ctx: Ctx, id: string, i: Partial<Omit<ItemInput, 'workspaceId'>>): void {
  const cols: string[] = [];
  const bind: unknown[] = [];
  const set = (c: string, v: unknown) => { cols.push(`${c}=?`); bind.push(v); };
  if (i.name !== undefined) set('name', requireText(i.name, 'name', 120));
  if ('altName' in i) set('alt_name', optionalText(i.altName, 'alt_name', 120));
  if ('notes' in i) set('notes', optionalText(i.notes, 'notes', 2000));
  if ('valueEstimateMinor' in i) set('value_estimate_minor', money(i.valueEstimateMinor));
  if ('lowStockLevel' in i) set('low_stock_level', wholeOrNull(i.lowStockLevel, 'low stock level', 0));
  if ('salePriceMinor' in i) set('sale_price_minor', money(i.salePriceMinor));
  if (i.pricingMode) set('pricing_mode', i.pricingMode);
  if ('weightMg' in i) set('weight_mg', wholeOrNull(i.weightMg, 'weight', 1));
  if ('purity' in i) set('purity', optionalText(i.purity, 'purity', 20));
  if ('makingChargeMinor' in i) set('making_charge_minor', money(i.makingChargeMinor));
  if ('costPriceMinor' in i) set('cost_price_minor', money(i.costPriceMinor));
  if (i.locationId) {
    // Moving an item to another box of the same workspace.
    cols.push(`location_id=(SELECT id FROM locations WHERE id=? AND workspace_id=items.workspace_id AND deleted_at IS NULL)`);
    bind.push(i.locationId);
  }
  if (!cols.length) return;
  set('updated_at', ctx.now());
  write(ctx, () => ctx.db.exec({ sql: `UPDATE items SET ${cols.join(', ')} WHERE id=?`, bind: [...bind, id] }));
}

/** Items in an open order can't be binned: the order would be stuck (review finding 3). */
export function assertNotInOpenOrder(ctx: Ctx, where: string, bind: unknown[]): void {
  const n = ctx.db.selectValue(`SELECT count(*) FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN items i ON i.id = l.item_id WHERE o.status = 'open' AND ${where}`, bind);
  if (num(n) > 0) throw new Error('This is in an open order. Pack or cancel the order first.');
}

export function deleteItem(ctx: Ctx, id: string): void {
  const t = ctx.now();
  assertNotInOpenOrder(ctx, 'i.id = ?', [id]);
  write(ctx, () => {
    ctx.db.exec({ sql: `UPDATE photos SET deleted_at=?, updated_at=? WHERE item_id=? AND deleted_at IS NULL`, bind: [t, t, id] });
    ctx.db.exec({ sql: `UPDATE items SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`, bind: [t, t, id] });
  });
}

export function restoreItem(ctx: Ctx, id: string): void {
  const t = ctx.now();
  write(ctx, () => {
    const at = ctx.db.selectValue(`SELECT deleted_at FROM items WHERE id=?`, [id]);
    if (at == null) return;
    // Only into a live box.
    ctx.db.exec({ sql: `UPDATE items SET deleted_at=NULL, updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM locations WHERE id=items.location_id AND deleted_at IS NULL)`, bind: [t, id] });
    if (ctx.db.changes() === 0) return; // its box is binned: restore the box instead
    ctx.db.exec({ sql: `UPDATE photos SET deleted_at=NULL, updated_at=? WHERE item_id=? AND deleted_at=?`, bind: [t, id, at] });
  });
}

// Search --------------------------------------------------------------------------------------------

export interface SearchHit { itemId: string; itemName: string; boxId: string; boxNumber: number; boxName: string | null }

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** FTS5 trigram for 3+ characters (as one quoted phrase, so user text is never FTS syntax); LIKE below that. */
export function search(ctx: Ctx, workspaceId: string, query: string, limit = 100): SearchHit[] {
  const q = clean(query);
  if (!q) return [];
  const chars = [...q].length;
  const where = chars >= 3
    ? `item_search MATCH ?`
    : `(s.name LIKE ? ESCAPE '\\' OR s.alt_name LIKE ? ESCAPE '\\' OR s.location_label LIKE ? ESCAPE '\\')`;
  const bind = chars >= 3 ? [`"${q.replace(/"/g, '""')}"`] : Array(3).fill(`%${likeEscape(q)}%`);
  return ctx.db.selectObjects(
    `SELECT i.id, i.name || coalesce(' · ' || i.variant_label, '') AS name, l.id AS box_id, l.number, l.name AS box_name
       FROM item_search s JOIN items i ON i.id = s.item_id JOIN locations l ON l.id = i.location_id
      WHERE ${where} AND s.workspace_id = ? AND i.deleted_at IS NULL AND l.deleted_at IS NULL
      ORDER BY l.number, i.name LIMIT ?`,
    [...bind, workspaceId, limit],
  ).map((r) => ({ itemId: String(r.id), itemName: String(r.name), boxId: String(r.box_id), boxNumber: num(r.number), boxName: str(r.box_name) }));
}

// Counts for can() ----------------------------------------------------------------------------------

export function counts(ctx: Ctx, workspaceId: string): { boxes: number; items: number } {
  const [r] = ctx.db.selectObjects(
    `SELECT (SELECT count(*) FROM locations WHERE workspace_id=? AND deleted_at IS NULL) AS boxes,
            (SELECT count(*) FROM items WHERE workspace_id=? AND deleted_at IS NULL) AS items`, [workspaceId, workspaceId]);
  return { boxes: num(r!.boxes), items: num(r!.items) };
}

export function photosOnParent(ctx: Ctx, parent: { locationId?: string; itemId?: string }): number {
  return parent.locationId
    ? num(ctx.db.selectValue(`SELECT count(*) FROM photos WHERE location_id=? AND deleted_at IS NULL AND id NOT IN (SELECT photo_id FROM condition_photos)`, [parent.locationId]))
    : num(ctx.db.selectValue(`SELECT count(*) FROM photos WHERE item_id=? AND deleted_at IS NULL`, [parent.itemId]));
}
