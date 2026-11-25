// Customer orders (Pro). An order line books stock ('booked' movement); packing ships every line ('shipped',
// which takes it out of stock and counts as a sale); cancelling an open order frees it ('unbooked').
import { type Ctx, newId, num, optionalText, requireText, str, write } from './core';
import { recordStock } from './stock';

export type OrderStatus = 'open' | 'packed' | 'delivered' | 'cancelled';
export interface OrderLine { id: string; itemId: string; name: string; qty: number; unitPriceMinor: number | null }
export interface Order {
  id: string; number: number; customer: string; phone: string | null; note: string | null; status: OrderStatus;
  createdAt: string; lines: OrderLine[]; totalMinor: number;
}

function orderRow(ctx: Ctx, id: string) {
  const [r] = ctx.db.selectObjects(`SELECT * FROM orders WHERE id=?`, [id]);
  if (!r) throw new Error('order not found');
  return r;
}
const requireOpen = (r: Record<string, unknown>) => { if (r.status !== 'open') throw new Error('only an open order can be changed'); };

export function createOrder(ctx: Ctx, workspaceId: string, o: { customer: string; phone?: string | null; note?: string | null }): Order {
  const id = newId();
  const t = ctx.now();
  write(ctx, () => ctx.db.exec({
    sql: `INSERT INTO orders (id,workspace_id,number,customer,phone,note,created_at,updated_at)
          VALUES (?,?,(SELECT coalesce(max(number),0)+1 FROM orders WHERE workspace_id=?),?,?,?,?,?)`,
    bind: [id, workspaceId, workspaceId, requireText(o.customer, 'customer', 80), optionalText(o.phone, 'phone', 30), optionalText(o.note, 'note', 500), t, t],
  }));
  return getOrder(ctx, id)!;
}

export function getOrder(ctx: Ctx, id: string): Order | undefined {
  const [r] = ctx.db.selectObjects(`SELECT * FROM orders WHERE id=?`, [id]);
  if (!r) return undefined;
  const lines = ctx.db.selectObjects(
    `SELECT l.id, l.item_id, i.name, l.qty, l.unit_price_minor FROM order_lines l JOIN items i ON i.id = l.item_id
      WHERE l.order_id=? ORDER BY l.created_at, l.rowid`, [id])
    .map((x) => ({ id: String(x.id), itemId: String(x.item_id), name: String(x.name), qty: num(x.qty), unitPriceMinor: x.unit_price_minor == null ? null : num(x.unit_price_minor) }));
  return {
    id: String(r.id), number: num(r.number), customer: String(r.customer), phone: str(r.phone), note: str(r.note),
    status: r.status as OrderStatus, createdAt: String(r.created_at), lines,
    totalMinor: lines.reduce((s, l) => s + l.qty * (l.unitPriceMinor ?? 0), 0),
  };
}

export function listOrders(ctx: Ctx, workspaceId: string, status?: OrderStatus): Order[] {
  return ctx.db.selectValues(
    `SELECT id FROM orders WHERE workspace_id=? AND (? IS NULL OR status=?) ORDER BY number DESC`, [workspaceId, status ?? null, status ?? null])
    .map((id) => getOrder(ctx, String(id))!);
}

/** Books the stock and adds the line, in one transaction. */
export function addOrderLine(ctx: Ctx, orderId: string, itemId: string, qty: number): OrderLine {
  return write(ctx, () => {
    requireOpen(orderRow(ctx, orderId));
    const id = newId();
    recordStock(ctx, itemId, 'booked', qty, { orderLineId: id });
    ctx.db.exec({
      sql: `INSERT INTO order_lines (id,order_id,item_id,qty,unit_price_minor,created_at) VALUES (?,?,?,?,(SELECT sale_price_minor FROM items WHERE id=?),?)`,
      bind: [id, orderId, itemId, qty, itemId, ctx.now()],
    });
    return getOrder(ctx, orderId)!.lines.find((l) => l.id === id)!;
  });
}

export function removeOrderLine(ctx: Ctx, lineId: string): void {
  write(ctx, () => {
    const [l] = ctx.db.selectObjects(`SELECT * FROM order_lines WHERE id=?`, [lineId]);
    if (!l) return;
    requireOpen(orderRow(ctx, String(l.order_id)));
    recordStock(ctx, String(l.item_id), 'unbooked', num(l.qty), { orderLineId: lineId });
    ctx.db.exec({ sql: `DELETE FROM order_lines WHERE id=?`, bind: [lineId] });
  });
}

function setStatus(ctx: Ctx, orderId: string, status: OrderStatus) {
  ctx.db.exec({ sql: `UPDATE orders SET status=?, updated_at=? WHERE id=?`, bind: [status, ctx.now(), orderId] });
}
const linesOf = (ctx: Ctx, orderId: string) => ctx.db.selectObjects(`SELECT id, item_id, qty FROM order_lines WHERE order_id=?`, [orderId]);

export function packOrder(ctx: Ctx, orderId: string): void {
  write(ctx, () => {
    requireOpen(orderRow(ctx, orderId));
    for (const l of linesOf(ctx, orderId)) recordStock(ctx, String(l.item_id), 'shipped', num(l.qty), { orderLineId: String(l.id) });
    setStatus(ctx, orderId, 'packed');
  });
}

export function deliverOrder(ctx: Ctx, orderId: string): void {
  write(ctx, () => {
    if (orderRow(ctx, orderId).status !== 'packed') throw new Error('pack the order first');
    setStatus(ctx, orderId, 'delivered');
  });
}

export function cancelOrder(ctx: Ctx, orderId: string): void {
  write(ctx, () => {
    requireOpen(orderRow(ctx, orderId));
    for (const l of linesOf(ctx, orderId)) recordStock(ctx, String(l.item_id), 'unbooked', num(l.qty), { orderLineId: String(l.id) });
    setStatus(ctx, orderId, 'cancelled');
  });
}
