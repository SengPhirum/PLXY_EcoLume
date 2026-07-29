import { query, transaction } from './db.js';
import { config } from './config.js';
import { hashDeviceToken, hashPassword } from './security.js';

const provinces = [
  ['BMC', 'Banteay Meanchey', 'បន្ទាយមានជ័យ'],
  ['BTB', 'Battambang', 'បាត់ដំបង'],
  ['KPC', 'Kampong Cham', 'កំពង់ចាម'],
  ['KCH', 'Kampong Chhnang', 'កំពង់ឆ្នាំង'],
  ['KSP', 'Kampong Speu', 'កំពង់ស្ពឺ'],
  ['KPT', 'Kampong Thom', 'កំពង់ធំ'],
  ['KMP', 'Kampot', 'កំពត'],
  ['KDL', 'Kandal', 'កណ្ដាល'],
  ['KKG', 'Koh Kong', 'កោះកុង'],
  ['KRT', 'Kratie', 'ក្រចេះ'],
  ['MDK', 'Mondulkiri', 'មណ្ឌលគិរី'],
  ['PNH', 'Phnom Penh', 'ភ្នំពេញ'],
  ['PVH', 'Preah Vihear', 'ព្រះវិហារ'],
  ['PVG', 'Prey Veng', 'ព្រៃវែង'],
  ['PUR', 'Pursat', 'ពោធិ៍សាត់'],
  ['RTK', 'Ratanakiri', 'រតនគិរី'],
  ['SRP', 'Siem Reap', 'សៀមរាប'],
  ['SHV', 'Preah Sihanouk', 'ព្រះសីហនុ'],
  ['STG', 'Stung Treng', 'ស្ទឹងត្រែង'],
  ['SVR', 'Svay Rieng', 'ស្វាយរៀង'],
  ['TAK', 'Takeo', 'តាកែវ'],
  ['OMC', 'Oddar Meanchey', 'ឧត្តរមានជ័យ'],
  ['KEP', 'Kep', 'កែប'],
  ['PLN', 'Pailin', 'ប៉ៃលិន'],
  ['TBK', 'Tboung Khmum', 'ត្បូងឃ្មុំ']
] as const;

const demoLights = [
  ['KH-PNH-000001', 'Monivong Blvd · Pole 001', 'PNH', 'Chamkar Mon', 'Monivong Boulevard', 11.5482, 104.9214],
  ['KH-PNH-000002', 'Russian Blvd · Pole 014', 'PNH', 'Sen Sok', 'Russian Federation Blvd', 11.5731, 104.8891],
  ['KH-SRP-000001', 'Airport Road · Pole 021', 'SRP', 'Siem Reap', 'National Road 6', 13.3671, 103.8448],
  ['KH-BTB-000001', 'Riverside · Pole 008', 'BTB', 'Battambang', 'Street 1', 13.0957, 103.2022],
  ['KH-SHV-000001', 'Independence Rd · Pole 011', 'SHV', 'Preah Sihanouk', 'Independence Road', 10.6253, 103.5234],
  ['KH-KPC-000001', 'NR7 · Pole 032', 'KPC', 'Kampong Cham', 'National Road 7', 11.9934, 105.4635]
] as const;

export async function seedDatabase(): Promise<void> {
  await transaction(async (client) => {
    for (const [code, nameEn, nameKm] of provinces) {
      await client.query(
        `INSERT INTO provinces(code, name_en, name_km)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en, name_km = EXCLUDED.name_km`,
        [code, nameEn, nameKm]
      );
    }
  });

  if (config.ADMIN_INITIAL_PASSWORD) {
    const passwordHash = await hashPassword(config.ADMIN_INITIAL_PASSWORD);
    await query(
      `INSERT INTO users(username, password_hash, role)
       VALUES ($1, $2, 'ADMIN')
       ON CONFLICT (username) DO NOTHING`,
      [config.ADMIN_USERNAME, passwordHash]
    );
  }

  if (!config.SEED_DEMO_DATA) return;

  await transaction(async (client) => {
    for (const [assetCode, name, provinceCode, district, road, latitude, longitude] of demoLights) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO lights(
           asset_code, name, province_id, district, road, latitude, longitude,
           nominal_watts, status, desired_on, desired_brightness, actual_on,
           actual_brightness, firmware_version, last_seen_at, last_power_w, last_voltage_v
         )
         SELECT $1, $2, id, $4, $5, $6, $7, 120, 'ONLINE', TRUE, 80, TRUE, 80,
                '0.1.0-sim', NOW() - (random() * INTERVAL '12 minutes'), 92 + random() * 12, 222 + random() * 12
         FROM provinces WHERE code = $3
         ON CONFLICT (asset_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [assetCode, name, provinceCode, district, road, latitude, longitude]
      );
      const lightId = result.rows[0]?.id;
      if (lightId && config.DEVICE_DEMO_TOKEN) {
        await client.query(
          `INSERT INTO device_credentials(light_id, token_hash)
           VALUES ($1, $2)
           ON CONFLICT (light_id) DO NOTHING`,
          [lightId, hashDeviceToken(config.DEVICE_DEMO_TOKEN)]
        );
      }
    }
  });
}

