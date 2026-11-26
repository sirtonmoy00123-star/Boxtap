// Pro reports (Phase 3): sales, revenue, cost and profit for a period, best sellers, daily totals and stock value.
// A sale is a 'sold' or 'shipped' (booked → packed) movement; 'returned' takes one back; an undo reverses whichever
// of these it undoes. Prices and costs come from the movement itself (kept at the time of the sale, v2).
import { type Ctx, num } from './core';
import type { Sheet } from '../xlsx/xlsx';

export interface SalesReport {
  unitsSold: number;
  revenueMinor: number;
  costMinor: number;
  profitMinor: number;
  /** Units sold whose item had no cost price: their profit is unknown and left out of profit. */
  unitsWithoutCost: number;
  bestSellers: { itemId: string; name: string; units: number; revenueMinor: number }[];
  byDay: { day: string; units: number; revenueMinor: number }[];
}

// Each row: units sold it adds (negative for returns and undone sales), with its price and cost.
const SALES = `
  SELECT m.item_id, m.happened_at,
         -m.on_hand_delta AS units,
         m.unit_price_minor AS price, m.unit_cost_minor AS cost
    FROM stock_movements m
    LEFT JOIN stock_movements o ON o.id = m.reverses_id
   WHERE m.workspace_id = ? AND m.happened_at >= ? AND m.happened_at < ?
     AND (m.reason IN ('sold','shipped','returned') OR (m.reason = 'undo' AND o.reason IN ('sold','shipped','returned')))`;

/** tzOffsetMinutes: the phone's offset from UTC (east positive), so days are the seller's own days (review finding 11). */
export function salesReport(ctx: Ctx, workspaceId: string, fromIso: string, toIso: string, tzOffsetMinutes = 0): SalesReport {
  const bind = [workspaceId, fromIso, toIso];
  const [t] = ctx.db.selectObjects(
    `SELECT coalesce(sum(units),0) AS units, coalesce(sum(units * coalesce(price,0)),0) AS revenue,
            coalesce(sum(CASE WHEN cost IS NOT NULL THEN units * cost END),0) AS cost,
            coalesce(sum(CASE WHEN cost IS NOT NULL THEN units * (coalesce(price,0) - cost) END),0) AS profit,
            coalesce(sum(CASE WHEN cost IS NULL THEN units END),0) AS no_cost
       FROM (${SALES})`, bind);
  const best = ctx.db.selectObjects(
    `SELECT s.item_id, i.name || coalesce(' · ' || i.variant_label, '') AS name, sum(s.units) AS units, sum(s.units * coalesce(s.price,0)) AS revenue
       FROM (${SALES}) s JOIN items i ON i.id = s.item_id
      GROUP BY s.item_id HAVING sum(s.units) > 0 ORDER BY units DESC, revenue DESC, i.name LIMIT 10`, bind);
  const days = ctx.db.selectObjects(
    `SELECT date(happened_at, ? || ' minutes') AS day, sum(units) AS units, sum(units * coalesce(price,0)) AS revenue
       FROM (${SALES}) GROUP BY day ORDER BY day`, [(tzOffsetMinutes >= 0 ? '+' : '') + Math.round(tzOffsetMinutes), ...bind]);
  return {
    unitsSold: num(t!.units), revenueMinor: num(t!.revenue), costMinor: num(t!.cost), profitMinor: num(t!.profit),
    unitsWithoutCost: num(t!.no_cost),
    bestSellers: best.map((r) => ({ itemId: String(r.item_id), name: String(r.name), units: num(r.units), revenueMinor: num(r.revenue) })),
    byDay: days.map((r) => ({ day: String(r.day), units: num(r.units), revenueMinor: num(r.revenue) })),
  };
}

export interface StockValue { unitsInStock: number; atCostMinor: number; atPriceMinor: number; unitsWithoutCost: number }

export function stockValue(ctx: Ctx, workspaceId: string): StockValue {
  const [r] = ctx.db.selectObjects(
    `SELECT coalesce(sum(i.on_hand),0) AS units,
            coalesce(sum(CASE WHEN i.cost_price_minor IS NOT NULL THEN i.on_hand * i.cost_price_minor END),0) AS at_cost,
            coalesce(sum(CASE WHEN i.sale_price_minor IS NOT NULL THEN i.on_hand * i.sale_price_minor END),0) AS at_price,
            coalesce(sum(CASE WHEN i.cost_price_minor IS NULL THEN i.on_hand END),0) AS no_cost
       FROM items i JOIN locations l ON l.id = i.location_id
      WHERE i.workspace_id = ? AND i.deleted_at IS NULL AND l.deleted_at IS NULL AND i.on_hand > 0`, [workspaceId]);
  return { unitsInStock: num(r!.units), atCostMinor: num(r!.at_cost), atPriceMinor: num(r!.at_price), unitsWithoutCost: num(r!.no_cost) };
}

// ---------------------------------------------------------------------------------------------------------------
// Excel export (Pro): plain sheets of the shop's data. Money in taka or dollars (not paisa/cents).


const major = (minor: unknown) => (minor == null ? null : num(minor) / 100);
const localDay = (iso: unknown, tz: number) => new Date(Date.parse(String(iso)) + tz * 60_000).toISOString().slice(0, 10);
const REASON_LABEL: Record<string, string> = { sold: 'Sold', shipped: 'Packed (order)', returned: 'Returned', undo: 'Undo' };

export function excelWorkbook(ctx: Ctx, workspaceId: string, fromIso: string, toIso: string, tzOffsetMinutes = 0): Sheet[] {
  const items = ctx.db.selectObjects(
    `SELECT l.number, l.name AS box_name, i.name, i.variant_label, i.alt_name, i.on_hand, i.reserved,
            i.sale_price_minor, i.cost_price_minor, i.low_stock_level
       FROM items i JOIN locations l ON l.id = i.location_id
      WHERE i.workspace_id = ? AND i.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY l.number, i.created_at`, [workspaceId]);
  const itemRows = items.map((r) => [
    num(r.number), (r.box_name as string | null) ?? null, String(r.name), (r.variant_label as string | null) ?? null, (r.alt_name as string | null) ?? null,
    num(r.on_hand) - num(r.reserved), num(r.reserved), major(r.sale_price_minor), major(r.cost_price_minor),
    r.cost_price_minor == null ? null : (num(r.on_hand) * num(r.cost_price_minor)) / 100,
    r.low_stock_level == null ? null : num(r.low_stock_level),
  ]);

  const sales = ctx.db.selectObjects(
    `SELECT s.happened_at, i.name || coalesce(' · ' || i.variant_label, '') AS name, m.reason, s.units, s.price, s.cost
       FROM (${SALES.replace('SELECT m.item_id, m.happened_at,', 'SELECT m.id, m.item_id, m.happened_at,')}) s
       JOIN stock_movements m ON m.id = s.id JOIN items i ON i.id = s.item_id
      ORDER BY s.happened_at`, [workspaceId, fromIso, toIso]);
  const saleRows = sales.map((r) => {
    const units = num(r.units);
    const price = major(r.price);
    const cost = major(r.cost);
    return [localDay(r.happened_at, tzOffsetMinutes), String(r.name), REASON_LABEL[String(r.reason)] ?? String(r.reason), units, price,
      price == null ? null : Math.round(units * price * 100) / 100, cost, price == null || cost == null ? null : Math.round(units * (price - cost) * 100) / 100];
  });

  const orders = ctx.db.selectObjects(`SELECT id, number, customer, phone, status, created_at FROM orders WHERE workspace_id=? ORDER BY number`, [workspaceId]);
  const orderRows = orders.map((o) => {
    const lines = ctx.db.selectObjects(
      `SELECT l.qty, l.unit_price_minor, i.name || coalesce(' · ' || i.variant_label, '') AS name FROM order_lines l JOIN items i ON i.id = l.item_id WHERE l.order_id=? ORDER BY l.created_at`, [String(o.id)]);
    const total = lines.reduce((s, l) => s + num(l.qty) * num(l.unit_price_minor ?? 0), 0);
    return [num(o.number), String(o.customer), (o.phone as string | null) ?? null, String(o.status), localDay(o.created_at, tzOffsetMinutes),
      lines.map((l) => `${num(l.qty)} × ${String(l.name)}`).join(', '), total / 100];
  });

  return [
    { name: 'Items', widths: [6, 16, 28, 12, 18, 10, 9, 11, 11, 13, 14],
      rows: [['Box', 'Box name', 'Item', 'Variant', 'Other name', 'In stock', 'Booked', 'Sale price', 'Cost price', 'Value at cost', 'Low-stock level'], ...itemRows] },
    { name: 'Sales', widths: [12, 28, 16, 8, 11, 11, 11, 11],
      rows: [['Date', 'Item', 'Type', 'Units', 'Unit price', 'Sales', 'Unit cost', 'Profit'], ...saleRows] },
    { name: 'Orders', widths: [8, 22, 14, 11, 12, 40, 11],
      rows: [['Order', 'Customer', 'Phone', 'Status', 'Date', 'Items', 'Total'], ...orderRows] },
  ];
}
