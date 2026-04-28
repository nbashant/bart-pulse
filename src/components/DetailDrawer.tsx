import { LocateFixed, TrainFront, X } from 'lucide-react';
import { displayStationName, LINE_META, stationByAbbr, stationLines } from '../data/gtfs';
import type { EtdEstimate, InferredTrain, StationDepartures } from '../data/types';
import { currentEtaSec } from '../inference/trains';

type DetailDrawerProps = {
  train: InferredTrain | null;
  stationAbbr: string | null;
  departures: StationDepartures;
  trainCount: number;
  delayedCount: number;
  hasSelection: boolean;
  onClose: () => void;
  onFitSelected: () => void;
};

export function DetailDrawer({
  train,
  stationAbbr,
  departures,
  trainCount,
  delayedCount,
  hasSelection,
  onClose,
  onFitSelected,
}: DetailDrawerProps) {
  const active = Boolean(train || stationAbbr);
  return (
    <aside className={`detail-drawer ${active ? 'active' : 'network-only'}`} data-testid="detail-drawer" aria-label="Selection details">
      {hasSelection ? (
        <div className="drawer-actions">
          <button className="icon-button" type="button" aria-label="Fit selected item" data-testid="fit-selected-button" onClick={onFitSelected}>
            <LocateFixed size={17} aria-hidden="true" />
          </button>
          <button className="icon-button" type="button" aria-label="Close details" data-testid="detail-close-button" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {train ? <TrainDetail train={train} /> : stationAbbr ? <StationDetail abbr={stationAbbr} departures={departures.get(stationAbbr) || []} /> : <NetworkDetail trainCount={trainCount} delayedCount={delayedCount} />}
    </aside>
  );
}

function TrainDetail({ train }: { train: InferredTrain }) {
  const eta = currentEtaSec(train);
  return (
    <div className="drawer-content" data-testid="train-detail">
      <span className="drawer-kicker">
        <TrainFront size={15} aria-hidden="true" />
        {train.line} line
      </span>
      <h2>{train.destinationName}</h2>
      <div className="train-route-plate" style={{ borderColor: LINE_META[train.line].accessibleColor }}>
        <span style={{ background: LINE_META[train.line].accessibleColor }} />
        <strong>{displayStationName(train.prevStop)}</strong>
        <em>to</em>
        <strong>{displayStationName(train.nextStop)}</strong>
      </div>
      <dl className="metric-grid">
        <div>
          <dt>ETA</dt>
          <dd>{formatEtaSeconds(eta)}</dd>
        </div>
        <div>
          <dt>Delay</dt>
          <dd>{train.delaySec > 60 ? `${Math.round(train.delaySec / 60)}m` : 'On time'}</dd>
        </div>
        <div>
          <dt>Signals</dt>
          <dd>{train.members}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{Math.round(train.confidence * 100)}%</dd>
        </div>
      </dl>
      <p className="quiet-copy">Position inferred from BART ETDs and GTFS stop timing.</p>
    </div>
  );
}

function StationDetail({ abbr, departures }: { abbr: string; departures: EtdEstimate[] }) {
  const station = stationByAbbr.get(abbr);
  const lines = [...(stationLines.get(abbr) || [])];
  return (
    <div className="drawer-content" data-testid="station-detail">
      <span className="drawer-kicker">Station {abbr}</span>
      <h2>{station?.name || abbr}</h2>
      <div className="served-lines">
        {lines.map((line) => (
          <span key={line} style={{ borderColor: LINE_META[line].accessibleColor }}>
            <i style={{ background: LINE_META[line].accessibleColor }} />
            {line}
          </span>
        ))}
      </div>
      <div className="departure-list" data-testid="station-departures">
        {departures.length ? (
          departures.slice(0, 9).map((departure, index) => (
            <div className="departure-row" key={`${departure.dest}-${departure.color}-${index}`}>
              <span className="departure-color" style={{ background: departure.color }} />
              <strong>{departure.destination}</strong>
              <em>{formatMinutes(departure.minutes)}</em>
            </div>
          ))
        ) : (
          <p className="empty-copy" data-testid="empty-departures">
            No departures in the current feed
          </p>
        )}
      </div>
    </div>
  );
}

function NetworkDetail({ trainCount, delayedCount }: { trainCount: number; delayedCount: number }) {
  return (
    <div className="drawer-content" data-testid="network-detail">
      <span className="drawer-kicker">Network</span>
      <h2>{trainCount ? `${trainCount} inferred trains` : 'No active trains'}</h2>
      <dl className="metric-grid">
        <div>
          <dt>Delayed</dt>
          <dd>{delayedCount}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>ETD + GTFS</dd>
        </div>
      </dl>
      <p className="quiet-copy">Markers stay on projected GTFS route shapes. Low confidence trains are softened instead of presented as exact locations.</p>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  return minutes <= 0 ? 'Now' : `${minutes} min`;
}

function formatEtaSeconds(seconds: number): string {
  if (seconds <= 10) return 'Now';
  return `${Math.round(seconds / 60)} min`;
}
