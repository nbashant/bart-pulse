export type LineLabel = 'Yellow' | 'Red' | 'Orange' | 'Green' | 'Blue' | 'Airport';

export type Station = {
  abbr: string;
  name: string;
  lat: number;
  lon: number;
};

export type RouteShape = {
  id: string;
  label: LineLabel;
  shortName: string;
  headsign: string;
  directionId: string;
  color: string;
  textColor: string;
  stations: readonly string[];
  segTravel: readonly number[];
  shape: readonly [number, number][];
};

export type GtfsFeed = {
  sourceUrl: string;
  generatedAt: string;
  feed: Record<string, string>;
  stations: readonly Station[];
  routes: readonly RouteShape[];
};

export type EtdEstimate = {
  station: string;
  destination: string;
  dest: string;
  color: string;
  line: LineLabel | 'Unknown';
  minutes: number;
  displayMinutes: string;
  delaySec: number;
  length: number | null;
  platform: string;
  direction: string;
};

export type StationDepartures = Map<string, EtdEstimate[]>;

export type Advisory = {
  id: string;
  type: string;
  station: string;
  text: string;
  posted: string;
};

export type DataMode = 'loading' | 'live' | 'demo' | 'offline' | 'stale' | 'error';

export type BartRealtime = {
  mode: DataMode;
  receivedAt: number;
  sourceTime: string;
  error: string | null;
  stationDepartures: StationDepartures;
  advisories: Advisory[];
};

export type InferredTrain = {
  id: string;
  routeId: string;
  line: LineLabel;
  color: string;
  destination: string;
  destinationName: string;
  prevStop: string;
  nextStop: string;
  prevIdx: number;
  nextIdx: number;
  progress: number;
  etaSec: number;
  timeToDestination: number;
  delaySec: number;
  length: number | null;
  platform: string;
  direction: string;
  confidence: number;
  members: number;
  inferred: boolean;
  receivedAt: number;
};
