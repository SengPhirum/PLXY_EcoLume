import fs from 'node:fs';
import path from 'node:path';

/**
 * Geographic regions for the operations map.
 *
 * Boundary data is self-hosted (see backend/src/public/geo) so the operations
 * centre never calls a third-party tile service: an air-gapped control room
 * keeps working, and the position of ministry assets is never disclosed to an
 * outside host by the act of drawing them.
 */

interface ZoneDocument {
  code: string;
  iso: string;
  name: string;
  rings: [number, number][][];
}

interface RegionDocument {
  country: string;
  name: string;
  nameLocal: string;
  source: string;
  generalized: boolean;
  missingZones: Record<string, string>;
  zones: ZoneDocument[];
}

export interface RegionOption {
  /** "KH" for a whole country, "KH-PNH" for one zone within it. */
  code: string;
  label: string;
  kind: 'country' | 'zone';
  /** True when the zone is selectable but has no bundled boundary. */
  approximate: boolean;
}

export interface MappedLight {
  id: string;
  asset_code: string;
  status: string;
  province_code: string | null;
  latitude: number | string;
  longitude: number | string;
}

export interface PlottedLight extends MappedLight {
  x: number;
  y: number;
}

export interface MapShape {
  code: string;
  name: string;
  path: string;
  active: boolean;
}

export interface MapView {
  code: string;
  label: string;
  kind: 'country' | 'zone';
  country: string;
  countryName: string;
  /** Set when the selected zone has no bundled boundary and the country is shown instead. */
  notice: string | null;
  source: string;
  width: number;
  height: number;
  viewBox: string;
  /** One SVG user unit in kilometres, for sizing strokes and pins to the view. */
  unit: number;
  shapes: MapShape[];
  lights: PlottedLight[];
}

const GEO_DIR = path.resolve('src/public/geo');
const PADDING = 0.025;
const documents = new Map<string, RegionDocument>();

function load(country: string): RegionDocument | null {
  const key = country.toUpperCase();
  const cached = documents.get(key);
  if (cached) return cached;
  const file = path.join(GEO_DIR, `${key.toLowerCase()}.json`);
  if (!fs.existsSync(file)) return null;
  const document = JSON.parse(fs.readFileSync(file, 'utf8')) as RegionDocument;
  documents.set(key, document);
  return document;
}

/** Every country with bundled boundary data, in file order. */
export function countries(): RegionDocument[] {
  return fs.existsSync(GEO_DIR)
    ? fs.readdirSync(GEO_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => load(path.basename(name, '.json')))
        .filter((document): document is RegionDocument => document !== null)
    : [];
}

/** Selectable regions: each country followed by its zones. */
export function regionOptions(): RegionOption[] {
  const options: RegionOption[] = [];
  for (const document of countries()) {
    options.push({
      code: document.country,
      label: `${document.name} — all zones`,
      kind: 'country',
      approximate: false
    });
    const zones: RegionOption[] = document.zones.map((zone) => ({
      code: `${document.country}-${zone.code}`,
      label: zone.name,
      kind: 'zone' as const,
      approximate: false
    }));
    for (const [code, reason] of Object.entries(document.missingZones ?? {})) {
      zones.push({ code: `${document.country}-${code}`, label: `${code} (${reason})`, kind: 'zone', approximate: true });
    }
    options.push(...zones.sort((a, b) => a.label.localeCompare(b.label)));
  }
  return options;
}

/** Resolves a requested region code, falling back to the configured default. */
export function resolveRegion(requested: unknown, fallback: string): string {
  const available = new Set(regionOptions().map((option) => option.code));
  const candidate = typeof requested === 'string' ? requested.trim().toUpperCase() : '';
  if (available.has(candidate)) return candidate;
  if (available.has(fallback.toUpperCase())) return fallback.toUpperCase();
  return countries()[0]?.country ?? '';
}

const KM_PER_DEGREE = 111.32;

/**
 * Equirectangular projection with the standard parallel at the region's mid
 * latitude. Both the boundary paths and the asset pins go through this one
 * function, so a pin can never drift away from the outline beneath it.
 */
function projector(minLon: number, minLat: number, maxLon: number, maxLat: number) {
  const midLat = (minLat + maxLat) / 2;
  const scale = Math.cos((midLat * Math.PI) / 180);
  const width = (maxLon - minLon) * scale;
  const height = maxLat - minLat;
  const padX = width * PADDING;
  const padY = height * PADDING;
  return {
    width: width + padX * 2,
    height: height + padY * 2,
    project: (lon: number, lat: number) => ({
      x: (lon - minLon) * scale + padX,
      y: maxLat - lat + padY
    })
  };
}

function boundsOf(zones: ZoneDocument[]) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const zone of zones) {
    for (const ring of zone.rings) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}

const coordinate = (value: number | string) => (typeof value === 'number' ? value : Number(value));

/**
 * Builds everything the dashboard needs to draw one region: the boundary paths,
 * the projected assets, and the view box that frames them.
 */
export function buildMapView(regionCode: string, lights: readonly MappedLight[]): MapView | null {
  const [countryCode, zoneCode] = regionCode.split('-');
  const document = load(countryCode ?? '');
  if (!document) return null;

  const requestedZone = zoneCode
    ? document.zones.find((zone) => zone.code === zoneCode) ?? null
    : null;
  const missingReason = zoneCode && !requestedZone ? document.missingZones?.[zoneCode] : undefined;

  // A zone we have no boundary for still resolves — to the national outline,
  // with its own assets highlighted — rather than showing an empty frame.
  const framed = requestedZone ? [requestedZone] : document.zones;
  if (framed.length === 0) return null;

  const { minLon, minLat, maxLon, maxLat } = boundsOf(framed);
  const { width, height, project } = projector(minLon, minLat, maxLon, maxLat);

  const shapes: MapShape[] = document.zones
    .filter((zone) => !requestedZone || zone.code === requestedZone.code)
    .map((zone) => ({
      code: zone.code,
      name: zone.name,
      active: !zoneCode || zone.code === zoneCode,
      path: zone.rings
        .map((ring) => ring
          .map(([lon, lat], index) => {
            const { x, y } = project(lon, lat);
            return `${index === 0 ? 'M' : 'L'}${x.toFixed(4)} ${y.toFixed(4)}`;
          })
          .join('') + 'Z')
        .join('')
    }));

  const inScope = zoneCode
    ? lights.filter((light) => light.province_code === zoneCode)
    : lights;

  const plotted: PlottedLight[] = [];
  for (const light of inScope) {
    const lat = coordinate(light.latitude);
    const lon = coordinate(light.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const { x, y } = project(lon, lat);
    if (x < 0 || y < 0 || x > width || y > height) continue; // outside the framed region
    plotted.push({ ...light, x, y });
  }

  const option = regionOptions().find((entry) => entry.code === regionCode);
  return {
    code: regionCode,
    label: requestedZone?.name ?? option?.label ?? document.name,
    kind: zoneCode ? 'zone' : 'country',
    country: document.country,
    countryName: document.name,
    notice: missingReason
      ? `No boundary is bundled for this zone — ${missingReason}. Showing ${document.name}.`
      : null,
    source: document.source,
    width,
    height,
    viewBox: `0 0 ${width.toFixed(4)} ${height.toFixed(4)}`,
    unit: KM_PER_DEGREE,
    shapes,
    lights: plotted
  };
}
