import { Search, X } from 'lucide-react';
import { shortStationName, stations } from '../data/gtfs';
import type { StationDepartures } from '../data/types';

type StationSearchProps = {
  query: string;
  selectedStation: string | null;
  departures: StationDepartures;
  onQueryChange: (query: string) => void;
  onSelectStation: (abbr: string) => void;
  onClear: () => void;
};

export function StationSearch({
  query,
  selectedStation,
  departures,
  onQueryChange,
  onSelectStation,
  onClear,
}: StationSearchProps) {
  const normalized = query.trim().toLowerCase();
  const results = stations
    .filter((station) => !normalized || station.name.toLowerCase().includes(normalized) || station.abbr.toLowerCase().includes(normalized))
    .slice(0, normalized ? 14 : 9);

  return (
    <section className={`station-search ${normalized ? 'has-query' : ''}`} aria-label="Station search" data-testid="station-search-panel">
      <div className="search-box">
        <Search size={17} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Find station"
          type="search"
          aria-label="Search by station name or abbreviation"
          data-testid="station-search-input"
        />
        {query ? (
          <button
            className="inline-icon"
            type="button"
            aria-label="Clear station search"
            data-testid="clear-search-button"
            onClick={onClear}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="station-result-list" role="listbox" aria-label="Station results" data-testid="station-results">
        {results.length ? (
          results.map((station) => {
            const etas = departures.get(station.abbr) || [];
            const selected = selectedStation === station.abbr;
            return (
              <button
                key={station.abbr}
                type="button"
                role="option"
                aria-selected={selected}
                className={`station-result ${selected ? 'selected' : ''}`}
                data-testid={`station-result-${station.abbr}`}
                onClick={() => {
                  onSelectStation(station.abbr);
                  onQueryChange('');
                }}
              >
                <span>
                  <strong>{shortStationName(station)}</strong>
                  <em>{station.abbr}</em>
                </span>
                <b>{etas[0] ? formatMinutes(etas[0].minutes) : '--'}</b>
              </button>
            );
          })
        ) : (
          <p className="empty-copy" data-testid="station-no-results">
            No station matches
          </p>
        )}
      </div>
    </section>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return 'Now';
  return `${minutes}m`;
}
