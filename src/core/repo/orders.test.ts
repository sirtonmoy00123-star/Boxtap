import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from '../db/testDb';
import type { SqlDb } from '../db/migrate';
import * as R from './index';
import { repairLedger } from '../db/ledgerCheck';

let db: TestDb;
let ctx: R.Ctx;
let ws: R.Workspace;
let ring: R.Item;
let chain: R.Item;

beforeEach(async () => {
  db = await openTestDb();
  ctx = { db: db as unknown as SqlDb, now: () => '2026-11-25T10:00:00.000Z' };
  ws = R.createWorkspace(ctx, { type: 'seller', name: 'Shop', country: 'BD', currency: 'BDT', language: 'bn' });
  const box = R.createBox(ctx, ws.id, {});
  ring = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Ring', salePriceMinor: 100000 });
  chain = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Chain', salePriceMinor: 50000 });
  R.recordStock(ctx, ring.id, 'restock', 5);
  R.recordStock(ctx, chain.id, 'restock', 5);
});

const stock = (id: string) => { const i = R.getItem(ctx, id)!; return [i.onHand, i.reserved]; };

describe('orders (Pro)', () => {
  it('numbers orders 1, 2, 3 and books stock for each line', () => {
    const o = R.createOrder(ctx, ws.id, { customer: 'Nusrat', phone: '01700000000' });
    expect(o.number).toBe(1);
    R.addOrderLine(ctx, o.id, ring.id, 2);
    R.addOrderLine(ctx, o.id, chain.id, 1);
    expect(stock(ring.id)).toEqual([5, 2]);
    const got = R.getOrder(ctx, o.id)!;
    expect(got.lines.map((l) => [l.name, l.qty])).toEqual([['Ring', 2], ['Chain', 1]]);
    expect(got.totalMinor).toBe(250000);
    expect(R.createOrder(ctx, ws.id, { customer: 'Raj' }).number).toBe(2);
  });

  it('cannot book more than is available', () => {
    const o = R.createOrder(ctx, ws.id, { customer: 'Nusrat' });
    expect(() => R.addOrderLine(ctx, o.id, ring.id, 6)).toThrow(R.NotEnoughStockError);
    expect(R.getOrder(ctx, o.id)!.lines).toEqual([]);
  });

  it('packing takes the stock out; delivered just marks it done', () => {
    const o = R.createOrder(ctx, ws.id, { customer: 'Nusrat' });
    R.addOrderLine(ctx, o.id, ring.id, 2);
    R.packOrder(ctx, o.id);
    expect(stock(ring.id)).toEqual([3, 0]);
    expect(R.getOrder(ctx, o.id)!.status).toBe('packed');
    R.deliverOrder(ctx, o.id);
    expect(R.getOrder(ctx, o.id)!.status).toBe('delivered');
    expect(R.salesReport(ctx, ws.id, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z').unitsSold).toBe(2);
  });

  it('cancelling an open order frees the booked stock', () => {
    const o = R.createOrder(ctx, ws.id, { customer: 'Nusrat' });
    R.addOrderLine(ctx, o.id, ring.id, 2);
    R.cancelOrder(ctx, o.id);
    expect(stock(ring.id)).toEqual([5, 0]);
    expect(R.getOrder(ctx, o.id)!.status).toBe('cancelled');
  });

  it('removing a line frees its stock; a packed order cannot change', () => {
    const o = R.createOrder(ctx, ws.id, { customer: 'Nusrat' });
    const line = R.addOrderLine(ctx, o.id, ring.id, 2);
    R.removeOrderLine(ctx, line.id);
    expect(stock(ring.id)).toEqual([5, 0]);
    R.addOrderLine(ctx, o.id, chain.id, 1);
    R.packOrder(ctx, o.id);
    expect(() => R.addOrderLine(ctx, o.id, ring.id, 1)).toThrow(/open/);
    expect(() => R.cancelOrder(ctx, o.id)).toThrow(/open/);
  });

  it('lists orders newest first, filtered by status', () => {
    const a = R.createOrder(ctx, ws.id, { customer: 'A' });
    R.createOrder(ctx, ws.id, { customer: 'B' });
    R.cancelOrder(ctx, a.id);
    expect(R.listOrders(ctx, ws.id).map((o) => o.customer)).toEqual(['B', 'A']);
    expect(R.listOrders(ctx, ws.id, 'open').map((o) => o.customer)).toEqual(['B']);
  });

  it('keeps the ledger consistent through the whole flow', () => {
    const o = R.createOrder(ctx, ws.id, { customer: 'Nusrat' });
    R.addOrderLine(ctx, o.id, ring.id, 2);
    R.packOrder(ctx, o.id);
    expect(repairLedger(ctx.db)).toBe(0);
  });

  it('needs a customer name', () => {
    expect(() => R.createOrder(ctx, ws.id, { customer: ' ' })).toThrow(/customer/);
  });
});
