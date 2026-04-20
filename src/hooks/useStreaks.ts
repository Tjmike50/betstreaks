import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Streak, StreakFilters } from "@/types/streak";
import { calculateBestBetsScore } from "@/types/streak";
import { useSport } from "@/contexts/SportContext";
import { isLeagueTeam, isInScopeTeam } from "@/lib/sports/leagueTeams";
import type { SportKey } from "@/lib/sports/registry";
import { useBookableLines, lookupBookableLine } from "@/hooks/useBookableLines";

// Minimum thresholds to hide spam (when advanced mode is OFF)
const MIN_THRESHOLDS: Record<string, number> = {
  PTS: 5,
  REB: 4,
  AST: 2,
  "3PM": 1,
  BLK: 1,
  STL: 1,
};

// De-duplicate: for each player+stat, keep only the best card.
// When sportsbook lines are loaded, prefer the streak whose threshold matches
// the book's main line — that's the one users can actually bet.
function deduplicateStreaks(streaks: Streak[]): Streak[] {
  const bestByPlayerStat = new Map<string, Streak>();

  for (const streak of streaks) {
    const key = `${streak.player_id}-${streak.stat}`;
    const existing = bestByPlayerStat.get(key);

    if (!existing) {
      bestByPlayerStat.set(key, streak);
      continue;
    }

    const existingMatchesBook =
      existing.book_main_threshold != null &&
      Math.abs(existing.book_main_threshold - (existing.threshold - 0.5)) < 1e-6;
    const candidateMatchesBook =
      streak.book_main_threshold != null &&
      Math.abs(streak.book_main_threshold - (streak.threshold - 0.5)) < 1e-6;

    // 1) Prefer the streak that matches the book's main line.
    if (candidateMatchesBook && !existingMatchesBook) {
      bestByPlayerStat.set(key, streak);
      continue;
    }
    if (!candidateMatchesBook && existingMatchesBook) {
      continue;
    }

    // 2) Otherwise prefer bookable streaks over informational ones.
    if (!streak.book_informational && existing.book_informational) {
      bestByPlayerStat.set(key, streak);
      continue;
    }
    if (streak.book_informational && !existing.book_informational) {
      continue;
    }

    // 3) Fall back to the original "longer streak / higher threshold" tiebreak.
    if (
      streak.streak_len > existing.streak_len ||
      (streak.streak_len === existing.streak_len &&
        streak.threshold > existing.threshold) ||
      (streak.streak_len === existing.streak_len &&
        streak.threshold === existing.threshold &&
        streak.season_win_pct > existing.season_win_pct)
    ) {
      bestByPlayerStat.set(key, streak);
    }
  }

  return Array.from(bestByPlayerStat.values());
}

export function useStreaks(filters: StreakFilters, sportOverride?: SportKey) {
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;
  // Sportsbook-line-first mode: default ON. Caller can pass
  // `bookableOnly: false` (e.g. admin / research views) to keep informational
  // streaks visible.
  const bookableOnly = filters.bookableOnly !== false;
  const { data: bookIndex } = useBookableLines();

  return useQuery({
    queryKey: ["streaks", sport, filters, bookIndex?.size ?? 0],
    queryFn: async () => {
      let query = supabase
        .from("streaks")
        .select("*")
        .eq("sport", sport)
        .eq("entity_type", filters.entityType)
        .gte("streak_len", filters.minStreak)
        .gte("season_win_pct", filters.minSeasonWinPct)
        .order("streak_len", { ascending: false })
        .order("season_win_pct", { ascending: false })
        .order("last_game", { ascending: false });

      if (filters.stat !== "All") {
        query = query.eq("stat", filters.stat);
      }

      if (filters.playerSearch.trim()) {
        const searchField = filters.entityType === "team" ? "team_abbr" : "player_name";
        query = query.ilike(searchField, `%${filters.playerSearch.trim()}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      let streaks = data as Streak[];

      // Sport-aware team filter:
      // - NBA: keep only valid NBA teams that are postseason-relevant
      // - WNBA: keep only valid WNBA teams
      streaks = streaks.filter((s) =>
        isLeagueTeam(sport, s.team_abbr) && isInScopeTeam(sport, s.team_abbr)
      );

      // -----------------------------------------------------------------
      // Sportsbook-line-first annotation. Each player streak is checked
      // against today's line_snapshots; integer thresholds map to the
      // adjacent .5 book line (streak 5+ ↔ book "Over 4.5"). Team streaks
      // (ML / team totals) bypass — no per-player book lines to match.
      // -----------------------------------------------------------------
      const isTeamRow = filters.entityType === "team";
      streaks = streaks.map((s) => {
        if (isTeamRow) {
          return {
            ...s,
            book_threshold: null,
            book_main_threshold: null,
            book_informational: false,
          };
        }
        const { bookThreshold, mainThreshold, hasAnyLine } = lookupBookableLine(
          bookIndex,
          s.player_name,
          s.stat,
          s.threshold,
        );
        return {
          ...s,
          book_threshold: bookThreshold,
          book_main_threshold: mainThreshold,
          book_informational: !hasAnyLine || bookThreshold == null,
        };
      });

      if (!filters.advanced) {
        // Legacy minimum-threshold spam filter still applies as a floor.
        streaks = streaks.filter((s) => {
          const min = MIN_THRESHOLDS[s.stat];
          return min === undefined || s.threshold >= min;
        });
      }

      // Sportsbook-line-first gate: when book lines have loaded and the
      // caller hasn't opted out, drop player streaks that have no live
      // sportsbook line. We only enforce this once the index is non-empty
      // so we never wipe the page during initial load or when an upstream
      // odds provider stalls.
      if (bookableOnly && bookIndex && bookIndex.size > 0) {
        streaks = streaks.filter((s) => isTeamRow || !s.book_informational);
      }

      streaks = deduplicateStreaks(streaks);

      if (filters.bestBets) {
        streaks = streaks.filter(
          (s) =>
            s.streak_len >= 3 &&
            (s.season_win_pct >= 55 || (s.last10_hit_pct ?? 0) >= 60)
        );
      }

      if (filters.thresholdMin !== null) {
        streaks = streaks.filter((s) => s.threshold >= filters.thresholdMin!);
      }
      if (filters.thresholdMax !== null) {
        streaks = streaks.filter((s) => s.threshold <= filters.thresholdMax!);
      }

      if (filters.teamFilter && filters.teamFilter !== "All") {
        streaks = streaks.filter((s) => s.team_abbr === filters.teamFilter);
      }

      if (filters.recentOnly) {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const threeDaysAgoStr = threeDaysAgo.toISOString().split("T")[0];
        streaks = streaks.filter((s) => s.last_game >= threeDaysAgoStr);
      }

      streaks.sort((a, b) => {
        // Always rank bookable streaks above informational ones, regardless
        // of the user's chosen sort key.
        const aInfo = a.book_informational ? 1 : 0;
        const bInfo = b.book_informational ? 1 : 0;
        if (aInfo !== bInfo) return aInfo - bInfo;

        switch (filters.sortBy) {
          case "season":
            if (b.season_win_pct !== a.season_win_pct)
              return b.season_win_pct - a.season_win_pct;
            return b.streak_len - a.streak_len;
          case "l10":
            const aL10Pct = a.last10_games > 0 ? (a.last10_hits / a.last10_games) * 100 : 0;
            const bL10Pct = b.last10_games > 0 ? (b.last10_hits / b.last10_games) * 100 : 0;
            if (bL10Pct !== aL10Pct) return bL10Pct - aL10Pct;
            return b.streak_len - a.streak_len;
          case "recent":
            return b.last_game.localeCompare(a.last_game);
          case "threshold":
            if (b.threshold !== a.threshold) return b.threshold - a.threshold;
            return b.streak_len - a.streak_len;
          case "bestBetsScore":
            const aScore = calculateBestBetsScore(a);
            const bScore = calculateBestBetsScore(b);
            if (bScore !== aScore) return bScore - aScore;
            return b.streak_len - a.streak_len;
          case "streak":
          default:
            if (b.streak_len !== a.streak_len) return b.streak_len - a.streak_len;
            if (b.season_win_pct !== a.season_win_pct)
              return b.season_win_pct - a.season_win_pct;
            return b.last_game.localeCompare(a.last_game);
        }
      });

      return streaks;
    },
  });
}

export function usePlayerStreaks(playerId: number) {
  return useQuery({
    queryKey: ["playerStreaks", playerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("streaks")
        .select("*")
        .eq("player_id", playerId)
        .order("streak_len", { ascending: false })
        .order("season_win_pct", { ascending: false });

      if (error) throw error;
      return data as Streak[];
    },
    enabled: !!playerId,
  });
}
