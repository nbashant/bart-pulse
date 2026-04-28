import { LINE_META, routes, stations } from '../data/gtfs';
import type { LineLabel, RouteShape, Station } from '../data/types';
import { cumulativeLengths, offsetPolyline, pointAlong, pointAtDistance, segmentSlice, svgPath, type PathPoint } from './polyline';
import { boundsForPoints, computeGeoBounds, makeProjector, padBounds, type Bounds, type Point } from './projection';

export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 1100;
export const DISPLAY_ROUTE_IDS = new Set(['1', '3', '5', '7', '11']);

const LINE_OFFSETS: Record<LineLabel, number> = {
  Yellow: 7.5,
  Red: 22.5,
  Orange: 7.5,
  Green: -7.5,
  Blue: 0,
  Airport: 0,
};
const BAY_FAIR_TO_LAKE = new Set(['BAYF', 'SANL', 'COLS', 'FTVL', 'LAKE']);
const SF_CORRIDOR = new Set(['WOAK', 'EMBR', 'MONT', 'POWL', 'CIVC', '16TH', '24TH', 'GLEN', 'BALB', 'DALY', 'COLM', 'SSAN', 'SBRN', 'SFIA', 'MLBR']);
const SCHEMATIC_STATION_POINTS: Record<string, Point> = {
  ANTC: { x: 1256, y: 154 },
  PCTR: { x: 1200, y: 144 },
  PITT: { x: 1144, y: 144 },
  NCON: { x: 1088, y: 158 },
  CONC: { x: 1044, y: 188 },
  PHIL: { x: 996, y: 216 },
  WCRK: { x: 942, y: 244 },
  LAFY: { x: 884, y: 270 },
  ORIN: { x: 822, y: 300 },
  ROCK: { x: 760, y: 334 },
  MCAR: { x: 706, y: 352 },
  '19TH': { x: 706, y: 398 },
  '12TH': { x: 706, y: 462 },
  LAKE: { x: 704, y: 494 },
  WOAK: { x: 594, y: 462 },
  EMBR: { x: 468, y: 462 },
  MONT: { x: 438, y: 492 },
  POWL: { x: 416, y: 522 },
  CIVC: { x: 402, y: 550 },
  '16TH': { x: 410, y: 596 },
  '24TH': { x: 414, y: 638 },
  GLEN: { x: 398, y: 660 },
  BALB: { x: 376, y: 704 },
  DALY: { x: 342, y: 750 },
  COLM: { x: 348, y: 790 },
  SSAN: { x: 394, y: 826 },
  SBRN: { x: 462, y: 866 },
  SFIA: { x: 548, y: 902 },
  MLBR: { x: 616, y: 934 },
  RICH: { x: 558, y: 178 },
  DELN: { x: 586, y: 212 },
  PLZA: { x: 614, y: 246 },
  NBRK: { x: 642, y: 280 },
  DBRK: { x: 670, y: 310 },
  ASHB: { x: 692, y: 332 },
  FTVL: { x: 744, y: 534 },
  COLS: { x: 796, y: 586 },
  SANL: { x: 846, y: 638 },
  BAYF: { x: 894, y: 690 },
  HAYW: { x: 946, y: 752 },
  SHAY: { x: 998, y: 814 },
  UCTY: { x: 1050, y: 876 },
  FRMT: { x: 1104, y: 938 },
  WARM: { x: 1168, y: 1008 },
  MLPT: { x: 1192, y: 1050 },
  BERY: { x: 1218, y: 1084 },
  CAST: { x: 976, y: 690 },
  WDUB: { x: 1100, y: 690 },
  DUBL: { x: 1230, y: 690 },
};

export type ProjectedStation = Station & {
  point: Point;
  lines: LineLabel[];
  marker: StationMarker;
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

export type StationMarker = {
  angle: number;
  length: number;
  lineCount: number;
  transfer: boolean;
};

export type RouteDistancePoint = PathPoint & {
  displayRouteId: string;
  distance: number;
  totalDistance: number;
  direction: 1 | -1;
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

export function routeDistancePoint(routeId: string, prevIdx: number, nextIdx: number, progress: number): RouteDistancePoint | null {
  const sourceRoute = networkGeometry.routeById.get(routeId);
  if (!sourceRoute) return null;
  const prevStop = sourceRoute.route.stations[prevIdx];
  const nextStop = sourceRoute.route.stations[nextIdx];
  if (!prevStop || !nextStop) return null;
  return routeDistancePointOnDisplayRoute(sourceRoute, prevStop, nextStop, progress);
}

export function routePointForStops(
  routeId: string,
  prevStop: string,
  nextStop: string,
  progress: number,
  displayRouteIds: Set<string>,
): PathPoint | null {
  const distancePoint = routeDistancePointForStops(routeId, prevStop, nextStop, progress, displayRouteIds);
  if (distancePoint) return distancePoint;
  const sourceRoute = networkGeometry.routeById.get(routeId);
  if (!sourceRoute) return null;
  return routePoint(routeId, sourceRoute.route.stations.indexOf(prevStop), sourceRoute.route.stations.indexOf(nextStop), progress);
}

export function routeDistancePointForStops(
  routeId: string,
  prevStop: string,
  nextStop: string,
  progress: number,
  displayRouteIds: Set<string>,
): RouteDistancePoint | null {
  const sourceRoute = networkGeometry.routeById.get(routeId);
  if (!sourceRoute) return null;

  const displayRoute = networkGeometry.routes.find(({ route }) => {
    if (route.label !== sourceRoute.route.label || !displayRouteIds.has(route.id)) return false;
    return route.stations.includes(prevStop) && route.stations.includes(nextStop);
  });
  return routeDistancePointOnDisplayRoute(displayRoute || sourceRoute, prevStop, nextStop, progress);
}

export function routePointAtDistance(displayRouteId: string, distance: number, direction: 1 | -1): PathPoint | null {
  const route = networkGeometry.routeById.get(displayRouteId);
  if (!route) return null;
  const point = pointAtDistance(route.displayShape, distance);
  return point ? { ...point, angle: angleForDirection(point.angle, direction) } : null;
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

export function stationPointForLine(abbr: string, line: LineLabel): Point | null {
  const route = networkGeometry.routes.find(({ route }) => DISPLAY_ROUTE_IDS.has(route.id) && route.label === line && route.stations.includes(abbr));
  if (!route) return null;
  const stationIndex = route.route.stations.indexOf(abbr);
  const displayIndex = route.stationIndexes[stationIndex];
  return route.displayShape[displayIndex] || null;
}

function routeDistancePointOnDisplayRoute(
  displayRoute: ProjectedRoute,
  prevStop: string,
  nextStop: string,
  progress: number,
): RouteDistancePoint | null {
  const from = displayRoute.route.stations.indexOf(prevStop);
  const to = displayRoute.route.stations.indexOf(nextStop);
  if (from < 0 || to < 0 || from === to) return null;
  const fromIndex = displayRoute.stationIndexes[from];
  const toIndex = displayRoute.stationIndexes[to];
  const lengths = cumulativeLengths(displayRoute.displayShape);
  const totalDistance = lengths[lengths.length - 1] || 0;
  const fromDistance = lengths[fromIndex];
  const toDistance = lengths[toIndex];
  if (!Number.isFinite(fromDistance) || !Number.isFinite(toDistance) || totalDistance <= 0) return null;

  const direction: 1 | -1 = toDistance >= fromDistance ? 1 : -1;
  const distance = fromDistance + (toDistance - fromDistance) * clamp(progress, 0, 1);
  const point = pointAtDistance(displayRoute.displayShape, distance);
  return point
    ? {
        ...point,
        angle: angleForDirection(point.angle, direction),
        displayRouteId: displayRoute.route.id,
        distance,
        totalDistance,
        direction,
      }
    : null;
}

function angleForDirection(angle: number, direction: 1 | -1): number {
  return direction === 1 ? angle : angle + 180;
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
    marker: defaultStationMarker(1),
  }));
  let stationByAbbr = new Map(projectedStations.map((station) => [station.abbr, station]));

  const projectedRoutes: ProjectedRoute[] = routes.map((route) => {
    const baseShape = route.shape.map(([lon, lat]) => expandCore(projector(lon, lat)));
    const stationShape = schematicStationShape(route, stationByAbbr);
    const displayInput = displayInputForRoute(route, stationShape);
    const displayShape = offsetPolyline(displayInput.points, displayInput.offsets);
    return {
      route,
      baseShape,
      displayShape,
      path: svgPath(displayShape),
      stationIndexes: displayInput.stationIndexes,
    };
  });

  const adjustedStations = projectedStations.map((station) => {
    const display = displayMarkerForStation(station, projectedRoutes);
    return {
      ...station,
      point: display?.point || station.point,
      marker: display?.marker || defaultStationMarker(station.lines.length),
    };
  });
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

function displayMarkerForStation(station: ProjectedStation, projectedRoutes: ProjectedRoute[]): { point: Point; marker: StationMarker } | null {
  const points = projectedRoutes
    .filter(({ route }) => DISPLAY_ROUTE_IDS.has(route.id) && route.stations.includes(station.abbr))
    .map(({ route, displayShape, stationIndexes }) => {
      const stationIndex = route.stations.indexOf(station.abbr);
      const displayIndex = stationIndexes[stationIndex];
      const point = displayShape[displayIndex];
      return point ? { ...point, angle: routeAngleAtIndex(displayShape, displayIndex), line: route.label } : null;
    })
    .filter((point): point is Point & { angle: number; line: LineLabel } => Boolean(point));
  if (!points.length) return null;
  const point = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  const lineCount = new Set(points.map((routePoint) => routePoint.line)).size || station.lines.length;
  const transfer = lineCount > 1;
  const markerAngle = transfer ? sharedStationAngle(points, point) : 0;
  const markerSpread = transfer ? spreadAlongAngle(points, point, markerAngle) : 0;
  return {
    point,
    marker: transfer
      ? {
          angle: markerAngle,
          length: sharedStationLength(lineCount, markerSpread),
          lineCount,
          transfer,
        }
      : defaultStationMarker(lineCount),
  };
}

function schematicStationShape(route: RouteShape, stationByAbbr: Map<string, ProjectedStation>): Point[] {
  return route.stations.map((abbr) => SCHEMATIC_STATION_POINTS[abbr] || stationByAbbr.get(abbr)?.point || { x: 0, y: 0 });
}

function defaultStationMarker(lineCount: number): StationMarker {
  return {
    angle: 0,
    length: 0,
    lineCount,
    transfer: lineCount > 1,
  };
}

function routeAngleAtIndex(points: Point[], index: number): number {
  const previous = points[Math.max(0, index - 1)];
  const next = points[Math.min(points.length - 1, index + 1)];
  return (Math.atan2(next.y - previous.y, next.x - previous.x) * 180) / Math.PI;
}

function sharedStationAngle(points: Array<Point & { angle: number }>, center: Point): number {
  const spreadAxis = principalAxis(points, center);
  if (spreadAxis !== null && spreadAlongAngle(points, center, spreadAxis) > 4) return spreadAxis;

  const orientation = meanLineOrientation(points.map((point) => point.angle));
  return normalizeAngle(orientation + 90);
}

function principalAxis(points: Point[], center: Point): number | null {
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  if (xx + yy < 1) return null;
  return normalizeAngle((Math.atan2(2 * xy, xx - yy) * 90) / Math.PI);
}

function spreadAlongAngle(points: Point[], center: Point, angle: number): number {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const projected = points.map((point) => (point.x - center.x) * cos + (point.y - center.y) * sin);
  return Math.max(...projected) - Math.min(...projected);
}

function meanLineOrientation(angles: number[]): number {
  const vector = angles.reduce(
    (sum, angle) => {
      const radians = (angle * Math.PI * 2) / 180;
      return {
        x: sum.x + Math.cos(radians),
        y: sum.y + Math.sin(radians),
      };
    },
    { x: 0, y: 0 },
  );
  return normalizeAngle((Math.atan2(vector.y, vector.x) * 90) / Math.PI);
}

function sharedStationLength(lineCount: number, spread: number): number {
  const base = lineCount >= 4 ? 42 : lineCount === 3 ? 34 : 24;
  return Math.min(58, Math.max(base, spread + 12));
}

function normalizeAngle(angle: number): number {
  let output = angle;
  while (output > 90) output -= 180;
  while (output <= -90) output += 180;
  return output;
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

function displayInputForRoute(route: RouteShape, stationShape: Point[]): { points: Point[]; offsets: number[]; stationIndexes: number[] } {
  const points: Point[] = [];
  const offsets: number[] = [];
  const stationIndexes: number[] = [];
  const routeOffsets = route.stations.map((abbr) => laneOffsetForStation(route, abbr));
  let displayIndex = -1;
  let previous: Point | null = null;

  stationShape.forEach((point, index) => {
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.5) {
      displayIndex += 1;
      points.push(point);
      offsets.push(routeOffsets[index]);
      previous = point;
    }
    stationIndexes.push(Math.max(0, displayIndex));
  });

  return { points, offsets, stationIndexes };
}

function laneOffsetForStation(route: RouteShape, abbr: string): number {
  if (route.id === '5' && SF_CORRIDOR.has(abbr)) return -22.5;
  if (route.id === '11' && SF_CORRIDOR.has(abbr)) return -7.5;
  if (route.id === '3' && BAY_FAIR_TO_LAKE.has(abbr)) return 15;
  if (route.id === '5' && BAY_FAIR_TO_LAKE.has(abbr)) return -15;
  if (route.id === '11' && BAY_FAIR_TO_LAKE.has(abbr)) return 0;
  return LINE_OFFSETS[route.label];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
