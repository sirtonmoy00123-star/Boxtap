// Removalist business: the workspace, its business profile, trucks and the volume catalogue (plan §4.2).
// One Removalist workspace = the business; jobs live inside it.
import { type Ctx, newId, num, optionalText, requireText, str, write } from '../core';
import { getWorkspace, type Workspace } from '../places';
import { STARTER_CATALOGUE } from './catalogue';

export type VolumeUnit = 'm3' | 'ft3';
export type Country = 'AU' | 'BD';

export interface BusinessProfile {
  workspaceId: string; name: string; phone: string; email: string | null; abnOrLicence: string | null;
  address: string | null; hasLogo: boolean; volumeUnit: VolumeUnit; bufferPct: number; labelSheet: string;
  defaultBoxItemId: string | null;
}
export interface Truck { id: string; name: string; capacityM3: number; sortOrder: number }
export interface VolumeItem {
  id: string; nameEn: string | null; nameBn: string | null; kind: 'box' | 'furniture'; volumeM3: number;
  sortOrder: number; isDefault: boolean;
}

export interface BusinessInput {
  name: string; phone: string; email?: string | null; abnOrLicence?: string | null; address?: string | null;
}
export interface TruckInput { name: string; capacityM3: number }
export interface RemovalistSetup extends BusinessInput {
  language: 'en' | 'bn'; country: Country; volumeUnit: VolumeUnit; trucks?: TruckInput[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function checkBusiness(b: BusinessInput) {
  const email = optionalText(b.email, 'email', 120);
  if (email && !EMAIL.test(email)) throw new RangeError('email is not valid');
  return {
    name: requireText(b.name, 'name', 80), phone: requireText(b.phone, 'phone', 30), email,
    abn: optionalText(b.abnOrLicence, 'abn_or_licence', 40), address: optionalText(b.address, 'address', 200),
  };
}
function checkTruck(tr: TruckInput) {
  const cap = Number(tr.capacityM3);
  if (!Number.isFinite(cap) || cap <= 0 || cap > 500) throw new RangeError('capacity must be 0-500 m³');
  return { name: requireText(tr.name, 'name', 40), cap };
}

/**
 * Creates a Removalist workspace with its business profile, optional trucks and the 22 starter volume items, in
 * one transaction. Australia: AUD and m³; Bangladesh: BDT and the unit the owner picks (ft³ by default in the UI).
 * Dates keep the language's format (plan §3 C12).
 */
export function createRemovalistWorkspace(ctx: Ctx, s: RemovalistSetup): Workspace {
  const b = checkBusiness(s);
  const trucks = (s.trucks ?? []).map(checkTruck);
  if (s.country !== 'AU' && s.country !== 'BD') throw new RangeError('country must be AU or BD');
  if (s.volumeUnit !== 'm3' && s.volumeUnit !== 'ft3') throw new RangeError('unit must be m3 or ft3');
  const id = newId();
  const t = ctx.now();
  write(ctx, () => {
    ctx.db.exec({
      sql: `INSERT INTO workspaces (id,type,name,country,currency,language,created_at,updated_at) VALUES (?,'removalist',?,?,?,?,?,?)`,
      bind: [id, b.name, s.country, s.country === 'AU' ? 'AUD' : 'BDT', s.language, t, t],
    });
    ctx.db.exec({
      sql: `INSERT INTO business_profile (workspace_id,name,phone,email,abn_or_licence,address,volume_unit,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      bind: [id, b.name, b.phone, b.email, b.abn, b.address, s.volumeUnit, t, t],
    });
    trucks.forEach((tr, i) => ctx.db.exec({
      sql: `INSERT INTO trucks (id,workspace_id,name,capacity_m3,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
      bind: [newId(), id, tr.name, tr.cap, i + 1, t, t],
    }));
    seedCatalogue(ctx, id);
  });
  return getWorkspace(ctx, id)!;
}

/** The starter volume items (owner's values). The first one, Standard carton, is the default box size. */
export function seedCatalogue(ctx: Ctx, workspaceId: string): void {
  const t = ctx.now();
  let first: string | null = null;
  STARTER_CATALOGUE.forEach((c, i) => {
    const id = newId();
    first ??= id;
    ctx.db.exec({
      sql: `INSERT INTO volume_catalogue (id,workspace_id,name_en,name_bn,kind,volume_m3,sort_order,is_default,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,1,?,?)`,
      bind: [id, workspaceId, c.en, c.bn, c.kind, c.m3, i + 1, t, t],
    });
  });
  ctx.db.exec({ sql: `UPDATE business_profile SET default_box_item_id=? WHERE workspace_id=?`, bind: [first, workspaceId] });
}

export function getBusinessProfile(ctx: Ctx, workspaceId: string): BusinessProfile | undefined {
  const [r] = ctx.db.selectObjects(`SELECT workspace_id,name,phone,email,abn_or_licence,address,logo IS NOT NULL AS has_logo,
      volume_unit,buffer_pct,label_sheet,default_box_item_id FROM business_profile WHERE workspace_id=?`, [workspaceId]);
  if (!r) return undefined;
  return {
    workspaceId: String(r.workspace_id), name: String(r.name), phone: String(r.phone), email: str(r.email),
    abnOrLicence: str(r.abn_or_licence), address: str(r.address), hasLogo: num(r.has_logo) === 1,
    volumeUnit: r.volume_unit as VolumeUnit, bufferPct: num(r.buffer_pct), labelSheet: String(r.label_sheet),
    defaultBoxItemId: str(r.default_box_item_id),
  };
}

export const LABEL_SHEETS = ['L7165', 'L7163'] as const;

export function updateBusinessProfile(ctx: Ctx, workspaceId: string, p: BusinessInput & { volumeUnit?: VolumeUnit; labelSheet?: string }): void {
  const b = checkBusiness(p);
  if (p.labelSheet && !(LABEL_SHEETS as readonly string[]).includes(p.labelSheet)) throw new RangeError('unknown label sheet');
  if (p.volumeUnit && p.volumeUnit !== 'm3' && p.volumeUnit !== 'ft3') throw new RangeError('unit must be m3 or ft3');
  const t = ctx.now();
  write(ctx, () => {
    ctx.db.exec({
      sql: `UPDATE business_profile SET name=?, phone=?, email=?, abn_or_licence=?, address=?, volume_unit=coalesce(?, volume_unit),
             label_sheet=coalesce(?, label_sheet), updated_at=? WHERE workspace_id=?`,
      bind: [b.name, b.phone, b.email, b.abn, b.address, p.volumeUnit ?? null, p.labelSheet ?? null, t, workspaceId],
    });
    // The workspace name is the business name (shown in the list of lists).
    ctx.db.exec({ sql: `UPDATE workspaces SET name=?, updated_at=? WHERE id=?`, bind: [b.name, t, workspaceId] });
  });
}

/** The business logo, if one was added (Pro shows it on labels and reports). */
export function getBusinessLogo(ctx: Ctx, workspaceId: string): { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' } | null {
  const [r] = ctx.db.selectObjects(`SELECT logo, logo_mime FROM business_profile WHERE workspace_id=? AND logo IS NOT NULL`, [workspaceId]);
  return r ? { bytes: r.logo as Uint8Array, mime: r.logo_mime as 'image/png' | 'image/jpeg' } : null;
}

// Trucks ---------------------------------------------------------------------------------------------

export function listTrucks(ctx: Ctx, workspaceId: string): Truck[] {
  return ctx.db.selectObjects(`SELECT id,name,capacity_m3,sort_order FROM trucks WHERE workspace_id=? AND deleted_at IS NULL ORDER BY sort_order, name`, [workspaceId])
    .map((r) => ({ id: String(r.id), name: String(r.name), capacityM3: num(r.capacity_m3), sortOrder: num(r.sort_order) }));
}

export function addTruck(ctx: Ctx, workspaceId: string, tr: TruckInput): Truck {
  const c = checkTruck(tr);
  const id = newId();
  const t = ctx.now();
  write(ctx, () => ctx.db.exec({
    sql: `INSERT INTO trucks (id,workspace_id,name,capacity_m3,sort_order,created_at,updated_at)
          VALUES (?,?,?,?,(SELECT coalesce(max(sort_order),0)+1 FROM trucks WHERE workspace_id=?),?,?)`,
    bind: [id, workspaceId, c.name, c.cap, workspaceId, t, t],
  }));
  return listTrucks(ctx, workspaceId).find((x) => x.id === id)!;
}

export function updateTruck(ctx: Ctx, id: string, tr: TruckInput): void {
  const c = checkTruck(tr);
  write(ctx, () => ctx.db.exec({ sql: `UPDATE trucks SET name=?, capacity_m3=?, updated_at=? WHERE id=?`, bind: [c.name, c.cap, ctx.now(), id] }));
}

/** Soft delete: a job may still name this truck. */
export function deleteTruck(ctx: Ctx, id: string): void {
  write(ctx, () => ctx.db.exec({ sql: `UPDATE trucks SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`, bind: [ctx.now(), ctx.now(), id] }));
}

// Volume catalogue -------------------------------------------------------------------------------------

export function listVolumeCatalogue(ctx: Ctx, workspaceId: string): VolumeItem[] {
  return ctx.db.selectObjects(`SELECT * FROM volume_catalogue WHERE workspace_id=? AND deleted_at IS NULL ORDER BY sort_order, name_en`, [workspaceId])
    .map((r) => ({
      id: String(r.id), nameEn: str(r.name_en), nameBn: str(r.name_bn), kind: r.kind as VolumeItem['kind'],
      volumeM3: num(r.volume_m3), sortOrder: num(r.sort_order), isDefault: num(r.is_default) === 1,
    }));
}
