import { LINE_META, routes, stations } from '../data/gtfs';
import type { LineLabel, RouteShape, Station } from '../data/types';
import { closestPointIndex, offsetPolyline, pointAlong, segmentSlice, svgPath, type PathPoint } from './polyline';
import { boundsForPoints, computeGeoBounds, makeProjector, padBounds, type Bounds, type Point } from './projection';

export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 1100;
export const DISPLAY_ROUTE_IDS = new Set(['1', '3', '5', '7', '11']);

const LINE_OFFSETS: Record<LineLabel, number> = {
  Yellow: -22,
  Red: -11,
  Orange: 0,
  Green: 12,
  Blue: 24,
  Airport: 0,
};

export type ProjectedStation = Station & {
  point: Point;
  lines: LineLabel[];
};

export type ProjectedRoute = {
  route: RouteShape;
  baseShape: Point[];
  displayShape: Point[];
  path: string;
  stationIndexes: number[];
};

export type NetworkGeometry = {
  stations: ProjectedStation[];
  stationByAbbr: Map<string, ProjectedStation>;
  routes: ProjectedRoute[];
  routeById: Map<string, ProjectedRoute>;
  bounds: Bounds;
  fullView: Bounds;
};

export const networkGeometry = buildNetworkGeometry();

export function routePoint(routeId: string, prevIdx: number, nextIdx: number, progress: number): PathPoint | null {
  const route = networkGeometry.routeById.get(routeId);
  if (!route) return null;
  const from = route.stationIndexes[prevIdx];
  const to = route.stationIndexes[nextIdx];
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const points = segmentSlice(route.displayShape, from, to);
  if (points.length < 2) {
    const station = networkGeometry.stationByAbbr.get(route.route.stations[nextIdx]);
    return station ? { ...station.point, angle: 0 } : null;
  }
  return pointAlong(points, progress);
}

export function routePointForStops(
  routeId: string,
  prevStop: string,
  nextStop: string,
  progress: number,
  displayRouteIds: Set<string>,
): PathPoint | null {
  const sourceRoute = networkGeometry.routeById.get(routeId);
  if (!sourceRoute) return null;

  const displayRoute = networkGeometry.routes.find(({ route }) => {
    if (route.label !== sourceRoute.route.label || !displayRouteIds.has(route.id)) return false;
    return route.stations.includes(prevStop) && route.stations.includes(nextStop);
  });
  if (!displayRoute) return routePoint(routeId, sourceRoute.route.stations.indexOf(prevStop), sourceRoute.route.stations.indexOf(nextStop), progress);

  const from = displayRoute.route.stations.indexOf(prevStop);
  const to = displayRoute.route.stations.indexOf(nextStop);
  if (from < 0 || to < 0 || from === to) return null;
  const fromIndex = displayRoute.stationIndexes[from];
  const toIndex = displayRoute.stationIndexes[to];
  const points = segmentSlice(displayRoute.displayShape, fromIndex, toIndex);
  return pointAlong(points, progress);
}

export function boundsForLine(line: LineLabel): Bounds {
  const points = networkGeometry.routes
    .filter(({ route }) => route.label === line)
    .flatMap(({ displayShape }) => displayShape);
  return padBounds(boundsForPoints(points), 48);
}

export function boundsForStation(abbr: string): Bounds {
  const station = networkGeometry.stationByAbbr.get(abbr);
  if (!station) return networkGeometry.fullView;
  return padBounds({ minX: station.point.x, minY: station.point.y, maxX: station.point.x, maxY: station.point.y }, 160);
}

export function stationLabelPriority(abbr: string): number {
  const station = networkGeometry.stationByAbbr.get(abbr);
  if (!station) return 0;
  if (station.lines.length >= 3) return 3;
  if (station.lines.length === 2) return 2;
  if (['ANTC', 'RICH', 'BERY', 'DUBL', 'DALY', 'MLBR', 'SFIA'].includes(abbr)) return 3;
  return 1;
}

function buildNetworkGeometry(): NetworkGeometry {
  const projector = makeProjector(computeGeoBounds(routes, stations), MAP_WIDTH, MAP_HEIGHT, 50);
  const stationLineMap = new Map<string, Set<LineLabel>>();
  for (const route of routes) {
    for (const abbr of route.stations) {
      if (!stationLineMap.has(abbr)) stationLineMap.set(abbr, new Set());
      stationLineMap.get(abbr)?.add(route.label);
    }
  }

  const projectedStations: ProjectedStation[] = stations.map((station) => ({
    ...station,
    point: expandCore(projector(station.lon, station.lat)),
    lines: [...(stationLineMap.get(station.abbr) || new Set<LineLabel>())].sort(
      (a, b) => LINE_META[a].order - LINE_META[b].order,
    ),
  }));
  let stationByAbbr = new Map(projectedStations.map((station) => [station.abbr, station]));

  const projectedRoutes: ProjectedRoute[] = routes.map((route) => {
    const baseShape = route.shape.map(([lon, lat]) => expandCore(projector(lon, lat)));
    const stationShape = route.stations.map((abbr) => stationByAbbr.get(abbr)?.point).filter(Boolean) as Point[];
    const displayShape = offsetPolyline(dedupeConsecutivePoints(stationShape), LINE_OFFSETS[route.label]);
    return {
      route,
      baseShape,
      displayShape,
      path: svgPath(displayShape),
      stationIndexes: stationIndexesForDisplay(route, stationShape),
    };
  });

  const adjustedStations = projectedStations.map((station) => ({
    ...station,
    point: displayPointForStation(station, projectedRoutes) || station.point,
  }));
  stationByAbbr = new Map(adjustedStations.map((station) => [station.abbr, station]));

  const routePoints = projectedRoutes.flatMap((route) => route.displayShape);
  const bounds = padBounds(boundsForPoints(routePoints), 30);
  return {
    stations: adjustedStations,
    stationByAbbr,
    routes: projectedRoutes,
    routeById: new Map(projectedRoutes.map((route) => [route.route.id, route])),
    bounds,
    fullView: bounds,
  };
}

function displayPointForStation(station: ProjectedStation, projectedRoutes: ProjectedRoute[]): Point | null {
  const points = projectedRoutes
    .filter(({ route }) => DISPLAY_ROUTE_IDS.has(route.id) && route.stations.includes(station.abbr))
    .map(({ displayShape }) => displayShape[closestPointIndex(displayShape, station.point)])
    .filter(Boolean);
  if (!points.length) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function expandCore(point: Point): Point {
  const center = { x: 620, y: 420 };
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const distance = Math.hypot(dx, dy);
  const radius = 410;
  if (distance >= radius || distance === 0) return point;
  const falloff = Math.cos((distance / radius) * (Math.PI / 2));
  const scale = 1 + 0.66 * falloff * falloff;
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

function dedupeConsecutivePoints(points: Point[]): Point[] {
  const output: Point[] = [];
  for (const point of points) {
    const previous = output[output.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.5) output.push(point);
  }
  return output;
}

function stationIndexesForDisplay(route: RouteShape, stationShape: Point[]): number[] {
  const indexes: number[] = [];
  let displayIndex = -1;
  let previous: Point | null = null;
  for (const point of stationShape) {
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.5) {
      displayIndex += 1;
      previous = point;
    }
    indexes.push(Math.max(0, displayIndex));
  }
  return indexes.length === route.stations.length ? indexes : route.stations.map((_, index) => Math.min(index, Math.max(0, displayIndex)));
}
