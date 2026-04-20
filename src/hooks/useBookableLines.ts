// =============================================================================
// useBookableLines — fetches today's line_snapshots and exposes a per-player
// + stat-code index of real sportsbook thresholds. Powers the
// "sportsbook-line-first" rule: streaks/cheatsheets/etc should prioritize
// thresholds users can actually bet.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildBookableIndex,
  bookableKey,
  matchStreakToBookLine,
  type BookableLineEntry,
} from "@/lib/bookableLines";

interface Options {
  /** Days back to consider a line "live" (default 1 — today + yesterday). */
  daysBack?: number;
  /** Disable network call (e.g. when sport has no book lines yet). */
  enabled?: boolean;
}

export function useBookableLines({ daysBack = 1, enabled = true }: Options = {}) {
  return useQuery({
    queryKey: ["bookableLines", daysBack],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceDate = since.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("line_snapshots")
        .select("player_name, stat_type, threshold")
        .gte("game_date", sinceDate)
        .limit(20000);
      if (error) throw error;

      const index = buildBookableIndex(
        (data ?? []) as { player_name: string; stat_type: string; threshold: number }[]
      );
      return index;
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
