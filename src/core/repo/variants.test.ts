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

describe('variants everywhere (review findings 4, 5)', () => {
  it('moving a variant keeps it a separate variant in the target box', () => {
    const ring = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Ring' });
    R.setVariantLabel(ctx, ring.id, 'Size 6');
    const s7 = R.addVariant(ctx, ring.id, 'Size 7');
    const box2 = R.createBox(ctx, ws.id, {});
    R.recordStock(ctx, ring.id, 'restock', 5);
    R.recordStock(ctx, s7.id, 'restock', 5);
    R.moveStock(ctx, s7.id, box2.id, 2);
    const moved6 = R.moveStock(ctx, ring.id, box2.id, 3);
    expect(moved6.variantLabel).toBe('Size 6');
    expect(moved6.productId).toBe(R.getItem(ctx, ring.id)!.productId);
    const inBox2 = R.listItems(ctx, box2.id).map((i) => [i.variantLabel, i.onHand]);
    expect(inBox2).toEqual([['Size 7', 2], ['Size 6', 3]]);
  });

  it('search, low stock and the catalogue show the variant name', () => {
    const ring = R.addItem(ctx, { workspaceId: ws.id, locationId: box.id, name: 'Ring', lowStockLevel: 5 });
    R.addVariant(ctx, ring.id, 'Size 7');
    expect(R.search(ctx, ws.id, 'Ring').map((h) => h.itemName).sort()).toEqual(['Ring', 'Ring · Size 7']);
    expect(R.lowStock(ctx, ws.id).map((l) => l.name).sort()).toEqual(['Ring', 'Ring · Size 7']);
    expect(R.catalogueCandidates(ctx, ws.id).map((c) => c.name)).toEqual(['Ring', 'Ring · Size 7']);
  });
});
