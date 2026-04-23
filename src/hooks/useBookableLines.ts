// =============================================================================
// useBookableLines — fetches today's consensus lines from the normalized odds
// layer (consensus_lines view + players join) and exposes a per-player +
// stat-code index of real sportsbook thresholds. Powers the
// "sportsbook-line-first" rule: streaks/cheatsheets/etc should prioritize
// thresholds users can actually bet.
//
// DATA SOURCE: consensus_lines view (aggregated from markets table)
//              joined with players table for name resolution.
//              Filtered to today's events via events table date filter.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildBookableIndexFromConsensus,
  bookableKey,
  matchStreakToBookLine,
  type BookableLineEntry,
  type ConsensusLineRow,
} from "@/lib/bookableLines";

interface Options {
  /** Disable network call (e.g. when sport has no book lines yet). */
  enabled?: boolean;
}

/**
 * Get the ET operational date string (YYYY-MM-DD).
 */
function getETDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function useBookableLines({ enabled = true }: Options = {}) {
  return useQuery({
    queryKey: ["bookableLines", "consensus"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const today = getETDate();

      // 1. Get today's event IDs (NBA only for now — the only sport in the
      //    normalized odds layer).
      const { data: events, error: evErr } = await supabase
        .from("events")
        .select("id")
        .or("league.eq.nba,sport.eq.basketball")
        .gte("commence_time", `${today}T00:00:00-05:00`)
        .lt("commence_time", `${today}T23:59:59-05:00`);
      if (evErr) throw evErr;
      if (!events || events.length === 0) return new Map<string, BookableLineEntry>();

      const eventIds = events.map((e) => e.id);

      // 2. Fetch consensus lines for today's events, joining player names.
      const { data: lines, error: lineErr } = await supabase
        .from("consensus_lines")
        .select("market_type, average_line, min_line, max_line, player_id, players!markets_player_id_fkey(full_name)")
        .in("event_id", eventIds);
      if (lineErr) throw lineErr;

      // 3. Transform into ConsensusLineRow shape for the index builder.
      const rows: ConsensusLineRow[] = [];
      for (const line of lines ?? []) {
        const playerJoin = line.players as unknown as { full_name: string } | null;
        const playerName = playerJoin?.full_name;
        if (!playerName || !line.market_type) continue;
        rows.push({
          player_name: playerName,
          market_type: line.market_type,
          average_line: line.average_line ?? 0,
          min_line: line.min_line ?? line.average_line ?? 0,
          max_line: line.max_line ?? line.average_line ?? 0,
        });
      }

      return buildBookableIndexFromConsensus(rows);
    },
  });
}

/**
 * Helper: given a bookable index, return whether a (player, stat-code,
 * integer-threshold) streak is backed by a real sportsbook line — and if
 * so, which `.5` threshold it maps to.
 */
export function lookupBookableLine(
  index: Map<string, BookableLineEntry> | undefined,
  playerName: string,
  statCode: string,
  streakThreshold: number,
): { bookThreshold: number | null; mainThreshold: number | null; hasAnyLine: boolean } {
  if (!index) return { bookThreshold: null, mainThreshold: null, hasAnyLine: false };
  const entry = index.get(bookableKey(playerName, statCode));
  if (!entry) return { bookThreshold: null, mainThreshold: null, hasAnyLine: false };
  return {
    bookThreshold: matchStreakToBookLine(streakThreshold, entry.thresholds),
    mainThreshold: entry.mainThreshold,
    hasAnyLine: true,
  };
}
