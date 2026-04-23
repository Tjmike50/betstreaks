// =============================================================================
// StreakDetailPage — sportsbook-line-first.
//
// NBA: resolves (player, stat) against today's `get_today_nba_props` RPC.
// MLB/WNBA: falls back to legacy `line_snapshots` until their normalized
// layers are wired.
//
// Team streaks are intentionally NOT supported in this surface for now.
// =============================================================================
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
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
  type BookableLine,
  type LineSnapshotRow,
  type MlbHitterLog,
  type MlbPitcherLog,
  type NbaGameLog,
} from "@/lib/lineFirstStreaks";

const MLB_HITTER_CODES = new Set(["HITS", "TOTAL_BASES", "HOME_RUNS"]);
const MLB_PITCHER_CODES = new Set(["STRIKEOUTS", "EARNED_RUNS_ALLOWED", "WALKS_ALLOWED", "HITS_ALLOWED"]);

const MARKET_TYPE_TO_STAT_CODE: Record<string, string> = {
  player_points: "PTS",
  player_rebounds: "REB",
  player_assists: "AST",
  player_threes: "3PM",
  player_blocks: "BLK",
  player_steals: "STL",
};

interface NbaPropRow {
  player_name: string;
  market_type: string;
  line: number | null;
  book_count: number | null;
  event_id: string;
  player_id: string;
  best_over_line: number | null;
  best_over_odds_american: number | null;
  best_over_sportsbook_name: string | null;
  best_under_line: number | null;
  best_under_odds_american: number | null;
  best_under_sportsbook_name: string | null;
}

interface LineMovementRow {
  opening_line: number | null;
  current_line: number | null;
  move_amount: number | null;
}

function roundToNearestHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function formatOdds(odds: number | null): string {
  if (odds == null) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

/** Best-line + movement card shown on NBA streak detail pages */
function BestLineCard({ prop, movement }: { prop: NbaPropRow; movement: LineMovementRow | null }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">Best Available Lines</p>

        <div className="grid grid-cols-2 gap-3 text-xs">
          {/* Over */}
          <div className="rounded-md bg-secondary/60 p-2 space-y-0.5">
            <p className="text-muted-foreground">Best Over</p>
            <p className="text-sm font-medium text-foreground tabular-nums">
              O {prop.best_over_line ?? prop.line}{" "}
              <span className="text-green-400">{formatOdds(prop.best_over_odds_american)}</span>
            </p>
            {prop.best_over_sportsbook_name && (
              <p className="text-muted-foreground/70">{prop.best_over_sportsbook_name}</p>
            )}
          </div>

          {/* Under */}
          <div className="rounded-md bg-secondary/60 p-2 space-y-0.5">
            <p className="text-muted-foreground">Best Under</p>
            <p className="text-sm font-medium text-foreground tabular-nums">
              U {prop.best_under_line ?? prop.line}{" "}
              <span className="text-red-400">{formatOdds(prop.best_under_odds_american)}</span>
            </p>
            {prop.best_under_sportsbook_name && (
              <p className="text-muted-foreground/70">{prop.best_under_sportsbook_name}</p>
            )}
          </div>
        </div>

        {/* Consensus */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            Consensus: <span className="text-foreground font-medium tabular-nums">{prop.line ?? "—"}</span>
          </span>
          {prop.book_count != null && (
            <span>
              {prop.book_count} {Number(prop.book_count) === 1 ? "book" : "books"}
            </span>
          )}
        </div>

        {/* Movement */}
        {movement && movement.opening_line != null && movement.current_line != null && (
          <div className="flex items-center gap-2 text-xs border-t border-border pt-2">
            {movement.move_amount != null && Math.abs(movement.move_amount) >= 0.01 ? (
              movement.move_amount > 0 ? (
                <TrendingUp className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-red-400" />
              )
            ) : (
              <Minus className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-muted-foreground">
              Line moved{" "}
              <span className="text-foreground font-medium tabular-nums">{movement.opening_line}</span>
              {" → "}
              <span className="text-foreground font-medium tabular-nums">{movement.current_line}</span>
            </span>
            {movement.move_amount != null && Math.abs(movement.move_amount) >= 0.01 && (
              <span
                className={
                  movement.move_amount > 0
                    ? "text-green-400 font-medium tabular-nums"
                    : "text-red-400 font-medium tabular-nums"
                }
              >
                ({movement.move_amount > 0 ? "+" : ""}
                {movement.move_amount.toFixed(1)})
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

  const isTeamRequest = entityType === "team";

  // Build the streak from live book lines + game logs.
  // Also capture the matched NbaPropRow for best-line display.
  const { data: streakData, isLoading: streakLoading } = useQuery({
    queryKey: ["streak-detail-line-first", sport, playerId, stat, requestedThreshold],
    enabled: !isTeamRequest && !!playerId && !!stat,
    queryFn: async (): Promise<{ streak: Streak; matchedProp: NbaPropRow | null } | null> => {
      if (!playerId) return null;

      let lines: BookableLine[] = [];
      let matchedProp: NbaPropRow | null = null;

      if (sport === "NBA") {
        const { data: rpcData, error: rpcErr } = await supabase.rpc("get_today_nba_props");
        if (rpcErr) throw rpcErr;

        const rpcRows = ((rpcData ?? []) as unknown as NbaPropRow[]).filter(
          (r) =>
            r.player_name &&
            r.market_type &&
            r.line != null &&
            MARKET_TYPE_TO_STAT_CODE[r.market_type] === stat,
        );

        const { data: nameRow } = await supabase
          .from("player_recent_games")
          .select("player_name")
          .eq("player_id", playerId)
          .limit(1)
          .maybeSingle();

        const playerName = nameRow?.player_name;
        const matched = playerName
          ? rpcRows.filter((r) => r.player_name.toLowerCase() === playerName.toLowerCase())
          : [];

        if (matched.length > 0) {
          const best = matched.reduce((a, b) =>
            (Number(b.book_count ?? 0) > Number(a.book_count ?? 0) ? b : a), matched[0]);
          matchedProp = best;
          lines = [{
            player_id: playerId,
            player_name: best.player_name,
            stat_code: stat,
            main_threshold: roundToNearestHalf(Number(best.line)),
            alt_thresholds: [],
            books_count: Number(best.book_count ?? 0),
            game_date: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
          }];
        }
      } else {
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

        lines = buildBookableLines((snapRows ?? []) as LineSnapshotRow[]).filter(
          (l) => l.stat_code === stat,
        );
      }

      if (lines.length === 0) return null;

      const chosen =
        (requestedThreshold != null
          ? lines.find((l) => Math.abs(l.main_threshold - requestedThreshold) < 1e-6)
          : null) ?? lines[0];

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

      const streak: Streak = {
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
      return { streak, matchedProp };
    },
  });

  const streak = streakData?.streak ?? null;
  const matchedProp = streakData?.matchedProp ?? null;

  // Fetch line movement for the matched prop (NBA only)
  const { data: movementRow } = useQuery({
    queryKey: ["streak-line-movement", matchedProp?.event_id, matchedProp?.player_id, matchedProp?.market_type],
    enabled: sport === "NBA" && !!matchedProp?.event_id,
    queryFn: async (): Promise<LineMovementRow | null> => {
      if (!matchedProp) return null;
      const { data, error } = await supabase
        .from("line_movement_summary" as any)
        .select("opening_line, current_line, move_amount")
        .eq("event_id", matchedProp.event_id)
        .eq("player_id", matchedProp.player_id)
        .eq("market_type", matchedProp.market_type)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as LineMovementRow) ?? null;
    },
    staleTime: 90_000,
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

  // Recent games for the panel below
  const { data: recentGames, isLoading: gamesLoading } = useQuery({
    queryKey: ["recent-games-line-first", sport, playerId],
    enabled: !isTeamRequest && !!playerId,
    queryFn: async () => {
      if (!playerId) return [];
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
        streak={streak}
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

            {/* Best-line + movement card (NBA only) */}
            {matchedProp && (
              <BestLineCard prop={matchedProp} movement={movementRow ?? null} />
            )}

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
