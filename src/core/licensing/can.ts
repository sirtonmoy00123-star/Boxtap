// The one entitlement gate. Contract: API_CONTRACTS.md §1. Reading, searching, exporting and backing up
// are never gated, so they are deliberately not Features.
import type { ConfigBody } from './config';
import type { Plan } from './licence';

export type Feature = 'add_box' | 'add_item' | 'add_photo' | 'share_pdf' | 'insurance_pdf'
  | 'variants' | 'cost_profit' | 'orders' | 'reports' | 'excel' | 'catalogue_image'
  | 'add_job' | 'add_condition_photo' | 'logo_branding';
export type BlockReason = 'limit_boxes' | 'limit_items' | 'limit_photos' | 'limit_jobs' | 'pro_only' | 'feature_off';
export type CanResult = { allowed: true } | { allowed: false; reason: BlockReason };
export type GateWorkspaceType = 'home' | 'seller' | 'removalist';

export interface CanContext {
  config: ConfigBody;
  plans: ReadonlySet<Plan>;
  workspaceType: GateWorkspaceType;
  /**
   * boxes/items: live counts in this workspace. photosOnParent: photos already on the box or item (for
   * add_condition_photo: on this piece at this stage). activeJobs: Removalist jobs not closed, archived or binned.
   */
  counts: { boxes: number; items: number; photosOnParent: number; activeJobs?: number };
}

/** Each workspace type has exactly one paid plan. Explicit on purpose: no type may fall through to another's rules. */
export const PLAN_FOR: Record<GateWorkspaceType, Plan> = { home: 'move_pass', seller: 'seller_pro', removalist: 'removalist_pro' };

/** Built-in Removalist values, used when a (pre-v6) signed config has none (plan §7). */
export const REMOVALIST_DEFAULTS = {
  activeJobs: 2,
  photosPerPieceStage: 3,
  // Owner (2026-11-26): ordinary piece photo limit "decide later"; placeholder 3 free / 10 Pro, a config value.
  photosPerPiece: 3,
  pro: { photos_per_parent: 10, offers: [{ months: 1, price: 'A$29', pay: '' }] },
} as const;

/** Built-in copy of the config, used until a signed one is fetched. Values from API_CONTRACTS §1 and §3. */
export const DEFAULT_CONFIG: ConfigBody = {
  seq: 0,
  issued_at: '2026-11-25T00:00:00Z',
  min_app_version: '0.1.0',
  free_limits: {
    home_boxes: 12, home_photos_per_box: 1, seller_items: 50,
    removalist_active_jobs: REMOVALIST_DEFAULTS.activeJobs,
    removalist_photos_per_piece_stage: REMOVALIST_DEFAULTS.photosPerPieceStage,
    removalist_photos_per_piece: REMOVALIST_DEFAULTS.photosPerPiece,
  },
  plans: {
    move_pass: { photos_per_parent: 5, offers: [{ months: 12, price: 'A$12.95', pay: '' }] },
    seller_pro: { photos_per_parent: 5, offers: [{ months: 1, price: '৳199', pay: '' }] },
    removalist_pro: { photos_per_parent: REMOVALIST_DEFAULTS.pro.photos_per_parent, offers: [...REMOVALIST_DEFAULTS.pro.offers] },
  },
  // Ruling (build, 2026-11-26): Excel export is built, so it is on by default for Seller Pro; the signed config can turn it off.
  features: { catalogue_image: true, insurance_pdf: true, excel: true },
  revoked_keys: [],
  messages: { en: null, bn: null },
};

const OK: CanResult = { allowed: true };
const no = (reason: BlockReason): CanResult => ({ allowed: false, reason });

export function can(feature: Feature, ctx: CanContext): CanResult {
  const { config, workspaceType, counts } = ctx;
  const plan = PLAN_FOR[workspaceType];
  const paid = ctx.plans.has(plan);
  const limits = config.free_limits;
  const removalist = workspaceType === 'removalist';
  const removalistProPhotos = config.plans.removalist_pro?.photos_per_parent ?? REMOVALIST_DEFAULTS.pro.photos_per_parent;

  switch (feature) {
    case 'add_box':
      // Removalist: no box limit (the instruction lists none; plan §7 decision).
      return workspaceType === 'home' && !paid && counts.boxes >= limits.home_boxes ? no('limit_boxes') : OK;
    case 'add_item':
      return workspaceType === 'seller' && !paid && counts.items >= limits.seller_items ? no('limit_items') : OK;
    case 'add_photo': {
      let max: number;
      if (removalist) max = paid ? removalistProPhotos : limits.removalist_photos_per_piece ?? REMOVALIST_DEFAULTS.photosPerPiece;
      // Ruling (build): config has no seller free photo limit; Seller Free uses home_photos_per_box too.
      else max = paid ? config.plans[plan as 'move_pass' | 'seller_pro'].photos_per_parent : limits.home_photos_per_box;
      return counts.photosOnParent >= max ? no('limit_photos') : OK;
    }
    case 'share_pdf':
      // Removalist PDFs and sharing are never gated (plan §7).
      return paid || removalist ? OK : no('pro_only');
    case 'insurance_pdf':
      if (!config.features.insurance_pdf) return no('feature_off');
      return workspaceType === 'home' && paid ? OK : no('pro_only');
    case 'catalogue_image':
      return config.features.catalogue_image ? OK : no('feature_off');
    case 'excel':
      if (!config.features.excel) return no('feature_off');
      return workspaceType === 'seller' && paid ? OK : no('pro_only');
    case 'variants':
    case 'cost_profit':
    case 'orders':
    case 'reports':
      return workspaceType === 'seller' && paid ? OK : no('pro_only');
    case 'add_job': {
      if (!removalist) return no('feature_off');
      const max = limits.removalist_active_jobs ?? REMOVALIST_DEFAULTS.activeJobs;
      return !paid && (counts.activeJobs ?? 0) >= max ? no('limit_jobs') : OK;
    }
    case 'add_condition_photo': {
      if (!removalist) return no('feature_off');
      const max = paid ? removalistProPhotos : limits.removalist_photos_per_piece_stage ?? REMOVALIST_DEFAULTS.photosPerPieceStage;
      return counts.photosOnParent >= max ? no('limit_photos') : OK;
    }
    case 'logo_branding':
      return removalist && paid ? OK : no('pro_only');
  }
}
