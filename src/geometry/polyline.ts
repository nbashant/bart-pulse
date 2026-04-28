import type { Point } from './projection';

export type PathPoint = Point & { angle: number };

export function offsetPolyline(points: Point[], offset: number): Point[] {
  if (!offset || points.length < 2) return points;
  return points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (-dy / len) * offset,
      y: point.y + (dx / len) * offset,
    };
  });
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
  const target = clamp(progress, 0, 1) * total;
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

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
