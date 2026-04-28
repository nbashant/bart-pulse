import { Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LINE_META, PRIORITY_LABEL_STATIONS, shortStationName, TERMINAL_STATIONS } from '../data/gtfs';
import type { InferredTrain, LineLabel } from '../data/types';
import {
  boundsForLine,
  boundsForStation,
  DISPLAY_ROUTE_IDS,
  MAP_HEIGHT,
  MAP_WIDTH,
  networkGeometry,
  routeDistancePoint,
  routeDistancePointForStops,
  routePointAtDistance,
  stationPointForLine,
  type RouteDistancePoint,
} from '../geometry/network';
import { fitBounds, type Bounds } from '../geometry/projection';
import { currentProgress } from '../inference/trains';

export type MapFocusRequest =
  | { seq: number; type: 'all' }
  | { seq: number; type: 'line'; line: LineLabel }
  | { seq: number; type: 'station'; abbr: string }
  | { seq: number; type: 'train'; trainId: string };
export type MapFocusInput =
  | { type: 'all' }
  | { type: 'line'; line: LineLabel }
  | { type: 'station'; abbr: string }
  | { type: 'train'; trainId: string };

type ViewBox = { x: number; y: number; w: number; h: number };
type TrainMapPoint = { x: number; y: number; angle: number };
type TrainObservation = RouteDistancePoint;
type StableTrainPlacement = TrainObservation & {
  updatedAt: number;
  routeId: string;
  line: LineLabel;
  destination: string;
  confidence: number;
  speed: number;
};

type BartMapProps = {
  activeLine: LineLabel | 'all';
  trains: InferredTrain[];
  selectedStation: string | null;
  selectedTrainId: string | null;
  loading: boolean;
  focusRequest: MapFocusRequest;
  onSelectStation: (abbr: string) => void;
  onSelectTrain: (id: string) => void;
  onClearSelection: () => void;
};

const MIN_VIEW_W = 260;
const MAX_VIEW_W = MAP_WIDTH;
const BASEMAP_HREF = '/assets/bay-map-texture-3x.jpg';
const BASEMAP_X = -260;
const BASEMAP_Y = -116;
const BASEMAP_W = MAP_WIDTH + 520;
const BASEMAP_H = 1327;
const BASEMAP_BACKFILL_W = BASEMAP_W + 2200;
const BASEMAP_BACKFILL_H = (BASEMAP_BACKFILL_W * BASEMAP_H) / BASEMAP_W;
const BASEMAP_BACKFILL_X = BASEMAP_X - (BASEMAP_BACKFILL_W - BASEMAP_W) / 2;
const BASEMAP_BACKFILL_Y = BASEMAP_Y - (BASEMAP_BACKFILL_H - BASEMAP_H) / 2;
const PAN_BLEED_X = 36;
const PAN_BLEED_Y = 36;
export function BartMap({
  activeLine,
  trains,
  selectedStation,
  selectedTrainId,
  loading,
  focusRequest,
  onSelectStation,
  onSelectTrain,
  onClearSelection,
}: BartMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointerRef = useRef<{ id: number; x: number; y: number; view: ViewBox; moved: boolean } | null>(null);
  const suppressMapClickRef = useRef(false);
  const lastFocusSeq = useRef<number | null>(null);
  const trainPlacementRef = useRef(new Map<string, StableTrainPlacement>());
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const [view, setView] = useState<ViewBox>(() => viewForBounds(networkGeometry.fullView, 1440, 900));
  const [tickedAt, setTickedAt] = useState(Date.now());
  const visibleLines = useMemo(() => new Set<LineLabel>(activeLine === 'all' ? ['Yellow', 'Red', 'Orange', 'Green', 'Blue'] : [activeLine]), [activeLine]);
  const visibleTrains = useMemo(() => trains.filter((train) => visibleLines.has(train.line)), [trains, visibleLines]);
  const visibleDisplayRoutes = useMemo(
    () => networkGeometry.routes.filter(({ route }) => visibleLines.has(route.label) && isDisplayRoute(route.id)),
    [visibleLines],
  );
  const trainPoints = useMemo(
    () => placeTrains(visibleTrains, selectedTrainId, tickedAt, activeLine === 'all', trainPlacementRef.current),
    [activeLine, visibleTrains, selectedTrainId, tickedAt],
  );

  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setViewport({ width: Math.max(1, width), height: Math.max(1, height) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) setTickedAt(Date.now());
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (lastFocusSeq.current === focusRequest.seq) return;
    lastFocusSeq.current = focusRequest.seq;
    if (focusRequest.type === 'all') {
      setView(viewForBounds(networkGeometry.fullView, viewport.width, viewport.height));
    } else if (focusRequest.type === 'line') {
      setView(viewForBounds(boundsForLine(focusRequest.line), viewport.width, viewport.height));
    } else if (focusRequest.type === 'station') {
      setView(viewForBounds(boundsForStation(focusRequest.abbr), viewport.width, viewport.height, 'focus'));
    } else {
      const trainPoint = trainPoints.find((item) => item.train.id === focusRequest.trainId);
      if (trainPoint) {
        const nextView = viewForBounds(pointBounds(trainPoint.point.x, trainPoint.point.y, 360), viewport.width, viewport.height, 'focus');
        setView(viewport.width < 520 ? clampView({ ...nextView, y: nextView.y + nextView.h * 0.13 }) : nextView);
      }
    }
  }, [focusRequest, viewport.height, viewport.width]);

  const setClampedView = useCallback((next: ViewBox) => setView(clampView(next)), []);

  const zoom = useCallback(
    (factor: number, anchor = center(view)) => {
      const w = Math.max(MIN_VIEW_W, Math.min(MAX_VIEW_W, view.w * factor));
      const h = w / (viewport.width / viewport.height);
      const rx = (anchor.x - view.x) / view.w;
      const ry = (anchor.y - view.y) / view.h;
      setClampedView({ x: anchor.x - w * rx, y: anchor.y - h * ry, w, h });
    },
    [setClampedView, view, viewport.height, viewport.width],
  );

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 0.86 : 1.16, clientToWorld(event.clientX, event.clientY, svgRef.current, view));
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest('[data-station-marker], [data-train-marker]')) return;
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add('is-panning');
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (Math.hypot(dx, dy) > 3) pointer.moved = true;
    setClampedView({
      ...pointer.view,
      x: pointer.view.x - dx * (pointer.view.w / rect.width),
      y: pointer.view.y - dy * (pointer.view.h / rect.height),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.classList.remove('is-panning');
    pointerRef.current = null;
    if (pointer.moved) {
      suppressMapClickRef.current = true;
      window.setTimeout(() => {
        suppressMapClickRef.current = false;
      }, 0);
      return;
    }
    onClearSelection();
  };

  const handleKeyActivate = (event: React.KeyboardEvent, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  };

  return (
    <main className="map-experience" aria-label="Geographic BART network map" data-testid="map-experience">
      <svg
        ref={svgRef}
        className="bart-map"
        data-testid="bart-map"
        role="img"
        aria-label="Live BART train map using GTFS route geometry"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(event) => {
          if (suppressMapClickRef.current) return;
          if (!(event.target as Element).closest('[data-station-marker], [data-train-marker]')) onClearSelection();
        }}
      >
        <defs>
          <filter id="mapLabelHalo" x="-20%" y="-20%" width="140%" height="140%">
            <feMorphology operator="dilate" radius="1.7" in="SourceAlpha" result="halo" />
            <feFlood floodColor="#f8f5ea" floodOpacity="0.94" result="haloColor" />
            <feComposite in="haloColor" in2="halo" operator="in" result="stroke" />
            <feMerge>
              <feMergeNode in="stroke" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="mapWater" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#f0eadc" />
            <stop offset="62%" stopColor="#e8e2d4" />
            <stop offset="100%" stopColor="#dbe4d7" />
          </radialGradient>
          <linearGradient id="trainBodyGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbfffd" />
            <stop offset="52%" stopColor="#dce7e7" />
            <stop offset="100%" stopColor="#aebec0" />
          </linearGradient>
          <linearGradient id="trainCabGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#122433" />
            <stop offset="100%" stopColor="#071019" />
          </linearGradient>
          <filter id="selectedTrainGlow" x="-90%" y="-140%" width="280%" height="380%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="map-base" x={BASEMAP_BACKFILL_X} y={BASEMAP_BACKFILL_Y} width={BASEMAP_BACKFILL_W} height={BASEMAP_BACKFILL_H} />
        <image className="bay-texture-backfill" href={BASEMAP_HREF} x={BASEMAP_BACKFILL_X} y={BASEMAP_BACKFILL_Y} width={BASEMAP_BACKFILL_W} height={BASEMAP_BACKFILL_H} preserveAspectRatio="xMidYMid meet" />
        <image className="bay-texture" href={BASEMAP_HREF} x={BASEMAP_X} y={BASEMAP_Y} width={BASEMAP_W} height={BASEMAP_H} preserveAspectRatio="xMidYMid meet" />
        <rect className="basemap-wash" x={BASEMAP_BACKFILL_X} y={BASEMAP_BACKFILL_Y} width={BASEMAP_BACKFILL_W} height={BASEMAP_BACKFILL_H} />
        <path className="bay-crossing" d="M418 463 C512 440 594 425 681 432" />
        <text className="region-label" x="242" y="484">San Francisco</text>
        <text className="region-label" x="720" y="375">Oakland</text>
        <text className="region-label" x="1035" y="206">Contra Costa</text>
        <text className="region-label" x="1115" y="570">Tri-Valley</text>
        <text className="region-label" x="910" y="945">South Bay</text>

        <g className="route-corridors">
          {visibleDisplayRoutes.map(({ route, path }) => (
              <path key={`corridor-${route.id}`} className="route-corridor" d={path} stroke={LINE_META[route.label].accessibleColor} />
            ))}
        </g>
        <g className="route-beds">
          {visibleDisplayRoutes.map(({ route, path }) => (
              <path key={`bed-${route.id}`} className="route-bed" d={path} data-testid={`route-bed-${route.label}`} />
            ))}
        </g>
        <g className="route-lines">
          {visibleDisplayRoutes.map(({ route, path }) => (
              <path
                key={route.id}
                className={`route-line ${selectedTrainId || selectedStation ? 'quiet' : ''}`}
                d={path}
                stroke={LINE_META[route.label].accessibleColor}
                data-testid={`route-path-${route.label}`}
              />
            ))}
        </g>
        <g className="route-highlights">
          {visibleDisplayRoutes.map(({ route, path }) => (
              <path key={`highlight-${route.id}`} className="route-highlight" d={path} />
            ))}
        </g>
        <g className="station-layer">
          {networkGeometry.stations
            .filter((station) => station.lines.some((line) => visibleLines.has(line)))
            .map((station) => {
              const selected = selectedStation === station.abbr;
              const transfer = activeLine === 'all' && station.marker.transfer && station.marker.length > 0;
              const terminal = TERMINAL_STATIONS.has(station.abbr);
              const showLabel = selected || PRIORITY_LABEL_STATIONS.has(station.abbr);
              const markerLength = station.marker.length;
              const point = activeLine === 'all' ? station.point : stationPointForLine(station.abbr, activeLine) || station.point;
              return (
                <g key={station.abbr} className="station-item">
                  <g
                    className={`station-marker ${selected ? 'selected' : ''} ${transfer ? 'transfer shared' : ''} ${terminal ? 'terminal' : ''}`}
                    data-testid={`station-marker-${station.abbr}`}
                    data-station-marker
                    role="button"
                    tabIndex={selected ? 0 : -1}
                    aria-label={`${station.name} station`}
                    transform={`translate(${point.x} ${point.y}) rotate(${transfer ? station.marker.angle : 0})`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectStation(station.abbr);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                    onKeyDown={(event) => handleKeyActivate(event, () => onSelectStation(station.abbr))}
                  >
                    {transfer ? (
                      <>
                        <rect className="station-shared-hit" x={-markerLength / 2 - 7} y="-13" width={markerLength + 14} height="26" rx="13" />
                        <rect className="station-shared-halo" x={-markerLength / 2 - 2.5} y="-6.8" width={markerLength + 5} height="13.6" rx="6.8" />
                        <rect className="station-shared-body" x={-markerLength / 2} y="-4.4" width={markerLength} height="8.8" rx="4.4" />
                      </>
                    ) : (
                      <>
                        <circle className="station-hit" r="18" />
                        <circle className="station-halo" r={terminal ? 10.7 : 7.1} />
                        <circle className="station-outer" r={terminal ? 7.8 : 4.7} />
                      </>
                    )}
                  </g>
                  {showLabel ? (
                    <text
                      className="station-label"
                      x={point.x + labelOffset(station.abbr).x}
                      y={point.y + labelOffset(station.abbr).y}
                      filter="url(#mapLabelHalo)"
                    >
                      {shortStationName(station)}
                    </text>
                  ) : null}
                </g>
              );
            })}
        </g>
        <g className="train-layer">
          {trainPoints.map(({ train, point, offset }) => {
            const selected = selectedTrainId === train.id;
            return (
              <g
                key={train.id}
                className={`train-marker ${selected ? 'selected' : ''} ${train.confidence < 0.55 ? 'low-confidence' : ''} ${train.delaySec > 60 ? 'delayed' : ''}`}
                data-testid={`train-marker-${train.id}`}
                data-train-marker
                role="button"
                tabIndex={selected ? 0 : -1}
                aria-label={`${train.line} line train to ${train.destinationName}`}
                transform={`translate(${point.x + offset.x} ${point.y + offset.y}) rotate(${point.angle})`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectTrain(train.id);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
                onKeyDown={(event) => handleKeyActivate(event, () => onSelectTrain(train.id))}
              >
                <rect className="train-hit" x="-23" y="-16" width="46" height="32" rx="16" />
                <rect className="train-selected-glow" x="-16" y="-10" width="32" height="20" rx="10" fill={LINE_META[train.line].accessibleColor} />
                <rect className="train-shadow" x="-14" y="-8" width="28" height="16" rx="8" />
                <rect className="train-body" x="-12.5" y="-6.5" width="25" height="13" rx="6.5" />
                <rect className="train-accent" x="-9.5" y="4.1" width="15" height="2.4" rx="1.2" fill={LINE_META[train.line].accessibleColor} />
                <rect className="train-window-strip" x="-8.3" y="-3.5" width="10" height="5.4" rx="2.7" />
                <rect className="train-cab" x="3.7" y="-5.2" width="8.3" height="10.4" rx="4.1" />
                <circle className="train-headlight upper" cx="8.5" cy="-2.7" r="1.15" />
                <circle className="train-headlight lower" cx="8.5" cy="2.7" r="1.15" />
                {train.delaySec > 60 ? <circle className="train-delay-dot" cx="-9.2" cy="-4.5" r="2.1" /> : null}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="map-toolbar" aria-label="Map controls" data-testid="map-toolbar">
        <button className="map-icon-button" type="button" aria-label="Zoom in" data-testid="zoom-in-button" onClick={() => zoom(0.78)}>
          <Plus size={18} aria-hidden="true" />
        </button>
        <button className="map-icon-button" type="button" aria-label="Zoom out" data-testid="zoom-out-button" onClick={() => zoom(1.24)}>
          <Minus size={18} aria-hidden="true" />
        </button>
        <button
          className="map-icon-button"
          type="button"
          aria-label="Fit full BART network"
          data-testid="fit-map-button"
          onClick={() => setView(viewForBounds(activeLine === 'all' ? networkGeometry.fullView : boundsForLine(activeLine), viewport.width, viewport.height))}
        >
          <Maximize2 size={17} aria-hidden="true" />
        </button>
      </div>

      {loading ? <div className="map-loading" data-testid="loading-state">Loading BART feed</div> : null}
      {!loading && !visibleTrains.length ? <div className="map-empty" data-testid="no-train-state">No trains to place safely</div> : null}
    </main>
  );
}

function placeTrains(
  trains: InferredTrain[],
  selectedTrainId: string | null,
  now: number,
  overviewMode: boolean,
  placementCache: Map<string, StableTrainPlacement>,
) {
  const claimedKeys = new Set<string>();
  const raw = trains
    .map((train) => {
      const progress = currentProgress(train, now);
      const observation =
        routeDistancePointForStops(train.routeId, train.prevStop, train.nextStop, progress, DISPLAY_ROUTE_IDS) ||
        routeDistancePoint(train.routeId, train.prevIdx, train.nextIdx, progress);
      if (!observation) return null;
      const placement = stabilizeTrainPoint(train, observation, now, placementCache, claimedKeys);
      return { train, point: placement.point, cacheKey: placement.cacheKey };
    })
    .filter(Boolean) as Array<{ train: InferredTrain; point: TrainMapPoint; cacheKey: string }>;

  for (const [key, value] of placementCache.entries()) {
    if (!claimedKeys.has(key) || now - value.updatedAt > 90_000) placementCache.delete(key);
  }

  const buckets = new Map<string, typeof raw>();
  for (const item of raw) {
    const key = `${Math.round(item.point.x / 26)}:${Math.round(item.point.y / 26)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)?.push(item);
  }

  const placed = [...buckets.values()].flatMap((bucket) =>
    bucket
      .sort((a, b) => {
        if (a.train.id === selectedTrainId) return -1;
        if (b.train.id === selectedTrainId) return 1;
        return b.train.confidence - a.train.confidence;
      })
      .map((item, index, visible) => {
        const spread = spreadFor(index, visible.length, overviewMode);
        const radians = ((item.point.angle + 90) * Math.PI) / 180;
        return {
          ...item,
          offset: {
            x: Math.cos(radians) * spread,
            y: Math.sin(radians) * spread,
          },
        };
      }),
  );

  return placed
    .sort((a, b) => {
      if (a.train.id === selectedTrainId) return -1;
      if (b.train.id === selectedTrainId) return 1;
      return b.train.confidence - a.train.confidence;
    });
}

function viewForBounds(bounds: Bounds, width: number, height: number, mode: 'network' | 'focus' = 'network'): ViewBox {
  const fit = fitBounds(bounds, width, height, width < 520 ? 92 : 70);
  if (width < 520 && mode === 'network') fit.y -= fit.h * 0.48;
  return clampView(fit);
}

function pointBounds(x: number, y: number, radius: number): Bounds {
  return { minX: x - radius, minY: y - radius, maxX: x + radius, maxY: y + radius };
}

function clampView(view: ViewBox): ViewBox {
  const w = Math.max(MIN_VIEW_W, Math.min(MAX_VIEW_W, view.w));
  const h = Math.max(1, view.h);
  const minX = BASEMAP_BACKFILL_X - PAN_BLEED_X;
  const maxX = BASEMAP_BACKFILL_X + BASEMAP_BACKFILL_W + PAN_BLEED_X;
  const minY = BASEMAP_BACKFILL_Y - PAN_BLEED_Y;
  const maxY = BASEMAP_BACKFILL_Y + BASEMAP_BACKFILL_H + PAN_BLEED_Y;
  return {
    x: clampAxis(view.x, w, minX, maxX),
    y: clampAxis(view.y, h, minY, maxY),
    w,
    h,
  };
}

function clampAxis(start: number, size: number, min: number, max: number): number {
  const maxStart = max - size;
  if (maxStart < min) return min + (max - min - size) / 2;
  return Math.max(min, Math.min(maxStart, start));
}

function clientToWorld(clientX: number, clientY: number, svg: SVGSVGElement | null, view: ViewBox) {
  const rect = svg?.getBoundingClientRect();
  if (!rect) return center(view);
  return {
    x: view.x + ((clientX - rect.left) / rect.width) * view.w,
    y: view.y + ((clientY - rect.top) / rect.height) * view.h,
  };
}

function center(view: ViewBox) {
  return { x: view.x + view.w / 2, y: view.y + view.h / 2 };
}

function spreadFor(index: number, count: number, overviewMode: boolean): number {
  if (count <= 1) return 0;
  if (index === 0) return 0;
  const spacing = overviewMode ? 4.2 : 4.8;
  const magnitude = Math.ceil(index / 2) * spacing;
  return index % 2 === 0 ? magnitude : -magnitude;
}

function stabilizeTrainPoint(
  train: InferredTrain,
  observation: TrainObservation,
  now: number,
  placementCache: Map<string, StableTrainPlacement>,
  claimedKeys: Set<string>,
): { point: TrainMapPoint; cacheKey: string } {
  const key = stableTrainKey(train);
  const sourceKey = findCompatibleTrackKey(train, observation, key, placementCache, claimedKeys, now);
  const previous = placementCache.get(sourceKey);
  if (!previous || !sameTrack(previous, observation) || now - previous.updatedAt > 90_000) {
    const point = projectObservation(observation) || observation;
    placementCache.set(key, {
      ...observation,
      ...point,
      updatedAt: now,
      routeId: train.routeId,
      line: train.line,
      destination: train.destination,
      confidence: train.confidence,
      speed: 0,
    });
    if (sourceKey !== key) placementCache.delete(sourceKey);
    claimedKeys.add(key);
    return { point, cacheKey: key };
  }

  const elapsedSec = Math.max(0.25, Math.min(8, (now - previous.updatedAt) / 1000));
  const signedDelta = (observation.distance - previous.distance) * previous.direction;
  const absoluteDelta = Math.abs(observation.distance - previous.distance);
  if (absoluteDelta > 330) {
    const point = projectObservation(observation) || observation;
    placementCache.set(key, {
      ...observation,
      ...point,
      updatedAt: now,
      routeId: train.routeId,
      line: train.line,
      destination: train.destination,
      confidence: train.confidence,
      speed: 0,
    });
    if (sourceKey !== key) placementCache.delete(sourceKey);
    claimedKeys.add(key);
    return { point, cacheKey: key };
  }

  const backwardTolerance = 18;
  const hasStrongerEvidence = train.confidence >= previous.confidence + 0.18;
  const predictedDistance = previous.distance + previous.direction * Math.min(Math.max(previous.speed, 0.08), 1.8) * elapsedSec;
  let nextDistance = observation.distance;
  let acceptedDelta = signedDelta;

  if (signedDelta < -backwardTolerance && !hasStrongerEvidence) {
    nextDistance = predictedDistance;
    acceptedDelta = Math.max(0, (nextDistance - previous.distance) * previous.direction);
  } else if (signedDelta < -backwardTolerance) {
    nextDistance = previous.distance + (observation.distance - previous.distance) * 0.35;
    acceptedDelta = Math.max(0, (nextDistance - previous.distance) * previous.direction);
  } else {
    const maxForward = 74 + elapsedSec * 12;
    if (signedDelta > maxForward) {
      nextDistance = previous.distance + previous.direction * maxForward;
      acceptedDelta = maxForward;
    }
  }

  nextDistance = clamp(nextDistance, 0, observation.totalDistance);
  const snapped = routePointAtDistance(observation.displayRouteId, nextDistance, observation.direction) || observation;
  const point = {
    x: snapped.x,
    y: snapped.y,
    angle: stabilizeAngle(snapped.angle, previous.angle, elapsedSec),
  };
  const observedSpeed = Math.max(0, acceptedDelta / elapsedSec);
  placementCache.set(key, {
    ...observation,
    ...point,
    distance: nextDistance,
    updatedAt: now,
    routeId: train.routeId,
    line: train.line,
    destination: train.destination,
    confidence: train.confidence,
    speed: previous.speed * 0.62 + observedSpeed * 0.38,
  });
  if (sourceKey !== key) placementCache.delete(sourceKey);
  claimedKeys.add(key);
  return { point, cacheKey: key };
}

function projectObservation(observation: TrainObservation): TrainMapPoint | null {
  return routePointAtDistance(observation.displayRouteId, observation.distance, observation.direction);
}

function findCompatibleTrackKey(
  train: InferredTrain,
  observation: TrainObservation,
  key: string,
  placementCache: Map<string, StableTrainPlacement>,
  claimedKeys: Set<string>,
  now: number,
): string {
  const exact = placementCache.get(key);
  const exactGap = exact && sameTrack(exact, observation) ? Math.abs(exact.distance - observation.distance) : Infinity;
  if (exact && !claimedKeys.has(key) && exactGap < 180) return key;

  let bestKey = exact && !claimedKeys.has(key) ? key : '';
  let bestGap = exactGap;
  for (const [candidateKey, placement] of placementCache.entries()) {
    if (candidateKey === key || claimedKeys.has(candidateKey) || now - placement.updatedAt > 90_000) continue;
    if (placement.line !== train.line || placement.destination !== train.destination) continue;
    if (!sameTrack(placement, observation)) continue;
    const gap = Math.abs(placement.distance - observation.distance);
    if (gap < Math.min(bestGap, 180)) {
      bestKey = candidateKey;
      bestGap = gap;
    }
  }
  return bestKey || key;
}

function sameTrack(previous: StableTrainPlacement, observation: TrainObservation): boolean {
  return previous.displayRouteId === observation.displayRouteId && previous.direction === observation.direction;
}

function stableTrainKey(train: InferredTrain): string {
  const idParts = train.id.split(':');
  const cluster = idParts[idParts.length - 1] || '0';
  return [train.routeId, train.destination, train.direction || 'dir', cluster].join(':');
}

function stabilizeAngle(rawAngle: number, previousAngle: number, elapsedSec: number): number {
  const candidate = nearestEquivalentAngle(rawAngle, previousAngle);
  const maxTurn = 40 + elapsedSec * 35;
  return previousAngle + clamp(candidate - previousAngle, -maxTurn, maxTurn);
}

function nearestEquivalentAngle(angle: number, reference: number): number {
  let adjusted = angle;
  while (adjusted - reference > 180) adjusted -= 360;
  while (adjusted - reference < -180) adjusted += 360;
  return adjusted;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function labelOffset(abbr: string) {
  if (['RICH', 'ANTC', 'BERY', 'DUBL'].includes(abbr)) return { x: 11, y: -11 };
  if (['MLBR', 'SFIA', 'SBRN', 'DALY'].includes(abbr)) return { x: 12, y: 17 };
  if (['EMBR', 'MONT', 'POWL', 'CIVC'].includes(abbr)) return { x: -12, y: -10 };
  return { x: 10, y: -10 };
}

function isDisplayRoute(routeId: string): boolean {
  return DISPLAY_ROUTE_IDS.has(routeId);
}
