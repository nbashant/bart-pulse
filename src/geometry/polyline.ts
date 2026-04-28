import type { Point } from './projection';

export type PathPoint = Point & { angle: number };

export function offsetPolyline(points: Point[], offset: number | number[]): Point[] {
  if (points.length < 2) return points;
  if (!Array.isArray(offset) && !offset) return points;
  return points.map((point, index) => offsetPoint(points, index, offsetAt(offset, index)));
}

export function svgPath(points: Point[]): string {
  if (!points.length) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)},${round(point.y)}`)
    .join(' ');
}

export function pointAlong(points: Point[], progress: number): PathPoint | null {
  if (points.length < 2) return null;
  const lengths = cumulativeLengths(points);
  const total = lengths[lengths.length - 1];
  if (total <= 0) return { ...points[0], angle: 0 };
  return pointAtDistance(points, clamp(progress, 0, 1) * total);
}

export function pointAtDistance(points: Point[], distance: number): PathPoint | null {
  if (points.length < 2) return null;
  const lengths = cumulativeLengths(points);
  const total = lengths[lengths.length - 1];
  if (total <= 0) return { ...points[0], angle: 0 };
  const target = clamp(distance, 0, total);
  let index = 1;
  while (index < lengths.length && lengths[index] < target) index += 1;
  const prev = points[index - 1];
  const next = points[index] || prev;
  const segStart = lengths[index - 1];
  const segLen = Math.max(0.00001, lengths[index] - segStart);
  const local = (target - segStart) / segLen;
  return {
    x: prev.x + (next.x - prev.x) * local,
    y: prev.y + (next.y - prev.y) * local,
    angle: (Math.atan2(next.y - prev.y, next.x - prev.x) * 180) / Math.PI,
  };
}

export function cumulativeLengths(points: Point[]): number[] {
  const output = [0];
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    output.push(output[index - 1] + Math.hypot(next.x - prev.x, next.y - prev.y));
  }
  return output;
}

export function closestPointIndex(points: Point[], target: Point, startIndex = 0): number {
  let bestIndex = Math.max(0, startIndex);
  let bestDistance = Infinity;
  for (let index = Math.max(0, startIndex); index < points.length; index += 1) {
    const point = points[index];
    const distance = squaredDistance(point, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function segmentSlice(points: Point[], fromIndex: number, toIndex: number): Point[] {
  if (!points.length) return [];
  if (fromIndex === toIndex) return [points[fromIndex]];
  const start = Math.max(0, Math.min(fromIndex, points.length - 1));
  const end = Math.max(0, Math.min(toIndex, points.length - 1));
  const slice = points.slice(Math.min(start, end), Math.max(start, end) + 1);
  return start <= end ? slice : slice.reverse();
}

function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function offsetAt(offset: number | number[], index: number): number {
  return Array.isArray(offset) ? offset[Math.min(index, offset.length - 1)] || 0 : offset;
}

function offsetPoint(points: Point[], index: number, offset: number): Point {
  const point = points[index];
  const previous = points[index - 1];
  const next = points[index + 1];

  if (!previous && next) return offsetFromSegment(point, next, offset);
  if (previous && !next) return offsetFromSegment(previous, point, offset, point);
  if (!previous || !next) return point;

  const prevOffsetStart = offsetFromSegment(previous, point, offset);
  const prevOffsetEnd = offsetFromSegment(previous, point, offset, point);
  const nextOffsetStart = offsetFromSegment(point, next, offset);
  const nextOffsetEnd = offsetFromSegment(point, next, offset, next);
  const intersection = lineIntersection(prevOffsetStart, prevOffsetEnd, nextOffsetStart, nextOffsetEnd);

  if (intersection && Math.hypot(intersection.x - point.x, intersection.y - point.y) <= Math.abs(offset) * 4) {
    return intersection;
  }

  const fallback = offsetFromSegment(previous, next, offset, point);
  return fallback;
}

function offsetFromSegment(start: Point, end: Point, offset: number, point = start): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: point.x + (-dy / len) * offset,
    y: point.y + (dx / len) * offset,
  };
}

function lineIntersection(aStart: Point, aEnd: Point, bStart: Point, bEnd: Point): Point | null {
  const aDx = aEnd.x - aStart.x;
  const aDy = aEnd.y - aStart.y;
  const bDx = bEnd.x - bStart.x;
  const bDy = bEnd.y - bStart.y;
  const determinant = aDx * bDy - aDy * bDx;
  if (Math.abs(determinant) < 0.0001) return null;

  const t = ((bStart.x - aStart.x) * bDy - (bStart.y - aStart.y) * bDx) / determinant;
  return {
    x: aStart.x + t * aDx,
    y: aStart.y + t * aDy,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
