import { ALL_LINES, lineForColor, LINE_META } from './gtfs';
import type { Advisory, BartRealtime, EtdEstimate, LineLabel, StationDepartures } from './types';

const REQUEST_TIMEOUT_MS = 9_000;
const STALE_AFTER_MS = 90_000;

type FetchOptions = {
  signal?: AbortSignal;
  forceDemo?: boolean;
  scenario?: string | null;
};

export async function fetchBartRealtime(options: FetchOptions = {}): Promise<BartRealtime> {
  if (options.forceDemo) return buildDemoRealtime(options.scenario || null);

  const receivedAt = Date.now();
  const [etd, advisories] = await Promise.allSettled([
    fetchEtd(options.signal),
    fetchAdvisories(options.signal),
  ]);

  if (etd.status === 'fulfilled') {
    const advisoryData = advisories.status === 'fulfilled' ? advisories.value : [];
    return {
      mode: Date.now() - receivedAt > STALE_AFTER_MS ? 'stale' : 'live',
      receivedAt,
      sourceTime: etd.value.sourceTime,
      error: advisories.status === 'rejected' ? `Advisories unavailable: ${messageFor(advisories.reason)}` : null,
      stationDepartures: etd.value.stationDepartures,
      advisories: advisoryData,
    };
  }

  const fallback = buildDemoRealtime(options.scenario || null);
  return {
    ...fallback,
    mode: 'demo',
    error: `Live ETD unavailable: ${messageFor(etd.reason)}`,
  };
}

export async function fetchEtd(signal?: AbortSignal): Promise<{ sourceTime: string; stationDepartures: StationDepartures }> {
  const data = await fetchJson('/api/bart/etd', signal);
  const stationRows = asArray(data?.root?.station);
  const stationDepartures: StationDepartures = new Map();

  for (const station of stationRows) {
    const abbr = textValue(station?.abbr);
    if (!abbr) continue;
    const departures: EtdEstimate[] = [];
    for (const etd of asArray(station.etd)) {
      const dest = textValue(etd?.abbreviation);
      const destination = textValue(etd?.destination) || dest;
      for (const estimate of asArray(etd?.estimate)) {
        const minutes = parseMinutes(estimate?.minutes);
        const color = normalizeColor(estimate?.hexcolor, estimate?.color);
        if (!Number.isFinite(minutes) || !color || !dest) continue;
        departures.push({
          station: abbr,
          destination,
          dest,
          color,
          line: lineForColor(color),
          minutes,
          displayMinutes: textValue(estimate?.minutes) || String(minutes),
          delaySec: parseInteger(estimate?.delay, 0),
          length: parseNullableInteger(estimate?.length),
          platform: textValue(estimate?.platform),
          direction: textValue(estimate?.direction),
        });
      }
    }
    stationDepartures.set(abbr, departures.sort((a, b) => a.minutes - b.minutes));
  }

  return {
    sourceTime: textValue(data?.root?.time),
    stationDepartures,
  };
}

export async function fetchAdvisories(signal?: AbortSignal): Promise<Advisory[]> {
  const data = await fetchJson('/api/bart/advisories', signal);
  return asArray(data?.root?.bsa)
    .filter((item) => item && textValue(item.description))
    .map((item, index) => ({
      id: textValue(item['@id']) || `${textValue(item.posted)}-${index}`,
      type: textValue(item.type) || 'Service',
      station: textValue(item.station) || 'BART',
      text: textValue(item.description),
      posted: textValue(item.posted),
    }))
    .slice(0, 12);
}

export function buildDemoRealtime(scenario: string | null = null): BartRealtime {
  const stationDepartures: StationDepartures = new Map();
  const now = Date.now();
  const seed: Array<[string, LineLabel, string, string, number, number]> = [
    ['MCAR', 'Yellow', 'SFIA', 'San Francisco International Airport', 2, 0],
    ['12TH', 'Red', 'RICH', 'Richmond', 4, 0],
    ['WOAK', 'Blue', 'DUBL', 'Dublin / Pleasanton', 1, 95],
    ['BAYF', 'Orange', 'RICH', 'Richmond', 6, 0],
    ['COLS', 'Green', 'DALY', 'Daly City', 3, 0],
    ['POWL', 'Yellow', 'ANTC', 'Antioch', 5, 0],
    ['DALY', 'Red', 'MLBR', 'Millbrae', 8, 0],
    ['FTVL', 'Blue', 'DALY', 'Daly City', 7, 0],
    ['SANL', 'Orange', 'BERY', 'Berryessa / North San Jose', 2, 0],
    ['SBRN', 'Yellow', 'MLBR', 'Millbrae', 0, 0],
  ];

  if (scenario === 'crowded') {
    seed.push(
      ['12TH', 'Yellow', 'SFIA', 'San Francisco International Airport', 1, 0],
      ['19TH', 'Yellow', 'SFIA', 'San Francisco International Airport', 2, 0],
      ['MCAR', 'Red', 'RICH', 'Richmond', 3, 140],
      ['WOAK', 'Blue', 'DALY', 'Daly City', 2, 0],
    );
  }

  if (scenario !== 'no-trains') {
    for (const [station, line, dest, destination, minutes, delaySec] of seed) {
      const estimate: EtdEstimate = {
        station,
        destination,
        dest,
        color: LINE_META[line].accessibleColor,
        line,
        minutes,
        displayMinutes: minutes === 0 ? 'Leaving' : String(minutes),
        delaySec,
        length: minutes % 2 === 0 ? 8 : 10,
        platform: '',
        direction: '',
      };
      stationDepartures.set(station, [...(stationDepartures.get(station) || []), estimate]);
    }
  }

  const advisories: Advisory[] =
    scenario === 'advisory-empty'
      ? []
      : [
          {
            id: 'demo-bsa-1',
            type: 'Service Advisory',
            station: 'BART',
            text:
              scenario === 'long-advisory'
                ? 'Trains are recovering from an earlier equipment problem. Riders may see residual delays through downtown Oakland, San Francisco, and transfer points while spacing returns to normal service.'
                : 'Demo advisory: train positions are inferred from station ETDs while live API access is unavailable.',
            posted: new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          },
        ];

  return {
    mode: scenario === 'api-error' ? 'error' : 'demo',
    receivedAt: now,
    sourceTime: scenario === 'no-trains' ? 'No active trains in demo scenario' : 'Demo feed',
    error:
      scenario === 'api-error'
        ? 'Forced API error scenario'
        : scenario === 'advisory-error'
          ? 'Advisories unavailable: forced demo scenario'
          : null,
    stationDepartures,
    advisories: scenario === 'advisory-error' ? [] : advisories,
  };
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(`${url}?_=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Invalid JSON returned by BART');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function normalizeColor(hexColor: unknown, colorName: unknown): string | null {
  const hex = textValue(hexColor).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return accessibleLineColor(hex);
  const withoutHash = hex.replace(/^#/, '');
  if (/^[0-9a-f]{6}$/.test(withoutHash)) return accessibleLineColor(`#${withoutHash}`);
  const name = textValue(colorName).toLowerCase();
  const line = ALL_LINES.find((candidate) => candidate.toLowerCase() === name);
  return line ? LINE_META[line].accessibleColor : null;
}

function accessibleLineColor(color: string): string {
  const lower = color.toLowerCase();
  const match = Object.values(LINE_META).find(
    (line) =>
      line.color.toLowerCase() === lower ||
      line.accessibleColor.toLowerCase() === lower ||
      line.sourceColors.some((sourceColor) => sourceColor.toLowerCase() === lower),
  );
  return match?.accessibleColor || lower;
}

function parseMinutes(value: unknown): number {
  const raw = textValue(value).trim().toLowerCase();
  if (!raw) return Number.NaN;
  if (raw === 'leaving') return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function parseNullableInteger(value: unknown): number | null {
  const parsed = Number.parseInt(textValue(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(textValue(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && '#text' in value) return String((value as { '#text': unknown })['#text'] ?? '');
  return String(value);
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
