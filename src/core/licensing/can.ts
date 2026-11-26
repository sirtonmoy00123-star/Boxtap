// The one entitlement gate. Contract: API_CONTRACTS.md §1. Reading, searching, exporting and backing up
// are never gated, so they are deliberately not Features.
import type { ConfigBody } from './config';
import type { Plan } from './licence';

export type Feature = 'add_box' | 'add_item' | 'add_photo' | 'share_pdf' | 'insurance_pdf'
  | 'variants' | 'cost_profit' | 'orders' | 'reports' | 'excel' | 'catalogue_image';
export type BlockReason = 'limit_boxes' | 'limit_items' | 'limit_photos' | 'pro_only' | 'feature_off';
export type CanResult = { allowed: true } | { allowed: false; reason: BlockReason };

export interface CanContext {
  config: ConfigBody;
  plans: ReadonlySet<Plan>;
  workspaceType: 'home' | 'seller';
  /** boxes/items: live counts in this workspace. photosOnParent: photos already on the box or item. */
  counts: { boxes: number; items: number; photosOnParent: number };
}

/** Built-in copy of the config, used until a signed one is fetched. Values from API_CONTRACTS §1 and §3. */
export const DEFAULT_CONFIG: ConfigBody = {
  seq: 0,
  issued_at: '2026-11-25T00:00:00Z',
  min_app_version: '0.1.0',
  free_limits: { home_boxes: 12, home_photos_per_box: 1, seller_items: 50 },
  plans: {
    move_pass: { photos_per_parent: 5, offers: [{ months: 12, price: 'A$12.95', pay: '' }] },
    seller_pro: { photos_per_parent: 5, offers: [{ months: 1, price: '৳199', pay: '' }] },
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
  const plan: Plan = workspaceType === 'home' ? 'move_pass' : 'seller_pro';
  const paid = ctx.plans.has(plan);
  const limits = config.free_limits;

  switch (feature) {
    case 'add_box':
      return workspaceType === 'home' && !paid && counts.boxes >= limits.home_boxes ? no('limit_boxes') : OK;
    case 'add_item':
      return workspaceType === 'seller' && !paid && counts.items >= limits.seller_items ? no('limit_items') : OK;
    case 'add_photo': {
      // Ruling (build): config has no seller free photo limit; Seller Free uses home_photos_per_box too.
      const max = paid ? config.plans[plan].photos_per_parent : limits.home_photos_per_box;
      return counts.photosOnParent >= max ? no('limit_photos') : OK;
    }
    case 'share_pdf':
      return paid ? OK : no('pro_only');
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
  }
}
