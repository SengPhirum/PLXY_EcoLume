import path from 'node:path';
import ejs from 'ejs';
import { describe, expect, it } from 'vitest';
import { buildMapView, regionOptions } from '../src/services/regions.js';

const user = { id: 'u1', username: 'admin', role: 'ADMIN' };
const views = path.resolve('src/views');

async function render(template: string, data: Record<string, unknown>): Promise<string> {
  return ejs.renderFile(path.join(views, template), data);
}

describe('operations portal views', () => {
  it('renders the national dashboard', async () => {
    const html = await render('dashboard.ejs', {
      title: 'National operations',
      page: 'dashboard',
      user,
      fleet: { total: '6', online: '5', offline: '1', fault: '0', maintenance: '0' },
      alerts: { total: '1', critical: '1', warning: '0' },
      workOrders: { open: '1' },
      energy: { today_kwh: '42.20' },
      recentAlerts: [],
      provinceStats: [{ code: 'PNH', name_en: 'Phnom Penh', name_km: 'ភ្នំពេញ', total: '6', online: '5' }],
      mapLights: [{ id: '1', asset_code: 'KH-PNH-000001', status: 'ONLINE', latitude: 11.55, longitude: 104.92 }],
      map: buildMapView('KH', [{
        id: '1', asset_code: 'KH-PNH-000001', status: 'ONLINE',
        province_code: 'PNH', latitude: 11.55, longitude: 104.92
      }]),
      regions: regionOptions()
    });
    expect(html).toContain('Cambodia');
    expect(html).toContain('PLXY');
    expect(html).toContain('map-canvas');
    // The asset is drawn through the same projection as the boundaries.
    expect(html).toMatch(/<circle class="map-pin online"/);
  });

  it('renders inventory and asset details', async () => {
    const commonLight = {
      id: '1', asset_code: 'KH-PNH-000001', name: 'Test pole', status: 'ONLINE',
      province_name: 'Phnom Penh', province_name_km: 'ភ្នំពេញ', district: 'Chamkar Mon',
      road: 'Monivong', actual_on: true, desired_on: true, actual_brightness: 80,
      desired_brightness: 80, last_power_w: '96', last_voltage_v: '230',
      nominal_watts: '120', last_temperature_c: '45', last_seen_at: new Date(),
      latitude: 11.55, longitude: 104.92, firmware_version: '0.1.0'
    };
    const inventory = await render('lights.ejs', {
      title: 'Street lights', page: 'lights', user, lights: [commonLight],
      provinces: [{ code: 'PNH', name_en: 'Phnom Penh', name_km: 'ភ្នំពេញ' }],
      status: null, search: null
    });
    const detail = await render('light-detail.ejs', {
      title: commonLight.asset_code, page: 'lights', user, light: commonLight,
      telemetry: [], alerts: [], commands: [], workOrders: []
    });
    expect(inventory).toContain('Provision a new field controller');
    expect(detail).toContain('Remote operation');
  });
});

