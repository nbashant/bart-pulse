import { BART_GTFS } from './gtfs.generated';
import type { LineLabel, RouteShape, Station } from './types';

export const CORE_LINES: LineLabel[] = ['Yellow', 'Red', 'Orange', 'Green', 'Blue'];
export const ALL_LINES: LineLabel[] = CORE_LINES;

export const LINE_META: Record<
  LineLabel,
  { label: LineLabel; color: string; accessibleColor: string; sourceColors: string[]; order: number }
> = {
  Yellow: { label: 'Yellow', color: '#f8d94a', accessibleColor: '#ffd747', sourceColors: ['#ffff33'], order: 1 },
  Red: { label: 'Red', color: '#ef3b43', accessibleColor: '#ff4d55', sourceColors: ['#ff0000'], order: 2 },
  Orange: { label: 'Orange', color: '#f59d36', accessibleColor: '#f7a03a', sourceColors: ['#ff9933'], order: 3 },
  Green: { label: 'Green', color: '#38a65a', accessibleColor: '#43bc69', sourceColors: ['#339933'], order: 4 },
  Blue: { label: 'Blue', color: '#1598c8', accessibleColor: '#26a9db', sourceColors: ['#0099cc'], order: 5 },
  Airport: { label: 'Airport', color: '#9eb1bd', accessibleColor: '#aab9c3', sourceColors: ['#b0bec7'], order: 6 },
};

export const TERMINAL_STATIONS = new Set(['ANTC', 'RICH', 'BERY', 'DUBL', 'DALY', 'MLBR', 'SFIA']);
export const TRANSFER_STATIONS = new Set(['MCAR', '19TH', '12TH', 'WOAK', 'LAKE', 'BAYF', 'COLS', 'DALY', 'SBRN', 'SFIA', 'MLBR']);
export const PRIORITY_LABEL_STATIONS = new Set([
  'ANTC',
  'RICH',
  'BERY',
  'DUBL',
  'DALY',
  'MLBR',
  'SFIA',
  'MCAR',
  'WOAK',
  'BAYF',
  'COLS',
]);

export const gtfsSource = {
  sourceUrl: BART_GTFS.sourceUrl,
  generatedAt: BART_GTFS.generatedAt,
  feedVersion: BART_GTFS.feed.feed_version,
  feedStartDate: BART_GTFS.feed.feed_start_date,
  feedEndDate: BART_GTFS.feed.feed_end_date,
};

export const routes: RouteShape[] = BART_GTFS.routes
  .filter((route) => route.label !== 'Airport')
  .map((route) => ({
    ...route,
    color: LINE_META[route.label].accessibleColor,
  }));

const servedStationAbbrs = new Set(routes.flatMap((route) => route.stations));
export const stations: Station[] = BART_GTFS.stations
  .filter((station) => servedStationAbbrs.has(station.abbr))
  .map((station) => ({ ...station }));

export const stationByAbbr = new Map(stations.map((station) => [station.abbr, station]));
export const routesById = new Map(routes.map((route) => [route.id, route]));

export const stationLines = new Map<string, Set<LineLabel>>();
for (const route of routes) {
  for (const abbr of route.stations) {
    if (!stationLines.has(abbr)) stationLines.set(abbr, new Set());
    stationLines.get(abbr)?.add(route.label);
  }
}

export function lineForColor(color: string): LineLabel | 'Unknown' {
  const normalized = color.toLowerCase();
  return (
    Object.values(LINE_META).find(
      (line) =>
        line.accessibleColor.toLowerCase() === normalized ||
        line.color.toLowerCase() === normalized ||
        line.sourceColors.some((sourceColor) => sourceColor.toLowerCase() === normalized),
    )?.label || 'Unknown'
  );
}

export function routesForLine(line: LineLabel): RouteShape[] {
  return routes.filter((route) => route.label === line);
}

export function displayStationName(abbr: string): string {
  return stationByAbbr.get(abbr)?.name || abbr;
}

export function shortStationName(station: Station): string {
  return station.name
    .replace('San Francisco International Airport', 'SFO Airport')
    .replace('Berryessa / North San Jose', 'Berryessa')
    .replace('Pleasant Hill / Contra Costa Centre', 'Pleasant Hill')
    .replace('12th Street / Oakland City Center', '12th Street')
    .replace('Civic Center / UN Plaza', 'Civic Center')
    .replace('Dublin / Pleasanton', 'Dublin')
    .replace('West Dublin / Pleasanton', 'West Dublin');
}
