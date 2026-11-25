import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb, type TestDb } from '../db/testDb';
import type { SqlDb } from '../db/migrate';
import * as R from './index';
import { repairLedger } from '../db/ledgerCheck';

let db: TestDb;
let clock: string;
let ctx: R.Ctx;
let ws: R.Workspace;
let box: R.Box;
let item: R.Item;

beforeEach(async () => {
  db = await openTestDb();
  clock = '2026-11-25T10:00:00.000Z';
  ctx = { db: db as unknown as SqlDb, now: () => clock };
  ws = R.createWorkspace(ctx, { type: 'seller', name: 'Shop', country: 'BD', currency: 'BDT', language: 'bn' });
  box = R.createBox(ctx, ws.id, {});
  item = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Gold ring' });
});

const stock = () => { const i = R.getItem(ctx, item.id)!; return { onHand: i.onHand, reserved: i.reserved, available: i.onHand - i.reserved }; };

describe('stock ledger (ADR-004, S-01..S-07)', () => {
  it('restock and sell change on-hand through the ledger', () => {
    R.recordStock(ctx, item.id, 'restock', 10);
    R.recordStock(ctx, item.id, 'sold', 3);
    expect(stock()).toEqual({ onHand: 7, reserved: 0, available: 7 });
    expect(R.itemHistory(ctx, item.id).map((m) => [m.reason, m.onHandDelta])).toEqual([['sold', -3], ['restock', 10]]);
  });

  it('selling more than is in stock is refused unless the seller confirms (DATABASE_SCHEMA §4)', () => {
    R.recordStock(ctx, item.id, 'restock', 1);
    expect(() => R.recordStock(ctx, item.id, 'sold', 2)).toThrow(R.NotEnoughStockError);
    R.recordStock(ctx, item.id, 'sold', 2, { allowNegative: true });
    expect(stock().onHand).toBe(-1);
  });

  it('booked then packed: on-hand and reserved both drop (critical test 20)', () => {
    R.recordStock(ctx, item.id, 'restock', 5);
    R.recordStock(ctx, item.id, 'booked', 2);
    expect(stock()).toEqual({ onHand: 5, reserved: 2, available: 3 });
    R.recordStock(ctx, item.id, 'shipped', 2);
    expect(stock()).toEqual({ onHand: 3, reserved: 0, available: 3 });
  });

  it('booked then cancelled frees the stock again', () => {
    R.recordStock(ctx, item.id, 'restock', 5);
    R.recordStock(ctx, item.id, 'booked', 2);
    R.recordStock(ctx, item.id, 'unbooked', 2);
    expect(stock()).toEqual({ onHand: 5, reserved: 0, available: 5 });
  });

  it('cannot book more than is available, or ship/cancel more than is booked', () => {
    R.recordStock(ctx, item.id, 'restock', 2);
    expect(() => R.recordStock(ctx, item.id, 'booked', 3)).toThrow(R.NotEnoughStockError);
    R.recordStock(ctx, item.id, 'booked', 1);
    expect(() => R.recordStock(ctx, item.id, 'shipped', 2)).toThrow(R.NotEnoughStockError);
    expect(() => R.recordStock(ctx, item.id, 'unbooked', 2)).toThrow(R.NotEnoughStockError);
  });

  it('undo works within 24 hours, once, with exact negative deltas (critical test 19)', () => {
    R.recordStock(ctx, item.id, 'restock', 5);
    const sale = R.recordStock(ctx, item.id, 'sold', 1);
    R.undoStock(ctx, sale.id);
    expect(stock().onHand).toBe(5);
    expect(() => R.undoStock(ctx, sale.id)).toThrow(/already/);
    const later = R.recordStock(ctx, item.id, 'sold', 1);
    clock = '2026-11-26T10:00:01.000Z';
    expect(() => R.undoStock(ctx, later.id)).toThrow(/24 hours/);
  });

  it('an undo cannot itself be undone', () => {
    R.recordStock(ctx, item.id, 'restock', 5);
    const u = R.undoStock(ctx, R.recordStock(ctx, item.id, 'sold', 1).id);
    expect(() => R.undoStock(ctx, u.id)).toThrow();
  });

  it('count mode writes one count movement per changed item (S-07)', () => {
    const other = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Chain' });
    R.recordStock(ctx, item.id, 'restock', 5);
    R.recordStock(ctx, other.id, 'restock', 2);
    const changed = R.countBox(ctx, box.id, { [item.id]: 4, [other.id]: 2 });
    expect(changed).toBe(1);
    expect(stock().onHand).toBe(4);
    expect(R.itemHistory(ctx, item.id)[0]!.reason).toBe('count');
  });

  it('move 3 of 10 to another box: source 7, target 3, two ledger rows (critical test 21)', () => {
    R.recordStock(ctx, item.id, 'restock', 10);
    const box2 = R.createBox(ctx, ws.id, {});
    const target = R.moveStock(ctx, item.id, box2.id, 3);
    expect(stock().onHand).toBe(7);
    expect(R.getItem(ctx, target.id)!.onHand).toBe(3);
    expect(R.getItem(ctx, target.id)!.name).toBe('Gold ring');
    expect(db.selectValue(`SELECT count(*) FROM stock_movements WHERE reason IN ('moved_out','moved_in')`)).toBe(2);
    // a second move reuses the same target item
    expect(R.moveStock(ctx, item.id, box2.id, 2).id).toBe(target.id);
    expect(R.getItem(ctx, target.id)!.onHand).toBe(5);
  });

  it('cannot move more than is available', () => {
    R.recordStock(ctx, item.id, 'restock', 2);
    const box2 = R.createBox(ctx, ws.id, {});
    expect(() => R.moveStock(ctx, item.id, box2.id, 3)).toThrow(R.NotEnoughStockError);
  });

  it('a failed movement leaves nothing half-done; the ledger check stays clean (critical test 22)', () => {
    R.recordStock(ctx, item.id, 'restock', 2);
    expect(() => R.moveStock(ctx, item.id, 'no-such-box', 1)).toThrow();
    expect(stock().onHand).toBe(2);
    expect(repairLedger(ctx.db)).toBe(0);
  });

  it('rejects zero, negative or fractional quantities', () => {
    for (const q of [0, -1, 1.5]) expect(() => R.recordStock(ctx, item.id, 'restock', q)).toThrow(RangeError);
  });

  it('lists low-stock items: at or below their level, by available stock (S-21)', () => {
    const chain = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Chain' });
    R.updateItem(ctx, item.id, { lowStockLevel: 2 });
    R.updateItem(ctx, chain.id, { lowStockLevel: 2 });
    R.recordStock(ctx, item.id, 'restock', 3);
    R.recordStock(ctx, item.id, 'booked', 1); // available 2 -> low
    R.recordStock(ctx, chain.id, 'restock', 5);
    expect(R.lowStock(ctx, ws.id).map((x) => x.name)).toEqual(['Gold ring']);
  });
});
