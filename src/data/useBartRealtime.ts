import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildDemoRealtime, fetchBartRealtime } from './bartApi';
import type { BartRealtime, DataMode } from './types';

const POLL_MS = 15_000;

type RealtimeState = BartRealtime & {
  loading: boolean;
  inFlight: boolean;
  refresh: () => void;
  advisoryState: 'ok' | 'empty' | 'error';
};

export function useBartRealtime(): RealtimeState {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const forceDemo = params.get('demo') === '1' || params.get('mode') === 'demo';
  const scenario = params.get('scenario');
  const slow = params.get('slow') === '1';
  const [data, setData] = useState<BartRealtime>(() => ({
    ...buildDemoRealtime(scenario),
    mode: 'loading' as DataMode,
    stationDepartures: new Map(),
    advisories: [],
  }));
  const [loading, setLoading] = useState(true);
  const [inFlight, setInFlight] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = requestId.current + 1;
    requestId.current = id;
    setInFlight(true);
    setLoading((previous) => previous || data.mode === 'loading');

    try {
      if (slow) await new Promise((resolve) => window.setTimeout(resolve, 600));
      const next = await fetchBartRealtime({ signal: controller.signal, forceDemo, scenario });
      if (requestId.current === id) setData(next);
    } catch (error) {
      if (!controller.signal.aborted && requestId.current === id) {
        setData({
          ...buildDemoRealtime(scenario),
          mode: 'offline',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (requestId.current === id) {
        setLoading(false);
        setInFlight(false);
      }
    }
  }, [data.mode, forceDemo, scenario, slow]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [load]);

  const advisoryState = data.error?.startsWith('Advisories unavailable')
    ? 'error'
    : data.advisories.length
      ? 'ok'
      : 'empty';

  return {
    ...data,
    loading,
    inFlight,
    refresh: load,
    advisoryState,
  };
}
