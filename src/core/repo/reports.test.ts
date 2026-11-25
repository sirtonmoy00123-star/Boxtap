import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb } from '../db/testDb';
import type { SqlDb } from '../db/migrate';
import * as R from './index';

let clock: string;
let ctx: R.Ctx;
let ws: R.Workspace;
let box: R.Box;

beforeEach(async () => {
  const db = await openTestDb();
  clock = '2026-11-20T10:00:00.000Z';
  ctx = { db: db as unknown as SqlDb, now: () => clock };
  ws = R.createWorkspace(ctx, { type: 'seller', name: 'Shop', country: 'BD', currency: 'BDT', language: 'bn' });
  box = R.createBox(ctx, ws.id, {});
});

const item = (name: string, price: number, cost: number | null) =>
  R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name, salePriceMinor: price, costPriceMinor: cost });

describe('sale price and cost are kept on each sale', () => {
  it('a later price change does not rewrite past sales', () => {
    const ring = item('Ring', 100000, 60000);
    R.recordStock(ctx, ring.id, 'restock', 5);
    R.recordStock(ctx, ring.id, 'sold', 1);
    R.updateItem(ctx, ring.id, { salePriceMinor: 120000 });
    R.recordStock(ctx, ring.id, 'sold', 1);
    const r = R.salesReport(ctx, ws.id, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
    expect(r.revenueMinor).toBe(220000);
    expect(r.costMinor).toBe(120000);
    expect(r.profitMinor).toBe(100000);
    expect(r.unitsSold).toBe(2);
  });
});

describe('sales report (Pro)', () => {
  it('counts sales and packed bookings, nets out returns and undone sales, and stays inside the period', () => {
    const ring = item('Ring', 100000, 60000);
    const chain = item('Chain', 50000, null); // no cost: revenue counts, profit unknown for it
    R.recordStock(ctx, ring.id, 'restock', 10);
    R.recordStock(ctx, chain.id, 'restock', 10);
    R.recordStock(ctx, ring.id, 'sold', 2);
    const oops = R.recordStock(ctx, ring.id, 'sold', 1);
    R.undoStock(ctx, oops.id);
    R.recordStock(ctx, ring.id, 'returned', 1);
    R.recordStock(ctx, chain.id, 'booked', 3);
    R.recordStock(ctx, chain.id, 'shipped', 3);
    clock = '2026-12-05T10:00:00.000Z';
    R.recordStock(ctx, chain.id, 'sold', 1); // outside the period
    const r = R.salesReport(ctx, ws.id, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
    expect(r.unitsSold).toBe(4); // ring 2 - 1 returned + chain 3
    expect(r.revenueMinor).toBe(100000 + 150000);
    expect(r.costMinor).toBe(60000);
    expect(r.profitMinor).toBe(40000);
    expect(r.unitsWithoutCost).toBe(3);
    expect(r.bestSellers.map((b) => [b.name, b.units])).toEqual([['Chain', 3], ['Ring', 1]]);
  });

  it('reports stock value at cost and at sale price', () => {
    const ring = item('Ring', 100000, 60000);
    R.recordStock(ctx, ring.id, 'restock', 3);
    expect(R.stockValue(ctx, ws.id)).toEqual({ unitsInStock: 3, atCostMinor: 180000, atPriceMinor: 300000, unitsWithoutCost: 0 });
  });

  it('gives daily totals for a chart', () => {
    const ring = item('Ring', 1000, 500);
    R.recordStock(ctx, ring.id, 'restock', 10);
    R.recordStock(ctx, ring.id, 'sold', 1);
    clock = '2026-11-21T09:00:00.000Z';
    R.recordStock(ctx, ring.id, 'sold', 2);
    const r = R.salesReport(ctx, ws.id, '2026-11-20T00:00:00Z', '2026-11-22T00:00:00Z');
    expect(r.byDay).toEqual([
      { day: '2026-11-20', units: 1, revenueMinor: 1000 },
      { day: '2026-11-21', units: 2, revenueMinor: 2000 },
    ]);
  });
});
