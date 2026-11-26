// The app's data API, run inside the database worker. Screens call this (through the worker client),
// never SQL. Every premium write goes through can() here (ARCHITECTURE §3 rules).
import * as R from '../repo';
import type { Ctx } from '../repo';
import { can, DEFAULT_CONFIG, type BlockReason, type Feature } from '../licensing/can';
import type { ConfigBody } from '../licensing/config';
import type { Plan } from '../licensing/licence';
import type { LinkState } from '../drive/sync';
import { repairLedger } from '../db/ledgerCheck';

export type SettingKey = 'backup_key';

export class BlockedError extends Error {
  constructor(public readonly reason: BlockReason) {
    super(`blocked:${reason}`);
    this.name = 'BlockedError';
  }
}

/** Licensing state the gate needs. Phase 1b fills plans from verified licence keys and the signed config. */
export interface Entitlement { config: ConfigBody; plans: ReadonlySet<Plan> }

export function createService(ctx: Ctx, entitlement: () => Entitlement = () => ({ config: DEFAULT_CONFIG, plans: new Set() })) {
  const gate = (feature: Feature, workspaceId: string, photosOnParent = 0) => {
    const ws = R.getWorkspace(ctx, workspaceId);
    if (!ws) throw new Error('workspace not found');
    const e = entitlement();
    const activeJobs = ws.type === 'removalist' ? R.activeJobCount(ctx, workspaceId) : 0;
    const r = can(feature, { config: e.config, plans: e.plans, workspaceType: ws.type, counts: { ...R.counts(ctx, workspaceId), photosOnParent, activeJobs } });
    if (!r.allowed) throw new BlockedError(r.reason);
  };

  return {
    // Workspaces and rooms
    createWorkspace: (w: Parameters<typeof R.createWorkspace>[1]) => R.createWorkspace(ctx, w),
    listWorkspaces: () => R.listWorkspaces(ctx),
    getWorkspace: (id: string) => R.getWorkspace(ctx, id),
    renameWorkspace: (id: string, name: string) => R.renameWorkspace(ctx, id, name),
    setWorkspaceLanguage: (id: string, language: 'en' | 'bn') => {
      ctx.db.exec({ sql: 'UPDATE workspaces SET language=?, updated_at=? WHERE id=?', bind: [language, ctx.now(), id] });
    },
    createRoom: (wsId: string, name: string, colour?: string) => R.createRoom(ctx, wsId, name, colour),
    listRooms: (wsId: string) => R.listRooms(ctx, wsId),
    renameRoom: (id: string, name: string) => R.renameRoom(ctx, id, name),
    deleteRoom: (id: string) => R.deleteRoom(ctx, id),

    // Removalist (plan §4-§7). Reading, search, restore from the Bin and archive are never gated.
    createRemovalistWorkspace: (s: R.RemovalistSetup) => R.createRemovalistWorkspace(ctx, s),
    getBusinessProfile: (wsId: string) => R.getBusinessProfile(ctx, wsId),
    updateBusinessProfile: (wsId: string, p: Parameters<typeof R.updateBusinessProfile>[2]) => R.updateBusinessProfile(ctx, wsId, p),
    listTrucks: (wsId: string) => R.listTrucks(ctx, wsId),
    addTruck: (wsId: string, tr: R.TruckInput) => R.addTruck(ctx, wsId, tr),
    updateTruck: (id: string, tr: R.TruckInput) => R.updateTruck(ctx, id, tr),
    deleteTruck: (id: string) => R.deleteTruck(ctx, id),
    listVolumeCatalogue: (wsId: string) => R.listVolumeCatalogue(ctx, wsId),
    createJob: (wsId: string, j: R.JobInput) => { gate('add_job', wsId); return R.createJob(ctx, wsId, j); },
    getJob: (id: string) => R.getJobRow(ctx, id),
    listJobs: (wsId: string, opts: Parameters<typeof R.listJobs>[2]) => R.listJobs(ctx, wsId, opts),
    updateJob: (id: string, j: R.JobInput) => R.updateJob(ctx, id, j),
    setJobStatus: (id: string, status: R.JobStatus) => R.setJobStatus(ctx, id, status),
    binJob: (id: string) => R.binJob(ctx, id),
    restoreJob: (id: string) => R.restoreJob(ctx, id),
    archiveJob: (id: string, archived: boolean) => R.archiveJob(ctx, id, archived),
    // Phase 2: boxes and furniture pieces in a job, its rooms, its labels. Removalist has no box limit (can()).
    addJobBox: (jobId: string, b?: R.JobBoxInput) => { const j = R.getJob(ctx, jobId); if (!j) throw new Error('job not found'); gate('add_box', j.workspaceId); return R.addJobBox(ctx, jobId, b); },
    quickAddBoxes: (jobId: string, n = 10) => { const j = R.getJob(ctx, jobId); if (!j) throw new Error('job not found'); gate('add_box', j.workspaceId); return R.quickAddBoxes(ctx, jobId, n); },
    getJobPiece: (id: string) => R.getJobPiece(ctx, id),
    listJobPieces: (jobId: string) => R.listJobPieces(ctx, jobId),
    setPieceVolumeItem: (boxId: string, volumeItemId: string | null) => R.setPieceVolumeItem(ctx, boxId, volumeItemId),
    listJobRooms: (jobId: string) => R.listJobRooms(ctx, jobId),
    createJobRoom: (jobId: string, name: string) => R.createJobRoom(ctx, jobId, name),
    setPieceRoom: (boxId: string, roomId: string | null) => R.setPieceRoom(ctx, boxId, roomId),
    jobLabels: (jobId: string, ids?: string[]) => R.jobLabels(ctx, jobId, ids),
    markJobLabelsPrinted: (jobId: string) => R.markJobLabelsPrinted(ctx, jobId),
    jobLabelsStatus: (jobId: string) => R.jobLabelsStatus(ctx, jobId),
    /** The logo for labels: only with Removalist Pro (logo_branding). */
    // Phase 3: load and unload check. Never gated (plan §7).
    recordScan: (jobId: string, d: R.Direction, code: string) => R.recordScan(ctx, jobId, d, code),
    manualTick: (jobId: string, d: R.Direction, boxId: string) => R.manualTick(ctx, jobId, d, boxId),
    checkState: (jobId: string, d: R.Direction) => R.checkState(ctx, jobId, d),
    finishCheck: (jobId: string, d: R.Direction, reasons: Parameters<typeof R.finishCheck>[3]) => R.finishCheck(ctx, jobId, d, reasons),
    checkCounts: (jobId: string) => R.checkCounts(ctx, jobId),
    labelLogo: (wsId: string) => { try { gate('logo_branding', wsId); } catch { return null; } return R.getBusinessLogo(ctx, wsId); },

    // Boxes and labels
    createBox: (wsId: string, b: R.BoxInput) => { gate('add_box', wsId); return R.createBox(ctx, wsId, b); },
    getBox: (id: string) => R.getBox(ctx, id),
    listBoxes: (wsId: string) => R.listBoxes(ctx, wsId),
    updateBox: (id: string, b: R.BoxInput) => R.updateBox(ctx, id, b),
    deleteBox: (id: string) => R.deleteBox(ctx, id),
    // H-06 (review finding 6): restoring from the bin is access to existing data, never gated.
    restoreBox: (id: string) => R.restoreBox(ctx, id),
    boxByLabel: (code: string) => R.boxByLabel(ctx, code),
    labelStatus: (code: string) => R.labelStatus(ctx, code),
    createSpareLabels: (wsId: string, n: number) => R.createSpareLabels(ctx, wsId, n),
    spareLabels: (wsId: string) => R.spareLabels(ctx, wsId),
    assignLabel: (code: string, boxId: string) => R.assignLabel(ctx, code, boxId),

    // Items
    addItem: (i: R.ItemInput) => { gate('add_item', i.workspaceId); return R.addItem(ctx, i); },
    getItem: (id: string) => R.getItem(ctx, id),
    listItems: (boxId: string) => R.listItems(ctx, boxId),
    updateItem: (id: string, i: Parameters<typeof R.updateItem>[2]) => R.updateItem(ctx, id, i),
    deleteItem: (id: string) => R.deleteItem(ctx, id),
    restoreItem: (id: string) => {
      R.restoreItem(ctx, id);
    },

    // Photos (gated by can('add_photo'); deleting and reading are never gated)
    addPhoto: (p: R.PhotoInput) => {
      const parent = p.locationId ? { locationId: p.locationId } : { itemId: p.itemId! };
      gate('add_photo', p.workspaceId, R.photosOnParent(ctx, parent));
      return R.addPhoto(ctx, p);
    },
    listPhotos: (parent: { locationId?: string; itemId?: string }) => R.listPhotos(ctx, parent),
    allLivePhotos: () => R.allLivePhotos(ctx),
    itemThumbs: (boxId: string) => R.itemThumbs(ctx, boxId),
    getPhoto: (id: string) => R.getPhoto(ctx, id),
    deletePhoto: (id: string) => R.deletePhoto(ctx, id),
    setPhotoDriveRef: (id: string, ref: string, fileId: string) => R.setPhotoDriveRef(ctx, id, ref, fileId),
    outboxDue: (nowIso: string) => R.outboxDue(ctx, nowIso),
    outboxCount: (op?: R.OutboxRow['op']) => R.outboxCount(ctx, op),
    outboxReserve: (photoId: string, fileId: string) => R.outboxReserve(ctx, photoId, fileId),
    outboxDone: (photoId: string) => R.outboxDone(ctx, photoId),
    outboxFailed: (photoId: string, error: string) => R.outboxFailed(ctx, photoId, error),
    queuePhotoDownloads: () => R.queuePhotoDownloads(ctx),
    queueMissingUploads: () => R.queueMissingUploads(ctx),
    setPhotoDriveFile: (id: string, fileId: string | null) => R.setPhotoDriveFile(ctx, id, fileId),

    // Stock (Seller mode). The ledger is free; only Pro extras (variants, cost/profit, orders, reports) are gated.
    recordStock: (itemId: string, reason: R.StockReason, qty: number, opts?: { allowNegative?: boolean; note?: string }) => R.recordStock(ctx, itemId, reason, qty, opts),
    undoStock: (movementId: string) => R.undoStock(ctx, movementId),
    countBox: (boxId: string, counted: Record<string, number>) => R.countBox(ctx, boxId, counted),
    moveStock: (itemId: string, targetBoxId: string, qty: number) => R.moveStock(ctx, itemId, targetBoxId, qty),
    itemHistory: (itemId: string) => R.itemHistory(ctx, itemId),
    lowStock: (wsId: string) => R.lowStock(ctx, wsId),
    catalogueCandidates: (wsId: string, boxId?: string) => R.catalogueCandidates(ctx, wsId, boxId),
    setJewelleryFields: (wsId: string, on: boolean) => {
      ctx.db.exec({ sql: 'UPDATE workspaces SET jewellery_fields=?, updated_at=? WHERE id=?', bind: [on ? 1 : 0, ctx.now(), wsId] });
    },

    // Seller Pro extras (Phase 3): reports, cost/profit and orders need the plan.
    salesReport: (wsId: string, fromIso: string, toIso: string, tzOffsetMinutes = 0) => { gate('reports', wsId); return R.salesReport(ctx, wsId, fromIso, toIso, tzOffsetMinutes); },
    stockValue: (wsId: string) => { gate('cost_profit', wsId); return R.stockValue(ctx, wsId); },
    createOrder: (wsId: string, o: { customer: string; phone?: string | null; note?: string | null }) => { gate('orders', wsId); return R.createOrder(ctx, wsId, o); },
    listOrders: (wsId: string, status?: R.OrderStatus) => { gate('orders', wsId); return R.listOrders(ctx, wsId, status); },
    getOrder: (id: string) => R.getOrder(ctx, id),
    addOrderLine: (orderId: string, itemId: string, qty: number) => R.addOrderLine(ctx, orderId, itemId, qty),
    removeOrderLine: (lineId: string) => R.removeOrderLine(ctx, lineId),
    packOrder: (orderId: string) => R.packOrder(ctx, orderId),
    deliverOrder: (orderId: string) => R.deliverOrder(ctx, orderId),
    cancelOrder: (orderId: string) => R.cancelOrder(ctx, orderId),
    addVariant: (itemId: string, label: string, boxId?: string) => {
      const it = R.getItem(ctx, itemId);
      if (!it) throw new Error('item not found');
      gate('variants', it.workspaceId);
      gate('add_item', it.workspaceId);
      return R.addVariant(ctx, itemId, label, boxId);
    },
    setVariantLabel: (itemId: string, label: string | null) => R.setVariantLabel(ctx, itemId, label),
    productVariants: (productId: string) => R.productVariants(ctx, productId),
    excelWorkbook: (wsId: string, fromIso: string, toIso: string, tzOffsetMinutes = 0) => { gate('excel', wsId); return R.excelWorkbook(ctx, wsId, fromIso, toIso, tzOffsetMinutes); },
    /** For the UI: which Pro extras are open on this workspace. */
    proStatus: (wsId: string) => {
      const open = (f: Feature) => { try { gate(f, wsId); return true; } catch { return false; } };
      return { reports: open('reports'), costProfit: open('cost_profit'), orders: open('orders'), variants: open('variants') };
    },

    /**
     * Self-checks at app start, at most once a day (DATABASE_SCHEMA §5): quick integrity check, stock totals
     * repaired from the ledger, 30-day bin purge. Returns photo files to delete and every photo file to keep
     * (binned photos included), so the caller can remove orphan files.
     */
    dailyCheck: () => {
      const today = ctx.now().slice(0, 10);
      const last = ctx.db.selectValue(`SELECT value FROM meta WHERE key='last_daily_check'`);
      if (last != null && String(last) >= today) return { ran: false as const };
      const integrityOk = ctx.db.selectValue('PRAGMA quick_check') === 'ok';
      const ledgerRepaired = repairLedger(ctx.db);
      const purged = R.purgeBin(ctx);
      const keepFiles = ctx.db.selectObjects('SELECT file_name, thumb_name FROM photos').flatMap((r) => [String(r.file_name), String(r.thumb_name)]);
      ctx.db.exec({ sql: `INSERT INTO meta (key,value) VALUES ('last_daily_check', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, bind: [today] });
      return { ran: true as const, integrityOk, ledgerRepaired, deleteFiles: purged.photoFiles, keepFiles };
    },

    // Export, arrival check, erase (C-13): never gated
    exportCsv: (wsId: string) => R.exportCsv(ctx, wsId),
    moveSummary: (wsId: string) => R.moveSummary(ctx, wsId),
    eraseAll: () => R.eraseAll(ctx),

    // Reading is never gated (H-06)
    search: (wsId: string, q: string) => R.search(ctx, wsId, q),
    counts: (wsId: string) => R.counts(ctx, wsId),
    listBin: (wsId: string) => R.listBin(ctx, wsId),
    purgeBin: () => R.purgeBin(ctx),
    changeSeq: () => R.changeSeq(ctx),

    /** Answers "may I?" for the UI (e.g. show the upgrade screen before opening the form). */
    // Google Drive link (ADR-020). Device-local; never holds the access token.
    getDriveLink: (): LinkState | null => {
      const [r] = ctx.db.selectObjects('SELECT * FROM drive_link WHERE id=1');
      if (!r) return null;
      return {
        googleEmail: String(r.google_email), folderId: String(r.folder_id), snapshotsFolderId: String(r.snapshots_folder_id),
        photosFolderId: String(r.photos_folder_id), lockFileId: String(r.lock_file_id), deviceId: String(r.device_id),
        generation: Number(r.generation), lastSnapshotSeq: Number(r.last_snapshot_seq), uploadedChangeSeq: Number(r.uploaded_change_seq),
        keyId: String(r.key_id), status: r.status as LinkState['status'], lastSnapshotAt: r.last_snapshot_at == null ? null : String(r.last_snapshot_at),
      };
    },
    setDriveLink: (l: LinkState | null) => {
      if (!l) { ctx.db.exec('DELETE FROM drive_link'); return; }
      ctx.db.exec({
        sql: `INSERT INTO drive_link (id,google_email,folder_id,snapshots_folder_id,photos_folder_id,lock_file_id,device_id,generation,
                last_snapshot_seq,uploaded_change_seq,key_id,status,last_snapshot_at,connected_at)
              VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET google_email=excluded.google_email, folder_id=excluded.folder_id,
                snapshots_folder_id=excluded.snapshots_folder_id, photos_folder_id=excluded.photos_folder_id,
                lock_file_id=excluded.lock_file_id, device_id=excluded.device_id, generation=excluded.generation,
                last_snapshot_seq=excluded.last_snapshot_seq, uploaded_change_seq=excluded.uploaded_change_seq,
                key_id=excluded.key_id, status=excluded.status, last_snapshot_at=excluded.last_snapshot_at`,
        bind: [l.googleEmail, l.folderId, l.snapshotsFolderId, l.photosFolderId, l.lockFileId, l.deviceId, l.generation,
          l.lastSnapshotSeq, l.uploadedChangeSeq, l.keyId, l.status, l.lastSnapshotAt, new Date().toISOString()],
      });
    },
    /** "Pause photo uploads" (iPhone Safari can't tell Wi-Fi from mobile data). Kept across Drive link updates. */
    photoUploadsPaused: () => Number(ctx.db.selectValue('SELECT paused FROM drive_link WHERE id=1') ?? 0) === 1,
    setPhotoUploadsPaused: (on: boolean) => { ctx.db.exec({ sql: 'UPDATE drive_link SET paused=? WHERE id=1', bind: [on ? 1 : 0] }); },
    /** All-workspace totals for the "Before big change" check (A4, §6.2 rule 8). */
    driveTotals: () => {
      const [r] = ctx.db.selectObjects(`SELECT (SELECT count(*) FROM locations WHERE deleted_at IS NULL) AS boxes,
        (SELECT count(*) FROM items WHERE deleted_at IS NULL) AS items,
        (SELECT coalesce(sum(on_hand),0) FROM items WHERE deleted_at IS NULL) AS on_hand,
        (SELECT count(*) FROM photos WHERE deleted_at IS NULL) AS photos`);
      return { boxes: Number(r!.boxes), items: Number(r!.items), onHand: Number(r!.on_hand), photos: Number(r!.photos) };
    },

    // Small app settings in meta. Only these keys; never secrets (the wrapped key blob is safe to store).
    getSetting: (key: SettingKey) => { const v = ctx.db.selectValue('SELECT value FROM meta WHERE key=?', [key]); return v == null ? null : String(v); },
    setSetting: (key: SettingKey, value: string) => { ctx.db.exec({ sql: 'INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', bind: [key, value] }); },
    backupState: () => ctx.db.selectObjects('SELECT last_backup_at, recovery_confirmed FROM backup_state WHERE id=1')[0] ?? null,
    markBackedUp: (at: string) => { ctx.db.exec({ sql: 'INSERT INTO backup_state (id,last_backup_at,recovery_confirmed) VALUES (1,?,1) ON CONFLICT(id) DO UPDATE SET last_backup_at=excluded.last_backup_at', bind: [at] }); },
    check: (feature: Feature, wsId: string, photosOnParent = 0) => {
      try { gate(feature, wsId, photosOnParent); return { allowed: true as const }; } catch (e) {
        if (e instanceof BlockedError) return { allowed: false as const, reason: e.reason };
        throw e;
      }
    },
  };
}

export type Service = ReturnType<typeof createService>;
export type ServiceMethod = keyof Service;
