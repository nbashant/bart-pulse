import { RefreshCw, RadioTower } from 'lucide-react';
import type { DataMode } from '../data/types';

type TopBarProps = {
  mode: DataMode;
  loading: boolean;
  inFlight: boolean;
  sourceTime: string;
  receivedAt: number;
  error: string | null;
  trainCount: number;
  onRefresh: () => void;
};

export function TopBar({ mode, loading, inFlight, sourceTime, receivedAt, error, trainCount, onRefresh }: TopBarProps) {
  const age = receivedAt ? Math.max(0, Math.round((Date.now() - receivedAt) / 1000)) : null;
  const status = loading ? 'Loading' : mode === 'live' ? 'Live' : mode === 'demo' ? 'Demo' : mode === 'stale' ? 'Stale' : 'Offline';
  const feedText = error ? compactError(error) : sourceTime ? `BART feed ${sourceTime}` : age == null ? 'Waiting for data' : `${age}s old`;

  return (
    <header className="top-bar" data-testid="top-bar">
      <div className="brand-lockup" aria-label="BART Pulse">
        <span className="brand-glyph" aria-hidden="true">
          <span />
        </span>
        <div>
          <h1>BART Pulse</h1>
          <p>{trainCount} live inferred train positions</p>
        </div>
      </div>

      <div className="feed-strip" aria-live="polite">
        <span className={`status-chip ${mode}`} data-testid="status-chip">
          <RadioTower size={15} aria-hidden="true" />
          {status}
        </span>
        <span className={`feed-copy ${error ? 'has-error' : ''}`} title={error || feedText} data-testid="feed-copy">
          {feedText}
        </span>
        <button
          className="icon-button"
          type="button"
          aria-label="Refresh live BART data"
          title="Refresh"
          data-testid="refresh-button"
          aria-busy={inFlight}
          onClick={onRefresh}
        >
          <RefreshCw size={18} aria-hidden="true" className={inFlight ? 'spinning' : ''} />
        </button>
      </div>
    </header>
  );
}

function compactError(error: string): string {
  if (error.startsWith('Live ETD unavailable')) return 'ETD offline; demo';
  if (error.startsWith('Advisories unavailable')) return 'Alerts offline';
  return error;
}
