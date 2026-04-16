/** Normalized outcome from any odds provider */
export interface NormalizedOutcome {
  name: string;       // "Over", "Under", "Home", "Away", "Draw"
  price: number;      // American odds e.g. -110, +150
  point?: number;     // Line/threshold e.g. 24.5
}

/** Normalized odds entry — shared shape from all providers */
export interface NormalizedOdds {
  provider: string;
  sportKey: string;
  eventId: string;
  marketKey: string;
  bookmakerKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  outcomes: NormalizedOutcome[];
  fetchedAt: string;
}

/** Response from the get-odds edge function */
export interface OddsResponse {
  ok: boolean;
  data: NormalizedOdds[];
  meta: {
    provider: string;
    fetchedAt: string;
    isStale: boolean;
    fallbackUsed: boolean;
    fromCache: boolean;
    count: number;
  };
  error?: string;
}
