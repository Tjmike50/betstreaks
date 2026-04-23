import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface NbaPropRow {
  event_id: string;
  commence_time: string;
  event_status: string;
  home_team_id: string;
  home_team_name: string;
  home_team_abbr: string;
  away_team_id: string;
  away_team_name: string;
  away_team_abbr: string;
  player_id: string;
  player_name: string;
  market_type: string;
  line: number;
  best_over_line: number | null;
  best_over_odds_american: number | null;
  best_over_sportsbook_name: string | null;
  best_under_line: number | null;
  best_under_odds_american: number | null;
  best_under_sportsbook_name: string | null;
  book_count: number;
  latest_source_updated_at: string | null;
}

/** Summary of props available for a single game (event) */
export interface GamePropSummary {
  eventId: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  propCount: number;
  playerCount: number;
  marketTypes: string[];
}

interface UseNbaPropsOptions {
  enabled?: boolean;
}

export function useNbaProps({ enabled = true }: UseNbaPropsOptions = {}) {
  return useQuery({
    queryKey: ["nba-props-today"],
    queryFn: async (): Promise<NbaPropRow[]> => {
      const { data, error } = await supabase.rpc("get_today_nba_props");
      if (error) throw error;
      return (data ?? []) as unknown as NbaPropRow[];
    },
    enabled,
    staleTime: 90_000,
    refetchInterval: 90_000,
  });
}

/** Build a matchup key from team abbreviations for cross-table matching */
export function matchupKey(awayAbbr: string, homeAbbr: string): string {
  return `${awayAbbr}@${homeAbbr}`;
}

/** Aggregate prop rows into per-matchup summaries (keyed by "AWAY@HOME") */
export function summarizeByMatchup(rows: NbaPropRow[]): Map<string, GamePropSummary> {
  const map = new Map<string, GamePropSummary>();
  for (const r of rows) {
    const key = matchupKey(r.away_team_abbr, r.home_team_abbr);
    let entry = map.get(key);
    if (!entry) {
      entry = {
        eventId: r.event_id,
        homeTeamAbbr: r.home_team_abbr,
        awayTeamAbbr: r.away_team_abbr,
        propCount: 0,
        playerCount: 0,
        marketTypes: [],
      };
      map.set(key, entry);
    }
    entry.propCount++;
    if (!entry.marketTypes.includes(r.market_type)) {
      entry.marketTypes.push(r.market_type);
    }
  }
  // compute distinct player counts
  for (const [key, entry] of map) {
    const players = new Set(
      rows
        .filter((r) => matchupKey(r.away_team_abbr, r.home_team_abbr) === key)
        .map((r) => r.player_id),
    );
    entry.playerCount = players.size;
  }
  return map;
}
