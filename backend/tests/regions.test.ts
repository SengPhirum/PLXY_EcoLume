import { describe, expect, it } from 'vitest';
import { buildMapView, regionOptions, resolveRegion } from '../src/services/regions.js';

const light = (code: string, latitude: number, longitude: number) => ({
  id: code, asset_code: code, status: 'ONLINE', province_code: code.slice(0, 3),
  latitude, longitude
});

describe('map regions', () => {
  it('offers Cambodia and its provinces', () => {
    const options = regionOptions();
    expect(options[0]).toMatchObject({ code: 'KH', kind: 'country' });
    expect(options.filter((option) => option.kind === 'zone').length).toBeGreaterThanOrEqual(24);
    expect(options.map((option) => option.code)).toContain('KH-PNH');
  });

  it('falls back to the configured default for an unknown region', () => {
    expect(resolveRegion('KH-PNH', 'KH')).toBe('KH-PNH');
    expect(resolveRegion('XX-NOPE', 'KH')).toBe('KH');
    expect(resolveRegion(undefined, 'KH')).toBe('KH');
    expect(resolveRegion('../../etc/passwd', 'KH')).toBe('KH');
  });

  it('projects assets inside the boundary that contains them', () => {
    const view = buildMapView('KH-PNH', [light('PNH-1', 11.5482, 104.9214)]);
    expect(view).not.toBeNull();
    expect(view!.kind).toBe('zone');
    expect(view!.shapes).toHaveLength(1);
    expect(view!.lights).toHaveLength(1);
    // Phnom Penh sits inside its own frame, away from the padded edges.
    const pin = view!.lights[0]!;
    expect(pin.x).toBeGreaterThan(0);
    expect(pin.x).toBeLessThan(view!.width);
    expect(pin.y).toBeGreaterThan(0);
    expect(pin.y).toBeLessThan(view!.height);
  });

  it('keeps the national view wider than one province', () => {
    const country = buildMapView('KH', [])!;
    const province = buildMapView('KH-PNH', [])!;
    expect(country.width).toBeGreaterThan(province.width * 5);
    expect(country.shapes.length).toBeGreaterThan(province.shapes.length);
  });

  it('shows only the selected zone’s assets', () => {
    const assets = [light('PNH-1', 11.5482, 104.9214), light('SRP-1', 13.3671, 103.8448)];
    expect(buildMapView('KH', assets)!.lights).toHaveLength(2);
    const phnomPenh = buildMapView('KH-PNH', assets)!;
    expect(phnomPenh.lights.map((entry) => entry.asset_code)).toEqual(['PNH-1']);
  });

  it('drops assets with unusable coordinates', () => {
    const view = buildMapView('KH', [
      { id: 'a', asset_code: 'A', status: 'ONLINE', province_code: 'PNH', latitude: 'n/a', longitude: '104.9' },
      { id: 'b', asset_code: 'B', status: 'ONLINE', province_code: 'PNH', latitude: 48.85, longitude: 2.35 }
    ])!;
    expect(view.lights).toHaveLength(0);
  });

  it('explains a zone that has no bundled boundary', () => {
    const view = buildMapView('KH-TBK', [])!;
    expect(view.notice).toMatch(/No boundary is bundled/);
    expect(view.shapes.length).toBeGreaterThan(1); // fell back to the national outline
  });

  it('returns nothing for a country with no data', () => {
    expect(buildMapView('ZZ', [])).toBeNull();
  });
});
