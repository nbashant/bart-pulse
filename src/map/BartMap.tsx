import { Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LINE_META, PRIORITY_LABEL_STATIONS, shortStationName, TERMINAL_STATIONS, TRANSFER_STATIONS } from '../data/gtfs';
import type { InferredTrain, LineLabel } from '../data/types';
import {
  boundsForLine,
  boundsForStation,
  DISPLAY_ROUTE_IDS,
  MAP_HEIGHT,
  MAP_WIDTH,
  networkGeometry,
  routePoint,
  routePointForStops,
  stationLabelPriority,
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
type StableTrainPlacement = TrainMapPoint & { updatedAt: number };

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
        const nextView = viewForBounds(pointBounds(trainPoint.point.x, trainPoint.point.y, 180), viewport.width, viewport.height, 'focus');
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
        <rect className="map-base" x="-260" y="-150" width={MAP_WIDTH + 520} height={MAP_HEIGHT + 460} />
        <image className="bay-texture" href="/assets/bay-map-texture.png" x="-260" y="-116" width={MAP_WIDTH + 520} height={1327} preserveAspectRatio="xMidYMid meet" />
        <rect className="basemap-wash" x="-260" y="-150" width={MAP_WIDTH + 520} height={MAP_HEIGHT + 460} />
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
        <g className="station-layer">
          {networkGeometry.stations
            .filter((station) => station.lines.some((line) => visibleLines.has(line)))
            .map((station) => {
              const selected = selectedStation === station.abbr;
              const transfer = TRANSFER_STATIONS.has(station.abbr);
              const terminal = TERMINAL_STATIONS.has(station.abbr);
              const showLabel = selected || PRIORITY_LABEL_STATIONS.has(station.abbr);
              return (
                <g key={station.abbr} className="station-item">
                  <g
                    className={`station-marker ${selected ? 'selected' : ''} ${transfer ? 'transfer' : ''} ${terminal ? 'terminal' : ''}`}
                    data-testid={`station-marker-${station.abbr}`}
                    data-station-marker
                    role="button"
                    tabIndex={selected ? 0 : -1}
                    aria-label={`${station.name} station`}
                    transform={`translate(${station.point.x} ${station.point.y})`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectStation(station.abbr);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                    onKeyDown={(event) => handleKeyActivate(event, () => onSelectStation(station.abbr))}
                  >
                    <circle className="station-hit" r="18" />
                    <circle className="station-halo" r={terminal ? 10.7 : transfer ? 9.1 : 7.1} />
                    <circle className="station-outer" r={terminal ? 7.8 : transfer ? 6.5 : 4.7} />
                    {transfer ? <circle className="station-inner" r="2.6" /> : null}
                  </g>
                  {showLabel ? (
                    <text
                      className="station-label"
                      x={station.point.x + labelOffset(station.abbr).x}
                      y={station.point.y + labelOffset(station.abbr).y}
                      filter="url(#mapLabelHalo)"
                    >
                      {shortStationName(station)}
                    </text>
                  ) : null}
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
  const raw = trains
    .map((train) => {
      const progress = visualTrainProgress(currentProgress(train, now));
      let point =
        routePointForStops(train.routeId, train.prevStop, train.nextStop, progress, DISPLAY_ROUTE_IDS) ||
        routePoint(train.routeId, train.prevIdx, train.nextIdx, progress);
      if (point && trainOverlapsStop(point, train.prevStop, train.nextStop)) {
        point =
          routePointForStops(train.routeId, train.prevStop, train.nextStop, 0.5, DISPLAY_ROUTE_IDS) ||
          routePoint(train.routeId, train.prevIdx, train.nextIdx, 0.5);
      }
      return point ? { train, point: stabilizeTrainPoint(train, point, now, placementCache) } : null;
    })
    .filter(Boolean) as Array<{ train: InferredTrain; point: TrainMapPoint }>;

  const activeKeys = new Set(raw.map(({ train }) => stableTrainKey(train)));
  for (const [key, value] of placementCache.entries()) {
    if (!activeKeys.has(key) || now - value.updatedAt > 90_000) placementCache.delete(key);
  }

  const buckets = new Map<string, typeof raw>();
  for (const item of raw) {
    const key = `${Math.round(item.point.x / 26)}:${Math.round(item.point.y / 26)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)?.push(item);
  }

  const perBucket = overviewMode ? 3 : 5;
  const globalLimit = overviewMode ? 34 : 60;
  const placed = [...buckets.values()].flatMap((bucket) =>
    bucket
      .sort((a, b) => {
        if (a.train.id === selectedTrainId) return -1;
        if (b.train.id === selectedTrainId) return 1;
        return b.train.confidence - a.train.confidence;
      })
      .slice(0, Math.min(perBucket, bucket.length))
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
    })
    .slice(0, globalLimit);
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
  return {
    x: Math.max(-100, Math.min(MAP_WIDTH - w + 100, view.x)),
    y: Math.max(-900, Math.min(MAP_HEIGHT - h + 300, view.y)),
    w,
    h,
  };
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
  return (overviewMode ? [0, 0, 0] : [0, -4, 4, -7, 7])[index] || 0;
}

function visualTrainProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0.5;
  return Math.min(0.76, Math.max(0.24, progress));
}

function stabilizeTrainPoint(
  train: InferredTrain,
  rawPoint: TrainMapPoint,
  now: number,
  placementCache: Map<string, StableTrainPlacement>,
): TrainMapPoint {
  const key = stableTrainKey(train);
  const previous = placementCache.get(key);
  if (!previous) {
    placementCache.set(key, { ...rawPoint, updatedAt: now });
    return rawPoint;
  }

  const elapsedSec = Math.max(0.25, Math.min(8, (now - previous.updatedAt) / 1000));
  const distance = Math.hypot(rawPoint.x - previous.x, rawPoint.y - previous.y);
  if (distance > 260) {
    placementCache.set(key, { ...rawPoint, updatedAt: now });
    return rawPoint;
  }

  const maxStep = 10 + elapsedSec * 5.8;
  const ratio = distance > maxStep ? maxStep / distance : 1;
  const next = {
    x: previous.x + (rawPoint.x - previous.x) * ratio,
    y: previous.y + (rawPoint.y - previous.y) * ratio,
    angle: stabilizeAngle(rawPoint.angle, previous.angle, elapsedSec),
  };
  placementCache.set(key, { ...next, updatedAt: now });
  return next;
}

function stableTrainKey(train: InferredTrain): string {
  const idParts = train.id.split(':');
  const cluster = idParts[idParts.length - 1] || '0';
  return [train.routeId, train.destination, cluster, train.direction, train.platform || ''].join(':');
}

function stabilizeAngle(rawAngle: number, previousAngle: number, elapsedSec: number): number {
  const direct = nearestEquivalentAngle(rawAngle, previousAngle);
  const reversed = nearestEquivalentAngle(rawAngle + 180, previousAngle);
  const candidate = Math.abs(reversed - previousAngle) + 24 < Math.abs(direct - previousAngle) ? reversed : direct;
  const maxTurn = 24 + elapsedSec * 20;
  return previousAngle + clamp(candidate - previousAngle, -maxTurn, maxTurn);
}

function nearestEquivalentAngle(angle: number, reference: number): number {
  let adjusted = angle;
  while (adjusted - reference > 180) adjusted -= 360;
  while (adjusted - reference < -180) adjusted += 360;
  return adjusted;
}

function trainOverlapsStop(point: { x: number; y: number }, prevStop: string, nextStop: string): boolean {
  const stops = [prevStop, nextStop]
    .map((abbr) => networkGeometry.stationByAbbr.get(abbr)?.point)
    .filter(Boolean) as Array<{ x: number; y: number }>;
  return stops.some((stop) => Math.hypot(point.x - stop.x, point.y - stop.y) < 26);
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
