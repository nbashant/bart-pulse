import { RotateCcw } from 'lucide-react';
import { CORE_LINES, LINE_META } from '../data/gtfs';
import type { InferredTrain, LineLabel } from '../data/types';

type LineControlsProps = {
  activeLine: LineLabel | 'all';
  trains: InferredTrain[];
  onLineClick: (line: LineLabel) => void;
  onAllLines: () => void;
};

export function LineControls({ activeLine, trains, onLineClick, onAllLines }: LineControlsProps) {
  return (
    <section className="line-console" aria-label="Line filters" data-testid="line-console">
      <button
        className={`all-lines-button ${activeLine === 'all' ? 'selected' : ''}`}
        type="button"
        onClick={onAllLines}
        data-testid="all-lines-button"
        aria-pressed={activeLine === 'all'}
      >
        <RotateCcw size={16} aria-hidden="true" />
        <span>All</span>
      </button>
      <div className="line-button-row">
        {CORE_LINES.map((line) => {
          const count = trains.filter((train) => train.line === line).length;
          const selected = activeLine === line;
          return (
            <button
              key={line}
              className={`line-button ${selected ? 'selected' : activeLine !== 'all' ? 'muted' : ''}`}
              type="button"
              aria-pressed={selected}
              aria-label={`${line} line filter, ${count} inferred trains`}
              data-testid={`line-filter-${line}`}
              onClick={() => onLineClick(line)}
            >
              <span className="line-swatch" style={{ background: LINE_META[line].accessibleColor }} aria-hidden="true" />
              <span>{line}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}
