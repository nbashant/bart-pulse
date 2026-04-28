import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GTFS_URL = process.env.BART_GTFS_URL || 'https://www.bart.gov/dev/schedules/google_transit.zip';
const routeIds = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '11', '12', '19', '20']);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outFile = join(root, 'src/data/gtfs.generated.ts');

const tempDir = mkdtempSync(join(tmpdir(), 'bart-gtfs-'));
const zipPath = join(tempDir, 'bart_gtfs.zip');

try {
  console.log(`Downloading BART GTFS from ${GTFS_URL}`);
  execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', GTFS_URL, '-o', zipPath], {
    stdio: 'inherit',
  });

  const files = {
    routes: readCsv('routes.txt'),
    trips: readCsv('trips.txt'),
    stops: readCsv('stops.txt'),
    stopTimes: readCsv('stop_times.txt'),
    shapes: readCsv('shapes.txt'),
    feedInfo: readCsv('feed_info.txt'),
  };

  const stopsById = new Map(files.stops.map((stop) => [stop.stop_id, stop]));
  const stationsByAbbr = buildStations(files.stops);
  const shapesById = groupBy(files.shapes, (row) => row.shape_id);
  const stopTimesByTrip = groupBy(files.stopTimes, (row) => row.trip_id);
  const tripsByRoute = groupBy(files.trips.filter((trip) => routeIds.has(trip.route_id)), (trip) => trip.route_id);
  const routesById = new Map(files.routes.map((route) => [route.route_id, route]));

  const routes = [];
  for (const routeId of routeIds) {
    const route = routesById.get(routeId);
    const trips = tripsByRoute.get(routeId) || [];
    const representative = chooseRepresentativeTrip(trips, stopTimesByTrip, stopsById, shapesById);
    if (!route || !representative) continue;

    const rawStopTimes = stopTimesByTrip.get(representative.trip_id) || [];
    const sortedStopTimes = rawStopTimes
      .slice()
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const stationStops = sortedStopTimes
      .map((row) => ({
        abbr: stationAbbrForStop(row.stop_id, stopsById),
        seconds: parseGtfsTime(row.departure_time || row.arrival_time),
      }))
      .filter((row) => row.abbr && stationsByAbbr.has(row.abbr));

    const stations = stationStops.map((row) => row.abbr);
    const segTravel = [];
    for (let index = 0; index < stationStops.length - 1; index += 1) {
      const from = stationStops[index].seconds;
      const to = stationStops[index + 1].seconds;
      const delta = Number.isFinite(from) && Number.isFinite(to) ? Math.max(45, to - from) : 150;
      segTravel.push(delta);
    }

    const shapeRows = (shapesById.get(representative.shape_id) || [])
      .slice()
      .sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence));
    const shape = simplifyPolyline(
      shapeRows.map((row) => [round(Number(row.shape_pt_lon), 6), round(Number(row.shape_pt_lat), 6)]),
      routeId === '19' || routeId === '20' ? 0.000055 : 0.000115,
    );

    routes.push({
      id: route.route_id,
      label: lineLabel(route.route_short_name),
      shortName: route.route_short_name,
      headsign: representative.trip_headsign || route.route_long_name,
      directionId: representative.direction_id,
      color: `#${route.route_color.toLowerCase()}`,
      textColor: `#${route.route_text_color.toLowerCase()}`,
      stations,
      segTravel,
      shape,
    });
  }

  const generated = {
    sourceUrl: GTFS_URL,
    generatedAt: new Date().toISOString(),
    feed: files.feedInfo[0] || {},
    stations: [...stationsByAbbr.values()].sort((a, b) => a.name.localeCompare(b.name)),
    routes: routes.sort((a, b) => Number(a.id) - Number(b.id)),
  };

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    `// Generated from the official BART GTFS static feed.\n` +
      `// Source: ${GTFS_URL}\n` +
      `// Do not hand-edit route geometry.\n` +
      `import type { GtfsFeed } from './types';\n\n` +
      `export const BART_GTFS = ${JSON.stringify(generated)} as const satisfies GtfsFeed;\n`,
  );
  console.log(`Wrote ${outFile}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function readZipText(fileName) {
  return execFileSync('unzip', ['-p', zipPath, fileName], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
}

function readCsv(fileName) {
  return parseCsv(readZipText(fileName));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuote) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuote = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuote = true;
    } else if (char === ',') {
      pushCell();
    } else if (char === '\n') {
      pushCell();
      pushRow();
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell || row.length) {
    pushCell();
    pushRow();
  }

  const [headers, ...body] = rows;
  return body
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function buildStations(stops) {
  const parentRows = stops.filter((stop) => stop.location_type === '1');
  const parents = new Map(parentRows.map((stop) => [stop.stop_id, stop]));
  const platformGroups = groupBy(stops.filter((stop) => stop.location_type === '0' && stop.parent_station), (stop) => stop.parent_station);
  const stations = new Map();

  for (const [abbr, platforms] of platformGroups.entries()) {
    const parent = parents.get(abbr);
    const lat = average(platforms.map((platform) => Number(platform.stop_lat)).filter(Number.isFinite));
    const lon = average(platforms.map((platform) => Number(platform.stop_lon)).filter(Number.isFinite));
    stations.set(abbr, {
      abbr,
      name: parent?.stop_name || platforms[0].stop_name,
      lat: round(lat, 6),
      lon: round(lon, 6),
    });
  }

  return stations;
}

function chooseRepresentativeTrip(trips, stopTimesByTrip, stopsById, shapesById) {
  return trips
    .map((trip) => {
      const stopTimes = stopTimesByTrip.get(trip.trip_id) || [];
      const parents = new Set(stopTimes.map((row) => stationAbbrForStop(row.stop_id, stopsById)).filter(Boolean));
      return {
        ...trip,
        parentCount: parents.size,
        stopCount: stopTimes.length,
        shapePointCount: (shapesById.get(trip.shape_id) || []).length,
      };
    })
    .sort((a, b) => {
      if (b.parentCount !== a.parentCount) return b.parentCount - a.parentCount;
      if (b.stopCount !== a.stopCount) return b.stopCount - a.stopCount;
      return b.shapePointCount - a.shapePointCount;
    })[0];
}

function stationAbbrForStop(stopId, stopsById) {
  const stop = stopsById.get(stopId);
  return stop?.parent_station || stop?.zone_id || stopId;
}

function groupBy(items, keyFor) {
  const output = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!output.has(key)) output.set(key, []);
    output.get(key).push(item);
  }
  return output;
}

function parseGtfsTime(value) {
  const [hours, minutes, seconds] = value.split(':').map(Number);
  if (![hours, minutes, seconds].every(Number.isFinite)) return Number.NaN;
  return hours * 3600 + minutes * 60 + seconds;
}

function lineLabel(shortName) {
  if (shortName.startsWith('Grey')) return 'Airport';
  return shortName.split('-')[0];
}

function simplifyPolyline(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  simplifySection(points, 0, points.length - 1, tolerance * tolerance, keep);
  return points.filter((_, index) => keep[index]);
}

function simplifySection(points, first, last, toleranceSquared, keep) {
  let maxDistance = 0;
  let index = first;
  for (let current = first + 1; current < last; current += 1) {
    const distance = pointLineDistanceSquared(points[current], points[first], points[last]);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = current;
    }
  }
  if (maxDistance > toleranceSquared) {
    keep[index] = 1;
    simplifySection(points, first, index, toleranceSquared, keep);
    simplifySection(points, index, last, toleranceSquared, keep);
  }
}

function pointLineDistanceSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return squaredDistance(point, start);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return squaredDistance(point, [start[0] + t * dx, start[1] + t * dy]);
}

function squaredDistance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function round(value, places) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}
