import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import type { Advisory } from '../data/types';

type AlertsPanelProps = {
  advisories: Advisory[];
  state: 'ok' | 'empty' | 'error';
  open: boolean;
  onToggle: () => void;
};

export function AlertsPanel({ advisories, state, open, onToggle }: AlertsPanelProps) {
  return (
    <section className={`service-panel ${open ? 'open' : ''}`} aria-label="Service advisories" data-testid="service-panel">
      <button
        className="service-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="service-body"
        data-testid="service-toggle"
        onClick={onToggle}
      >
        <AlertTriangle size={17} aria-hidden="true" />
        <span>Service</span>
        <strong>{state === 'error' ? '!' : advisories.length}</strong>
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
      </button>

      <div id="service-body" className="service-body" hidden={!open}>
        {state === 'error' ? (
          <p className="empty-copy" data-testid="advisory-error">
            Advisory feed unavailable
          </p>
        ) : advisories.length ? (
          advisories.map((advisory) => (
            <article className="advisory" data-testid="advisory-item" key={advisory.id}>
              <strong>
                {advisory.type} / {advisory.station}
              </strong>
              <p>{advisory.text}</p>
            </article>
          ))
        ) : (
          <p className="empty-copy" data-testid="advisory-empty">
            No active advisories
          </p>
        )}
      </div>
    </section>
  );
}
