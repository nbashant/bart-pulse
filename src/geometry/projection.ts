import type { RouteShape, Station } from '../data/types';

export type Point = { x: number; y: number };
export type GeoPoint = readonly [number, number];
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const TILE_SIZE = 256;

export function mercator(lon: number, lat: number): Point {
  const sin = Math.sin((lat * Math.PI) / 180);
  const x = ((lon + 180) / 360) * TILE_SIZE;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE_SIZE;
  return { x, y };
}

export function computeGeoBounds(routes: RouteShape[], stations: Station[]): Bounds {
  const points: Point[] = [];
  for (const route of routes) {
    for (const [lon, lat] of route.shape) points.push(mercator(lon, lat));
  }
  for (const station of stations) points.push(mercator(station.lon, station.lat));
  return boundsForPoints(points);
}

export function makeProjector(bounds: Bounds, width: number, height: number, padding: number) {
  const rangeX = Math.max(0.000001, bounds.maxX - bounds.minX);
  const rangeY = Math.max(0.000001, bounds.maxY - bounds.minY);
  const scale = Math.min((width - padding * 2) / rangeX, (height - padding * 2) / rangeY);
  const projectedW = rangeX * scale;
  const projectedH = rangeY * scale;
  const offsetX = (width - projectedW) / 2;
  const offsetY = (height - projectedH) / 2;

  return (lon: number, lat: number): Point => {
    const p = mercator(lon, lat);
    return {
      x: offsetX + (p.x - bounds.minX) * scale,
      y: offsetY + (p.y - bounds.minY) * scale,
    };
  };
}

export function boundsForPoints(points: Point[]): Bounds {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function padBounds(bounds: Bounds, padding: number): Bounds {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}

export function fitBounds(bounds: Bounds, viewportW: number, viewportH: number, margin: number) {
  let x = bounds.minX - margin;
  let y = bounds.minY - margin;
  let w = bounds.maxX - bounds.minX + margin * 2;
  let h = bounds.maxY - bounds.minY + margin * 2;
  const targetAspect = viewportW / viewportH;
  const boundsAspect = w / h;

  if (boundsAspect > targetAspect) {
    const desiredH = w / targetAspect;
    y -= (desiredH - h) / 2;
    h = desiredH;
  } else {
    const desiredW = h * targetAspect;
    x -= (desiredW - w) / 2;
    w = desiredW;
  }

  return { x, y, w, h };
}
