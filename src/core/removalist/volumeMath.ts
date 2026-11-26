// Volume estimate maths (plan §5, Phase 5). Pure functions, no database. Volumes are stored in m³; ft³ is only for
// showing and typing. No prices and no quoting here, on purpose.
import { asciiDigits } from '../../i18n/i18n';

export type VolumeUnit = 'm3' | 'ft3';
export const FT3_PER_M3 = 35.3147;
const EPS = 1e-9;

/** m³ to the shown unit (not rounded). */
export const toUnit = (m3: number, unit: VolumeUnit): number => (unit === 'ft3' ? m3 * FT3_PER_M3 : m3);
/** A value in the shown unit to m³ (not rounded). */
export const fromUnit = (v: number, unit: VolumeUnit): number => (unit === 'ft3' ? v / FT3_PER_M3 : v);

/** Decimals shown: m³ to 2 places (0.10 m³ cartons), ft³ to 1 place. */
export const decimals = (unit: VolumeUnit): number => (unit === 'ft3' ? 1 : 2);

/** Rounds half away from zero to the unit's decimals, without binary noise (1.005 -> 1.01). */
export function roundFor(v: number, unit: VolumeUnit): number {
  const f = 10 ** decimals(unit);
  return Math.sign(v) * Math.round(Math.abs(v) * f + EPS) / f;
}

/** "12.40 m³" / "437.9 ft³", with the language's digits (Bangla digits in Bangla). */
export function formatVolume(m3: number, unit: VolumeUnit, lang: 'en' | 'bn'): string {
  const d = decimals(unit);
  const n = new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-AU', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false })
    .format(roundFor(toUnit(m3, unit), unit));
  return `${n} ${unit === 'ft3' ? 'ft³' : 'm³'}`;
}

/** Typed text in the shown unit to m³; accepts Bangla digits and a decimal comma. NaN when it isn't a number. */
export function parseVolume(text: string, unit: VolumeUnit): number {
  const t = asciiDigits(text).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return NaN;
  return fromUnit(Number(t), unit);
}

export interface VolumeLine { m3Each: number; quantity: number }

/** Sum of quantity × volume, in m³. Lines with no quantity or no volume add nothing. */
export const totalM3 = (lines: readonly VolumeLine[]): number =>
  lines.reduce((s, l) => s + Math.max(0, l.m3Each) * Math.max(0, l.quantity), 0);

/** Total plus the buffer (e.g. 10 % for odd shapes and loading space). */
export const withBuffer = (m3: number, bufferPct: number): number => m3 * (1 + Math.max(0, bufferPct) / 100);

export interface Truck { id: string; name: string; capacityM3: number }
export type TruckChoice =
  | { kind: 'fits'; truck: Truck }
  /** Bigger than the largest truck: shown as "Bigger than your largest truck". */
  | { kind: 'tooBig'; largest: Truck }
  /** The business has no trucks: only the total is shown. */
  | { kind: 'noTrucks' };

/** The smallest truck whose capacity is at least what is needed (an exact match fits). */
export function chooseTruck(trucks: readonly Truck[], neededM3: number): TruckChoice {
  if (!trucks.length) return { kind: 'noTrucks' };
  const sorted = [...trucks].sort((a, b) => a.capacityM3 - b.capacityM3 || a.name.localeCompare(b.name));
  const fit = sorted.find((t) => t.capacityM3 + EPS >= neededM3);
  return fit ? { kind: 'fits', truck: fit } : { kind: 'tooBig', largest: sorted[sorted.length - 1]! };
}
