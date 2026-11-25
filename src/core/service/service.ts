// The app's data API, run inside the database worker. Screens call this (through the worker client),
// never SQL. Every premium write goes through can() here (ARCHITECTURE §3 rules).
import * as R from '../repo';
import type { Ctx } from '../repo';
import { can, DEFAULT_CONFIG, type BlockReason, type Feature } from '../licensing/can';
import type { ConfigBody } from '../licensing/config';
import type { Plan } from '../licensing/licence';

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
    const r = can(feature, { config: e.config, plans: e.plans, workspaceType: ws.type, counts: { ...R.counts(ctx, workspaceId), photosOnParent } });
    if (!r.allowed) throw new BlockedError(r.reason);
  };
  const boxWorkspace = (boxId: string) => {
    const b = R.getBox(ctx, boxId);
    if (!b) throw new Error('box not found');
    return b.workspaceId;
  };

  return {
    // Workspaces and rooms
    createWorkspace: (w: Parameters<typeof R.createWorkspace>[1]) => R.createWorkspace(ctx, w),
    listWorkspaces: () => R.listWorkspaces(ctx),
    getWorkspace: (id: string) => R.getWorkspace(ctx, id),
    renameWorkspace: (id: string, name: string) => R.renameWorkspace(ctx, id, name),
    createRoom: (wsId: string, name: string, colour?: string) => R.createRoom(ctx, wsId, name, colour),
    listRooms: (wsId: string) => R.listRooms(ctx, wsId),
    renameRoom: (id: string, name: string) => R.renameRoom(ctx, id, name),
    deleteRoom: (id: string) => R.deleteRoom(ctx, id),

    // Boxes and labels
    createBox: (wsId: string, b: R.BoxInput) => { gate('add_box', wsId); return R.createBox(ctx, wsId, b); },
    getBox: (id: string) => R.getBox(ctx, id),
    listBoxes: (wsId: string) => R.listBoxes(ctx, wsId),
    updateBox: (id: string, b: R.BoxInput) => R.updateBox(ctx, id, b),
    deleteBox: (id: string) => R.deleteBox(ctx, id),
    restoreBox: (id: string) => { gate('add_box', boxWorkspace(id)); R.restoreBox(ctx, id); },
    boxByLabel: (code: string) => R.boxByLabel(ctx, code),
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
      const it = R.getItem(ctx, id);
      if (!it) throw new Error('item not found');
      gate('add_item', it.workspaceId);
      R.restoreItem(ctx, id);
    },

    // Reading is never gated (H-06)
    search: (wsId: string, q: string) => R.search(ctx, wsId, q),
    counts: (wsId: string) => R.counts(ctx, wsId),
    listBin: (wsId: string) => R.listBin(ctx, wsId),
    purgeBin: () => R.purgeBin(ctx),
    changeSeq: () => R.changeSeq(ctx),

    /** Answers "may I?" for the UI (e.g. show the upgrade screen before opening the form). */
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
