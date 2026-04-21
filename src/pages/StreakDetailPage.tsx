// =============================================================================
// StreakDetailPage — sportsbook-line-first.
//
// We no longer read from the legacy `streaks` table by id. Instead we resolve
// the requested (player, stat) against today's `line_snapshots`, build a
// `Streak` row on the fly using the same logic as `useLineFirstStreaks`, and
// render it.
//
// Team streaks are intentionally NOT supported in this surface for now — see
// the explicit early-return below. Until we ship a team-line-first model
// (team totals / spreads / ML lines), surfacing legacy team milestone streaks
// here would contradict the rest of the app.
// =============================================================================
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useWatchlist } from "@/hooks/useWatchlist";
import { StreakDetailHeader } from "@/components/StreakDetailHeader";
import { StreakStats } from "@/components/StreakStats";
import { RecentGamesList } from "@/components/RecentGamesList";
import type { Streak } from "@/types/streak";
import {
  buildBookableLines,
  computeLineSplits,
  mlbHitterValue,
  mlbPitcherValue,
  nbaStatValue,
  type LineSnapshotRow,
  type MlbHitterLog,
  type MlbPitcherLog,
  type NbaGameLog,
} from "@/lib/lineFirstStreaks";

const MLB_HITTER_CODES = new Set(["HITS", "TOTAL_BASES", "HOME_RUNS"]);
const MLB_PITCHER_CODES = new Set(["STRIKEOUTS", "EARNED_RUNS_ALLOWED", "WALKS_ALLOWED", "HITS_ALLOWED"]);

const StreakDetailPage = () => {
  const [searchParams] = useSearchParams();
  const { isStarred, toggleWatchlist } = useWatchlist();

  const sport = searchParams.get("sport") || "NBA";
  const entityType = searchParams.get("entity_type") || "player";
  const playerIdParam = searchParams.get("player_id");
  const stat = searchParams.get("stat") || "";
  const thresholdParam = searchParams.get("threshold");
  const playerId = playerIdParam ? parseInt(playerIdParam, 10) : null;
  const requestedThreshold = thresholdParam ? parseFloat(thresholdParam) : null;

  // Team streak surfaces are intentionally disabled — we only show
  // line-first player streaks here.
  const isTeamRequest = entityType === "team";

  // Build the streak from live book lines + game logs.
  const { data: streak, isLoading: streakLoading } = useQuery({
    queryKey: ["streak-detail-line-first", sport, playerId, stat, requestedThreshold],
    enabled: !isTeamRequest && !!playerId && !!stat,
    queryFn: async (): Promise<Streak | null> => {
      if (!playerId) return null;

      // 1) Pull recent line_snapshots for this player+stat across the league.
      //    We then reduce them to find the main bookable line that best
      //    matches the requested threshold.
      const since = new Date();
      since.setDate(since.getDate() - 2);
      const sinceDate = since.toISOString().slice(0, 10);

      const { data: snapRows, error: snapErr } = await supabase
        .from("line_snapshots")
        .select("player_id, player_name, stat_type, threshold, game_date, sportsbook")
        .eq("player_id", playerId)
        .gte("game_date", sinceDate)
        .limit(2000);
      if (snapErr) throw snapErr;

      const lines = buildBookableLines((snapRows ?? []) as LineSnapshotRow[]).filter(
        (l) => l.stat_code === stat,
      );
      if (lines.length === 0) return null;

      // Prefer the line whose threshold matches what the URL asked for,
      // else fall back to the most-booked main line.
      const chosen =
        (requestedThreshold != null
          ? lines.find((l) => Math.abs(l.main_threshold - requestedThreshold) < 1e-6)
          : null) ?? lines[0];

      // 2) Load this player's recent game logs from the right table.
      const today = new Date().toISOString().slice(0, 10);
      let values: (number | null)[] = [];
      let dates: string[] = [];
      let teamAbbr: string | null = null;

      if (sport === "MLB" && MLB_HITTER_CODES.has(stat)) {
        const { data } = await supabase
          .from("mlb_hitter_game_logs")
          .select("game_date, hits, total_bases, home_runs")
          .eq("player_id", playerId)
          .order("game_date", { ascending: false })
          .limit(60);
        const games = (data ?? []) as MlbHitterLog[];
        values = games.map((g) => mlbHitterValue(g, stat));
        dates = games.map((g) => g.game_date);
      } else if (sport === "MLB" && MLB_PITCHER_CODES.has(stat)) {
        const { data } = await supabase
          .from("mlb_pitcher_game_logs")
          .select("game_date, strikeouts, earned_runs_allowed, walks_allowed, hits_allowed")
          .eq("player_id", playerId)
          .order("game_date", { ascending: false })
          .limit(40);
        const games = (data ?? []) as MlbPitcherLog[];
        values = games.map((g) => mlbPitcherValue(g, stat));
        dates = games.map((g) => g.game_date);
      } else {
        // NBA / WNBA share player_recent_games
        const { data } = await supabase
          .from("player_recent_games")
          .select("game_date, pts, reb, ast, fg3m, blk, stl, team_abbr")
          .eq("player_id", playerId)
          .order("game_date", { ascending: false })
          .limit(40);
        const games = (data ?? []) as (NbaGameLog & { team_abbr: string | null })[];
        values = games.map((g) => nbaStatValue(g, stat));
        dates = games.map((g) => g.game_date);
        teamAbbr = games.find((g) => g.team_abbr)?.team_abbr ?? null;
      }

      if (dates.length === 0) return null;

      const splits = computeLineSplits(values, dates, chosen.main_threshold);

      const result: Streak = {
        id: `lf-${playerId}-${stat}-${chosen.main_threshold}`,
        player_id: playerId,
        player_name: chosen.player_name,
        team_abbr: teamAbbr,
        stat,
        threshold: chosen.main_threshold,
        streak_len: splits.streak_len,
        streak_start: splits.streak_start || today,
        streak_win_pct: splits.streak_len > 0 ? 100 : 0,
        season_wins: splits.season_wins,
        season_games: splits.season_games,
        season_win_pct: splits.season_win_pct,
        last_game: splits.last_game || today,
        sport,
        entity_type: "player",
        updated_at: today,
        last10_hits: splits.last10_hits,
        last10_games: splits.last10_games,
        last10_hit_pct: splits.last10_hit_pct,
        last5_hits: splits.last5_hits,
        last5_games: splits.last5_games,
        last5_hit_pct: splits.last5_hit_pct,
        book_threshold: chosen.main_threshold,
        book_main_threshold: chosen.main_threshold,
        book_informational: false,
      };
      return result;
    },
  });

  // Refresh status timestamp (id=1) for "last updated" display.
  const { data: refreshStatus } = useQuery({
    queryKey: ["refresh-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refresh_status")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Recent games for the panel below — same source as before.
  const { data: recentGames, isLoading: gamesLoading } = useQuery({
    queryKey: ["recent-games-line-first", sport, playerId],
    enabled: !isTeamRequest && !!playerId,
    queryFn: async () => {
      if (!playerId) return [];
      // For MLB we don't have a unified "recent games" table that matches
      // the NBA shape RecentGamesList expects, so we keep this NBA/WNBA-only
      // for now. MLB users still get the full splits in StreakStats above.
      if (sport === "MLB") return [];
      const { data, error } = await supabase
        .from("player_recent_games")
        .select("*")
        .eq("player_id", playerId)
        .order("game_date", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  const starred = streak ? isStarred(streak) : false;
  const handleToggleStar = () => {
    if (streak) toggleWatchlist(streak);
  };

  // Explicit team-streak product decision: not supported in this surface.
  if (isTeamRequest) {
    return (
      <div className="min-h-screen bg-background flex flex-col pb-20">
        <StreakDetailHeader streak={null} isLoading={false} isStarred={false} onToggleStar={() => {}} />
        <main className="flex-1 px-4 py-12">
          <div className="max-w-md mx-auto text-center space-y-3">
            <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground/60" />
            <h2 className="text-base font-semibold text-foreground">
              Team streaks aren't available yet
            </h2>
            <p className="text-sm text-muted-foreground">
              BetStreaks is now sportsbook-line-first. Team-level streaks will return once we
              wire moneyline, spread, and team total lines into the same pipeline. For now,
              browse player streaks tied to live book lines.
            </p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20">
      <StreakDetailHeader
        streak={streak ?? null}
        isLoading={streakLoading}
        isStarred={starred}
        onToggleStar={handleToggleStar}
      />

      <main className="flex-1 px-4 py-4 space-y-4">
        {streakLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : !streak ? (
          <div className="text-center py-12 max-w-md mx-auto space-y-2">
            <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No live sportsbook line</p>
            <p className="text-xs text-muted-foreground">
              We couldn't find a current book line for this player + stat, so this streak
              isn't actionable right now. Check back closer to tip-off.
            </p>
          </div>
        ) : (
          <>
            <StreakStats streak={streak} lastUpdated={refreshStatus?.last_run ?? null} />
            <RecentGamesList
              games={recentGames || []}
              stat={stat}
              threshold={streak.threshold}
              isLoading={gamesLoading}
            />
          </>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default StreakDetailPage;
