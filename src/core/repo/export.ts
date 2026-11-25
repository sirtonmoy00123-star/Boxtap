// CSV export (C-13, always free, never blocked), move-status summary (arrival check) and Erase all data.
import { type Ctx, num, str, write } from './core';

const cell = (raw: string | null | undefined): string => {
  if (raw == null) return '';
  // Neutralise spreadsheet formulas (= + - @ tab CR at the start), then quote when needed.
  const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const money = (minor: unknown) => (minor == null ? '' : (num(minor) / 100).toFixed(2));
const yesNo = (v: unknown) => (num(v) ? 'yes' : 'no');

/** One row per live item; boxes with no items get one row too. UTF-8 with a BOM so Excel shows Bangla. */
export function exportCsv(ctx: Ctx, workspaceId: string): string {
  const rows = ctx.db.selectObjects(
    `SELECT l.number, l.name AS box_name, r.name AS room, l.spot, l.is_fragile, l.open_first, l.move_status,
            i.name AS item, i.alt_name, i.notes, i.value_estimate_minor
       FROM locations l
       LEFT JOIN rooms r ON r.id = l.room_id AND r.deleted_at IS NULL
       LEFT JOIN items i ON i.location_id = l.id AND i.deleted_at IS NULL
      WHERE l.workspace_id = ? AND l.deleted_at IS NULL
      ORDER BY l.number, i.created_at`, [workspaceId]);
  const header = 'box_number,box_name,room,where,fragile,open_first,move_status,item,alt_name,notes,value';
  const lines = rows.map((r) => [
    String(num(r.number)), cell(str(r.box_name)), cell(str(r.room)), cell(str(r.spot)), yesNo(r.is_fragile), yesNo(r.open_first),
    cell(str(r.move_status)), cell(str(r.item)), cell(str(r.alt_name)), cell(str(r.notes)), money(r.value_estimate_minor),
  ].join(','));
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}

export interface MoveSummary { total: number; packed: number; moved: number; unpacked: number; none: number }

export function moveSummary(ctx: Ctx, workspaceId: string): MoveSummary {
  const [r] = ctx.db.selectObjects(
    `SELECT count(*) AS total,
            sum(move_status = 'packed') AS packed, sum(move_status = 'moved') AS moved,
            sum(move_status = 'unpacked') AS unpacked, sum(move_status IS NULL) AS none
       FROM locations WHERE workspace_id = ? AND deleted_at IS NULL`, [workspaceId]);
  return { total: num(r!.total), packed: num(r!.packed ?? 0), moved: num(r!.moved ?? 0), unpacked: num(r!.unpacked ?? 0), none: num(r!.none ?? 0) };
}

/**
 * Settings → Erase all data (DATABASE_SCHEMA §6). Every workspace is soft-deleted first so the cascade may remove
 * its ledger (audit B8). Licence keys, the Drive link and the backup key reference go too; the anti-rollback
 * clock (time_guard) and the signed config stay. Returns the photo files the caller must delete.
 */
export function eraseAll(ctx: Ctx): string[] {
  const files = ctx.db.selectObjects(`SELECT file_name, thumb_name FROM photos`).flatMap((r) => [String(r.file_name), String(r.thumb_name)]);
  write(ctx, () => {
    ctx.db.exec({ sql: `UPDATE workspaces SET deleted_at = coalesce(deleted_at, ?)`, bind: [ctx.now()] });
    ctx.db.exec(`DELETE FROM workspaces`);
    ctx.db.exec(`DELETE FROM drive_link; DELETE FROM drive_outbox; DELETE FROM entitlements; DELETE FROM backup_state;`);
    ctx.db.exec(`DELETE FROM meta WHERE key = 'backup_key'`);
  });
  return files;
}
