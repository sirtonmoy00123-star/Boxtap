import { describe, it, expect } from 'vitest';
import { chooseTruck, formatVolume, FT3_PER_M3, fromUnit, parseVolume, roundFor, toUnit, totalM3, withBuffer } from './volumeMath';

describe('volume maths', () => {
  it('totals quantity × volume, ignoring empty lines', () => {
    expect(totalM3([{ m3Each: 0.1, quantity: 10 }, { m3Each: 1.5, quantity: 1 }, { m3Each: 0.6, quantity: 0 }])).toBeCloseTo(2.5, 10);
    expect(totalM3([])).toBe(0);
  });

  it('adds the buffer', () => {
    expect(withBuffer(20, 10)).toBeCloseTo(22, 10);
    expect(withBuffer(20, 0)).toBe(20);
    expect(withBuffer(20, -5)).toBe(20);
  });

  it('converts m³ and ft³ (1 m³ = 35.3147 ft³) and back', () => {
    expect(toUnit(1, 'ft3')).toBe(FT3_PER_M3);
    expect(toUnit(2, 'm3')).toBe(2);
    expect(fromUnit(toUnit(12.34, 'ft3'), 'ft3')).toBeCloseTo(12.34, 12);
    expect(fromUnit(35.3147, 'ft3')).toBeCloseTo(1, 12);
  });

  it('rounds to 2 places for m³ and 1 for ft³, without binary noise', () => {
    expect(roundFor(1.005, 'm3')).toBe(1.01);
    expect(roundFor(0.1 + 0.2, 'm3')).toBe(0.3);
    expect(roundFor(3.53147, 'ft3')).toBe(3.5);
    expect(roundFor(3.55, 'ft3')).toBe(3.6);
  });

  it('formats in the unit and the language\'s digits', () => {
    expect(formatVolume(12.4, 'm3', 'en')).toBe('12.40 m³');
    expect(formatVolume(1, 'ft3', 'en')).toBe('35.3 ft³');
    expect(formatVolume(12.4, 'm3', 'bn')).toBe('১২.৪০ m³');
    expect(formatVolume(1234.5, 'm3', 'en')).toBe('1234.50 m³'); // no grouping
  });

  it('parses typed sizes in the unit, Bangla digits and a decimal comma too', () => {
    expect(parseVolume('1.5', 'm3')).toBe(1.5);
    expect(parseVolume('০,৫', 'm3')).toBe(0.5);
    expect(parseVolume('35.3147', 'ft3')).toBeCloseTo(1, 12);
    expect(parseVolume('abc', 'm3')).toBeNaN();
    expect(parseVolume('-1', 'm3')).toBeNaN();
  });

  it('chooses the smallest truck that fits, an exact match included', () => {
    const trucks = [{ id: 'b', name: 'Big', capacityM3: 45 }, { id: 's', name: 'Small', capacityM3: 20 }, { id: 'm', name: 'Mid', capacityM3: 30 }];
    expect(chooseTruck(trucks, 21)).toEqual({ kind: 'fits', truck: trucks[2] });
    expect(chooseTruck(trucks, 20)).toEqual({ kind: 'fits', truck: trucks[1] }); // exact
    expect(chooseTruck(trucks, withBuffer(10 * 0.1 + 18, 10) - 0.9)).toEqual({ kind: 'fits', truck: trucks[1] });
    expect(chooseTruck(trucks, 0)).toEqual({ kind: 'fits', truck: trucks[1] });
    expect(chooseTruck(trucks, 45.01)).toEqual({ kind: 'tooBig', largest: trucks[0] });
    expect(chooseTruck([], 5)).toEqual({ kind: 'noTrucks' });
  });

  it('a total that is exactly a truck after floating-point sums still fits', () => {
    const needed = withBuffer(totalM3([{ m3Each: 0.1, quantity: 3 }]), 0); // 0.30000000000000004
    expect(chooseTruck([{ id: 'x', name: 'Ute', capacityM3: 0.3 }], needed).kind).toBe('fits');
  });
});
