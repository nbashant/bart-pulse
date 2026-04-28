import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertsPanel } from './components/AlertsPanel';
import { DetailDrawer } from './components/DetailDrawer';
import { LineControls } from './components/LineControls';
import { StationSearch } from './components/StationSearch';
import { TopBar } from './components/TopBar';
import { displayStationName, LINE_META } from './data/gtfs';
import { useBartRealtime } from './data/useBartRealtime';
import type { InferredTrain, LineLabel } from './data/types';
import { currentEtaSec, inferTrains } from './inference/trains';
import { BartMap, type MapFocusInput, type MapFocusRequest } from './map/BartMap';

export function App() {
  const realtime = useBartRealtime();
  const [activeLine, setActiveLine] = useState<LineLabel | 'all'>('all');
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [serviceOpen, setServiceOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<MapFocusRequest>({ seq: 0, type: 'all' });

  const trains = useMemo(
    () => inferTrains(realtime.stationDepartures, realtime.receivedAt),
    [realtime.receivedAt, realtime.stationDepartures],
  );
  const visibleTrains = useMemo(
    () => trains.filter((train) => activeLine === 'all' || train.line === activeLine),
    [activeLine, trains],
  );
  const selectedTrain = selectedTrainId ? trains.find((train) => train.id === selectedTrainId) || null : null;
  const hasSelection = Boolean(selectedTrain || selectedStation);
  const delayedCount = visibleTrains.filter((train) => train.delaySec > 60).length;

  const focus = useCallback((request: MapFocusInput) => {
    setFocusRequest((previous) => ({ ...request, seq: previous.seq + 1 } as MapFocusRequest));
  }, []);

  const selectLine = (line: LineLabel) => {
    const next = activeLine === line ? 'all' : line;
    setActiveLine(next);
    setSelectedStation(null);
    setSelectedTrainId(null);
    focus(next === 'all' ? { type: 'all' } : { type: 'line', line: next });
  };

  const showAll = () => {
    setActiveLine('all');
    focus({ type: 'all' });
  };

  const selectStation = (abbr: string) => {
    setSelectedStation((current) => {
      const next = current === abbr ? null : abbr;
      if (next) {
        setSelectedTrainId(null);
        focus({ type: 'station', abbr: next });
      }
      return next;
    });
  };

  const selectTrain = (id: string) => {
    setSelectedTrainId((current) => {
      const next = current === id ? null : id;
      if (next) {
        setSelectedStation(null);
        focus({ type: 'train', trainId: next });
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedStation(null);
    setSelectedTrainId(null);
  };

  const fitSelected = () => {
    if (selectedTrainId) focus({ type: 'train', trainId: selectedTrainId });
    else if (selectedStation) focus({ type: 'station', abbr: selectedStation });
    else if (activeLine === 'all') focus({ type: 'all' });
    else focus({ type: 'line', line: activeLine });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearSelection();
        setServiceOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={`app-shell ${serviceOpen ? 'service-open' : ''} ${hasSelection ? 'has-selection' : ''}`} data-testid="app-shell">
      <BartMap
        activeLine={activeLine}
        trains={trains}
        selectedStation={selectedStation}
        selectedTrainId={selectedTrainId}
        loading={realtime.loading}
        focusRequest={focusRequest}
        onSelectStation={selectStation}
        onSelectTrain={selectTrain}
        onClearSelection={clearSelection}
      />

      <TopBar
        mode={realtime.mode}
        loading={realtime.loading}
        inFlight={realtime.inFlight}
        sourceTime={realtime.sourceTime}
        receivedAt={realtime.receivedAt}
        error={realtime.error}
        trainCount={visibleTrains.length}
        onRefresh={realtime.refresh}
      />

      <div className="control-stack" data-testid="control-stack">
        <LineControls activeLine={activeLine} trains={trains} onLineClick={selectLine} onAllLines={showAll} />
        <StationSearch
          query={query}
          selectedStation={selectedStation}
          departures={realtime.stationDepartures}
          onQueryChange={setQuery}
          onSelectStation={selectStation}
          onClear={() => setQuery('')}
        />
      </div>

      <DetailDrawer
        train={selectedTrain}
        stationAbbr={selectedStation}
        departures={realtime.stationDepartures}
        trainCount={visibleTrains.length}
        delayedCount={delayedCount}
        hasSelection={hasSelection}
        onClose={clearSelection}
        onFitSelected={fitSelected}
      />

      <AlertsPanel
        advisories={realtime.advisories}
        state={realtime.advisoryState}
        open={serviceOpen}
        onToggle={() => setServiceOpen((open) => !open)}
      />

      <TrainRail trains={visibleTrains} selectedTrainId={selectedTrainId} onSelectTrain={selectTrain} />
    </div>
  );
}

function TrainRail({
  trains,
  selectedTrainId,
  onSelectTrain,
}: {
  trains: InferredTrain[];
  selectedTrainId: string | null;
  onSelectTrain: (id: string) => void;
}) {
  return (
    <section className="train-rail" aria-label="Active trains" data-testid="train-rail">
      <span className="train-rail-label">Active trains</span>
      <div className="train-card-row">
        {trains.slice(0, 10).map((train) => (
          <button
            key={train.id}
            type="button"
            className={`train-card ${selectedTrainId === train.id ? 'selected' : ''}`}
            onClick={() => onSelectTrain(train.id)}
          >
            <i style={{ background: LINE_META[train.line].accessibleColor }} />
            <span>
              <strong>
                {train.line} to {train.destinationName}
              </strong>
              <em>
                {displayStationName(train.prevStop)} / {formatRailEta(currentEtaSec(train))}
              </em>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function formatRailEta(seconds: number): string {
  if (seconds <= 10) return 'Now';
  return `${Math.round(seconds / 60)}m`;
}
