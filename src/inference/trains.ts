import { displayStationName, LINE_META, routes, stationByAbbr } from '../data/gtfs';
import type { EtdEstimate, InferredTrain, LineLabel, RouteShape, StationDepartures } from '../data/types';

type Candidate = Omit<InferredTrain, 'id' | 'confidence' | 'members' | 'inferred'> & {
  clusterKey: string;
};

const MAX_LOOKBACK_MINUTES = 32;
const CLUSTER_WINDOW_SEC = 180;

export function inferTrains(stationDepartures: StationDepartures, receivedAt: number): InferredTrain[] {
  const candidates: Candidate[] = [];

  for (const route of routes) {
    for (let stationIndex = 0; stationIndex < route.stations.length; stationIndex += 1) {
      const station = route.stations[stationIndex];
      const estimates = (stationDepartures.get(station) || []).filter((estimate) => estimate.color === LINE_META[route.label].accessibleColor);
      for (const estimate of estimates) {
        const destinationIndex = findNextIndex(route.stations, estimate.dest, stationIndex);
        if (destinationIndex <= stationIndex) continue;
        const candidate = candidateForEstimate(route, stationIndex, destinationIndex, estimate, receivedAt);
        if (candidate) candidates.push(candidate);
      }
    }
  }

  const byKey = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.routeId}:${candidate.destination}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)?.push(candidate);
  }

  const trains: InferredTrain[] = [];
  for (const [key, group] of byKey.entries()) {
    group.sort((a, b) => a.timeToDestination - b.timeToDestination);
    const clusters: Candidate[][] = [];
    for (const candidate of group) {
      const cluster = clusters[clusters.length - 1];
      const reference = cluster?.[0];
      if (
        cluster &&
        reference &&
        Math.abs(candidate.timeToDestination - average(cluster.map((item) => item.timeToDestination))) <= CLUSTER_WINDOW_SEC
      ) {
        cluster.push(candidate);
      } else {
        clusters.push([candidate]);
      }
    }

    clusters.forEach((cluster, clusterIndex) => {
      const representative = chooseRepresentative(cluster);
      const confidence = Math.min(0.96, 0.38 + cluster.length * 0.15 + (sameSegmentCount(cluster, representative) - 1) * 0.08);
      if (confidence < 0.32) return;
      trains.push({
        ...representative,
        id: `${key}:${Math.round(average(cluster.map((item) => item.timeToDestination)) / 30)}:${clusterIndex}`,
        confidence,
        members: cluster.length,
        inferred: true,
      });
    });
  }

  return trains.sort((a, b) => LINE_META[a.line].order - LINE_META[b.line].order || a.timeToDestination - b.timeToDestination);
}

export function currentProgress(train: InferredTrain, now = Date.now()): number {
  const elapsed = Math.max(0, (now - train.receivedAt) / 1000);
  const segmentTravel = Math.max(45, segmentTravelFor(train));
  return clamp(train.progress + elapsed / segmentTravel, 0, 1);
}

export function currentEtaSec(train: InferredTrain, now = Date.now()): number {
  return Math.max(0, train.etaSec - (now - train.receivedAt) / 1000);
}

function candidateForEstimate(
  route: RouteShape,
  stationIndex: number,
  destinationIndex: number,
  estimate: EtdEstimate,
  receivedAt: number,
): Candidate | null {
  if (estimate.minutes > MAX_LOOKBACK_MINUTES) return null;
  if (!isLine(estimate.line) || estimate.line !== route.label) return null;

  let targetIndex = stationIndex;
  let remaining = estimate.minutes * 60;

  while (remaining > 0 && targetIndex > 0) {
    const prevIndex = targetIndex - 1;
    const travel = Math.max(45, route.segTravel[prevIndex] || 150);
    if (remaining <= travel) {
      const progress = clamp(1 - remaining / travel, 0, 1);
      const timeToDestination = estimate.minutes * 60 + travelSecondsBetween(route, stationIndex, destinationIndex);
      return {
        clusterKey: `${route.id}:${estimate.dest}:${prevIndex}:${targetIndex}`,
        routeId: route.id,
        line: route.label,
        color: LINE_META[route.label].accessibleColor,
        destination: estimate.dest,
        destinationName: stationByAbbr.get(estimate.dest)?.name || estimate.destination || estimate.dest,
        prevStop: route.stations[prevIndex],
        nextStop: route.stations[targetIndex],
        prevIdx: prevIndex,
        nextIdx: targetIndex,
        progress,
        etaSec: estimate.minutes * 60,
        timeToDestination,
        delaySec: estimate.delaySec,
        length: estimate.length,
        platform: estimate.platform,
        direction: estimate.direction,
        receivedAt,
      };
    }
    remaining -= travel;
    targetIndex = prevIndex;
  }

  if (estimate.minutes === 0 && stationIndex < destinationIndex) {
    return {
      clusterKey: `${route.id}:${estimate.dest}:${stationIndex}:${stationIndex + 1}`,
      routeId: route.id,
      line: route.label,
      color: LINE_META[route.label].accessibleColor,
      destination: estimate.dest,
      destinationName: displayStationName(estimate.dest),
      prevStop: route.stations[stationIndex],
      nextStop: route.stations[stationIndex + 1],
      prevIdx: stationIndex,
      nextIdx: stationIndex + 1,
      progress: 0.08,
      etaSec: 0,
      timeToDestination: travelSecondsBetween(route, stationIndex, destinationIndex),
      delaySec: estimate.delaySec,
      length: estimate.length,
      platform: estimate.platform,
      direction: estimate.direction,
      receivedAt,
    };
  }

  return null;
}

function chooseRepresentative(candidates: Candidate[]): Candidate {
  return candidates.reduce((best, item) => {
    if (!best) return item;
    if (item.nextIdx > best.nextIdx) return item;
    if (item.nextIdx === best.nextIdx && item.etaSec < best.etaSec) return item;
    return best;
  }, candidates[0]);
}

function sameSegmentCount(candidates: Candidate[], representative: Candidate): number {
  return candidates.filter((item) => item.prevIdx === representative.prevIdx && item.nextIdx === representative.nextIdx).length;
}

function findNextIndex(stations: readonly string[], dest: string, fromIndex: number): number {
  for (let index = fromIndex + 1; index < stations.length; index += 1) {
    if (stations[index] === dest) return index;
  }
  return -1;
}

function travelSecondsBetween(route: RouteShape, fromIndex: number, toIndex: number): number {
  return route.segTravel
    .slice(fromIndex, toIndex)
    .reduce((sum, seconds) => sum + Math.max(45, seconds || 150), 0);
}

function segmentTravelFor(train: InferredTrain): number {
  const route = routes.find((candidate) => candidate.id === train.routeId);
  return route?.segTravel[train.prevIdx] || 150;
}

function isLine(line: EtdEstimate['line']): line is LineLabel {
  return line !== 'Unknown';
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
