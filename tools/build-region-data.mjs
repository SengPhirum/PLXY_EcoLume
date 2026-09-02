/**
 * Rebuilds backend/src/public/geo/*.json from Natural Earth admin-1 boundaries.
 *
 *   curl -sSo /tmp/ne10_admin1.geojson \
 *     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
 *   node tools/build-region-data.mjs /tmp/ne10_admin1.geojson
 *
 * Natural Earth is public domain, so the output carries no attribution
 * obligation. It is generalized cartographic data, not a legal boundary
 * source: see docs/ARCHITECTURE.md before relying on it operationally.
 *
 * Development-only. The generated files are committed, so nothing downloads
 * at install, build, or run time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend/src/public/geo');

/** ISO 3166-2 subdivision → the province code used by the EcoLume database. */
const COUNTRIES = {
  KH: {
    name: 'Cambodia',
    nameLocal: 'កម្ពុជា',
    zones: {
      'KH-1': 'BMC', 'KH-2': 'BTB', 'KH-3': 'KPC', 'KH-4': 'KCH', 'KH-5': 'KSP',
      'KH-6': 'KPT', 'KH-7': 'KMP', 'KH-8': 'KDL', 'KH-9': 'KKG', 'KH-10': 'KRT',
      'KH-11': 'MDK', 'KH-12': 'PNH', 'KH-13': 'PVH', 'KH-14': 'PVG', 'KH-15': 'PUR',
      'KH-16': 'RTK', 'KH-17': 'SRP', 'KH-18': 'SHV', 'KH-19': 'STG', 'KH-20': 'SVR',
      'KH-21': 'TAK', 'KH-22': 'OMC', 'KH-23': 'KEP', 'KH-24': 'PLN'
    },
    // Provinces the source predates. They stay selectable; the view falls back
    // to the national outline until an official boundary file replaces this.
    missing: { TBK: 'Tboung Khmum was split from Kampong Cham in 2013' }
  }
};

const TOLERANCE = Number(process.env.TOLERANCE ?? 0.006); // degrees
const PRECISION = 4;                                      // ~11 m

/** Douglas–Peucker, using perpendicular distance in degrees. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let furthest = tolerance;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const span = Math.hypot(dx, dy);

    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const distance = span === 0
        ? Math.hypot(px - ax, py - ay)
        : Math.abs(dy * px - dx * py + bx * ay - by * ax) / span;
      if (distance > furthest) {
        furthest = distance;
        index = i;
      }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (value) => Number(value.toFixed(PRECISION));

/** Simplifies one ring, keeping it closed and dropping degenerate results. */
function ring(coordinates) {
  const simplified = simplify(coordinates, TOLERANCE).map(([x, y]) => [round(x), round(y)]);
  if (simplified.length < 4) return null;
  const [fx, fy] = simplified[0];
  const [lx, ly] = simplified[simplified.length - 1];
  if (fx !== lx || fy !== ly) simplified.push([fx, fy]);
  return simplified;
}

/** Normalises Polygon/MultiPolygon into a flat list of rings, largest first. */
function rings(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .flatMap((polygon) => polygon.slice(0, 1))   // outer rings only; holes are noise at this scale
    .map(ring)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

const source = process.argv[2];
if (!source) {
  console.error('usage: node tools/build-region-data.mjs <ne_10m_admin_1_states_provinces.geojson>');
  process.exit(1);
}
const collection = JSON.parse(fs.readFileSync(source, 'utf8'));
fs.mkdirSync(out, { recursive: true });

for (const [country, spec] of Object.entries(COUNTRIES)) {
  const zones = [];
  for (const [iso, code] of Object.entries(spec.zones)) {
    const feature = collection.features.find((candidate) => candidate.properties.iso_3166_2 === iso);
    if (!feature) {
      console.warn(`! ${country}: no source feature for ${iso} (${code})`);
      continue;
    }
    zones.push({ code, iso, name: feature.properties.name, rings: rings(feature.geometry) });
  }
  zones.sort((a, b) => a.code.localeCompare(b.code));

  const document = {
    country,
    name: spec.name,
    nameLocal: spec.nameLocal,
    source: 'Natural Earth 1:10m admin-1 (public domain)',
    generalized: true,
    missingZones: spec.missing ?? {},
    zones
  };
  const file = path.join(out, `${country.toLowerCase()}.json`);
  fs.writeFileSync(file, JSON.stringify(document));
  const points = zones.reduce((sum, zone) => sum + zone.rings.reduce((n, r) => n + r.length, 0), 0);
  console.log(
    `${path.relative(process.cwd(), file)}: ${zones.length} zones, ${points} points, ` +
    `${(fs.statSync(file).size / 1024).toFixed(1)} KB`
  );
}
