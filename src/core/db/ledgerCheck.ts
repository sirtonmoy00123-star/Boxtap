// Ledger self-check (DATABASE_SCHEMA §5 step 2, audit L5): the ledger is the truth; the cached totals on
// items are repaired from it. This file and schema.ts are the only places allowed to write the totals.
import type { SqlDb } from './migrate';

const MISMATCH = `
  SELECT i.id FROM items i
   LEFT JOIN (SELECT item_id, sum(on_hand_delta) AS oh, sum(reserved_delta) AS rs FROM stock_movements GROUP BY item_id) m
     ON m.item_id = i.id
  WHERE i.on_hand <> coalesce(m.oh, 0) OR i.reserved <> coalesce(m.rs, 0)`;

/** Returns how many items were repaired (0 = ledger and totals agree). */
export function repairLedger(db: SqlDb): number {
  const bad = db.selectValues(MISMATCH);
  if (!bad.length) return 0;
  db.exec(`UPDATE items SET
      on_hand  = (SELECT coalesce(sum(on_hand_delta), 0) FROM stock_movements WHERE item_id = items.id),
      reserved = (SELECT coalesce(sum(reserved_delta), 0) FROM stock_movements WHERE item_id = items.id)
    WHERE id IN (${MISMATCH})`);
  return bad.length;
}
