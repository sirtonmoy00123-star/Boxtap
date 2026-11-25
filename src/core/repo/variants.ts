// Product variants (Pro). A product groups items that are the same thing in different sizes or colours; each
// variant is still its own stock item in one box (ADR-006), so the ledger and every stock rule stay the same.
import { type Ctx, newId, num, str, write, requireText } from './core';
import { addItem, getItem, type Item } from './items';

export interface VariantRow { itemId: string; name: string; variantLabel: string | null; onHand: number; reserved: number; boxId: string; boxNumber: number }

function ensureProduct(ctx: Ctx, it: Item): string {
  if (it.productId) return it.productId;
  const id = newId();
  const t = ctx.now();
  ctx.db.exec({ sql: `INSERT INTO products (id,workspace_id,name,created_at,updated_at) VALUES (?,?,?,?,?)`, bind: [id, it.workspaceId, it.name, t, t] });
  ctx.db.exec({ sql: `UPDATE items SET product_id=?, updated_at=? WHERE id=?`, bind: [id, t, it.id] });
  return id;
}

function labelTaken(ctx: Ctx, productId: string, label: string, exceptItem?: string): boolean {
  return !!ctx.db.selectValue(
    `SELECT 1 FROM items WHERE product_id=? AND deleted_at IS NULL AND lower(variant_label)=lower(?) AND id IS NOT ?`, [productId, label, exceptItem ?? null]);
}

/** Adds a new variant (e.g. "Size 7") of an item, in the same box unless another is given. Starts with 0 stock. */
export function addVariant(ctx: Ctx, itemId: string, label: string, boxId?: string): Item {
  const l = requireText(label, 'variant', 40);
  return write(ctx, () => {
    const it = getItem(ctx, itemId);
    if (!it || it.deletedAt) throw new Error('item not found');
    const productId = ensureProduct(ctx, it);
    if (labelTaken(ctx, productId, l)) throw new Error('this variant already exists');
    const copy = addItem(ctx, {
      workspaceId: it.workspaceId, locationId: boxId ?? it.locationId, name: it.name, altName: it.altName,
      salePriceMinor: it.salePriceMinor, costPriceMinor: it.costPriceMinor, lowStockLevel: it.lowStockLevel,
      pricingMode: it.pricingMode, weightMg: it.weightMg, purity: it.purity, makingChargeMinor: it.makingChargeMinor,
    });
    ctx.db.exec({ sql: `UPDATE items SET product_id=?, variant_label=? WHERE id=?`, bind: [productId, l, copy.id] });
    return getItem(ctx, copy.id)!;
  });
}

export function setVariantLabel(ctx: Ctx, itemId: string, label: string | null): void {
  const l = label == null || !label.trim() ? null : requireText(label, 'variant', 40);
  write(ctx, () => {
    const it = getItem(ctx, itemId);
    if (!it) throw new Error('item not found');
    if (l && it.productId && labelTaken(ctx, it.productId, l, it.id)) throw new Error('this variant already exists');
    ctx.db.exec({ sql: `UPDATE items SET variant_label=?, updated_at=? WHERE id=?`, bind: [l, ctx.now(), itemId] });
  });
}

/** All live variants of a product, original first. */
export function productVariants(ctx: Ctx, productId: string): VariantRow[] {
  return ctx.db.selectObjects(
    `SELECT i.id, i.name, i.variant_label, i.on_hand, i.reserved, l.id AS box_id, l.number
       FROM items i JOIN locations l ON l.id = i.location_id
      WHERE i.product_id=? AND i.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY i.created_at, i.rowid`, [productId])
    .map((r) => ({ itemId: String(r.id), name: String(r.name), variantLabel: str(r.variant_label), onHand: num(r.on_hand), reserved: num(r.reserved), boxId: String(r.box_id), boxNumber: num(r.number) }));
}
