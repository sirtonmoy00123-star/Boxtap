import { describe, it, expect, beforeEach } from 'vitest';
import { openTestDb } from '../db/testDb';
import type { SqlDb } from '../db/migrate';
import * as R from './index';

let ctx: R.Ctx;
let ws: R.Workspace;
let box: R.Box;
beforeEach(async () => {
  const db = await openTestDb();
  ctx = { db: db as unknown as SqlDb, now: () => '2026-11-25T10:00:00.000Z' };
  ws = R.createWorkspace(ctx, { type: 'seller', name: 'Shop', country: 'BD', currency: 'BDT', language: 'bn' });
  box = R.createBox(ctx, ws.id, {});
});

describe('product variants (Pro, ADR-006: each variant is its own stock item)', () => {
  it('adding a variant groups the original and the new item under one product', () => {
    const ring = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Gold ring', salePriceMinor: 100000 });
    const size7 = R.addVariant(ctx, ring.id, 'Size 7');
    const size8 = R.addVariant(ctx, ring.id, 'Size 8');
    const v = R.productVariants(ctx, R.getItem(ctx, ring.id)!.productId!);
    expect(v.map((x) => x.variantLabel)).toEqual([null, 'Size 7', 'Size 8']);
    expect(R.getItem(ctx, size7.id)!.name).toBe('Gold ring');
    expect(R.getItem(ctx, size8.id)!.salePriceMinor).toBe(100000);
    expect(R.getItem(ctx, size7.id)!.onHand).toBe(0);
  });

  it('each variant keeps its own stock, and the product shows the total', () => {
    const ring = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Gold ring' });
    R.setVariantLabel(ctx, ring.id, 'Size 6');
    const s7 = R.addVariant(ctx, ring.id, 'Size 7');
    R.recordStock(ctx, ring.id, 'restock', 2);
    R.recordStock(ctx, s7.id, 'restock', 3);
    const v = R.productVariants(ctx, R.getItem(ctx, ring.id)!.productId!);
    expect(v.map((x) => [x.variantLabel, x.onHand])).toEqual([['Size 6', 2], ['Size 7', 3]]);
    expect(v.reduce((s, x) => s + x.onHand, 0)).toBe(5);
  });

  it('a variant label must be short and not repeat inside the product', () => {
    const ring = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Gold ring' });
    R.addVariant(ctx, ring.id, 'Size 7');
    expect(() => R.addVariant(ctx, ring.id, 'size 7')).toThrow(/already/);
    expect(() => R.addVariant(ctx, ring.id, 'x'.repeat(41))).toThrow();
  });

  it('variant labels are found by search', () => {
    const ring = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Gold ring' });
    R.addVariant(ctx, ring.id, 'Size 7');
    expect(R.search(ctx, ws.id, 'size 7').length).toBe(1);
  });
});
