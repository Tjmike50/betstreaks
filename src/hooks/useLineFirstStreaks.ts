// =============================================================================
// useLineFirstStreaks — sportsbook-line-first replacement for useStreaks.
//
// NBA source of truth: get_today_nba_props RPC (internal normalized odds layer).
// WNBA / MLB fallback: legacy line_snapshots path until their normalized layers
// are wired the same way.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSport } from "@/contexts/SportContext";
import type { SportKey } from "@/lib/sports/registry";
import type { Streak, StreakFilters } from "@/types/streak";
import { calculateBestBetsScore } from "@/types/streak";
import { isLeagueTeam, isInScopeTeam } from "@/lib/sports/leagueTeams";
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

const NBA_CODES = new Set(["PTS", "REB", "AST", "3PM", "BLK", "STL"]);
const MLB_HITTER_CODES = new Set(["HITS", "TOTAL_BASES", "HOME_RUNS"]);
const MLB_PITCHER_CODES = new Set(["STRIKEOUTS", "EARNED_RUNS_ALLOWED", "WALKS_ALLOWED", "HITS_ALLOWED"]);

/** Keep at most this many bookable lines per request — protects perf on busy slates. */
const MAX_LINES_PER_SPORT = 250;

interface PlayerTeamRow {
  player_id: number;
  team_abbr: string | null;
}

interface NbaPropRow {
  event_id: string;
  player_id: string;
  player_name: string;
  market_type: string;
  line: number | null;
  book_count: number | null;
  home_team_abbr: string | null;
  away_team_abbr: string | null;
  commence_time: string | null;
}

const MARKET_TYPE_TO_STAT_CODE: Record<string, string> = {
  player_points: "PTS",
  player_rebounds: "REB",
  player_assists: "AST",
  player_threes: "3PM",
  player_blocks: "BLK",
  player_steals: "STL",
};

function getETDate(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

function roundToNearestHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

async function attachLatestNumericPlayerIdsByName(playerNames: string[]): Promise<Map<string, number>> {
  if (playerNames.length === 0) return new Map();

  const uniqueNames = [...new Set(playerNames.filter(Boolean))];
  const { data, error } = await supabase
    .from("player_recent_games")
    .select("player_id, player_name, game_date")
    .in("player_name", uniqueNames)
    .order("game_date", { ascending: false })
    .limit(10000);

  if (error) throw error;

  const out = new Map<string, number>();
  for (const row of (data ?? []) as {
    player_id: number;
    player_name: string;
    game_date: string;
  }[]) {
    if (!out.has(row.player_name) && row.player_id != null) {
      out.set(row.player_name, row.player_id);
    }
  }
  return out;
}

async function loadNbaBookableLinesFromRpc(): Promise<BookableLine[]> {
  const { data, error } = await supabase.rpc("get_today_nba_props");
  if (error) throw error;

  const rows = ((data ?? []) as unknown as NbaPropRow[]).filter(
    (row) =>
      !!row.player_name &&
      !!row.market_type &&
      row.line != null &&
      Number.isFinite(Number(row.line)) &&
      !!MARKET_TYPE_TO_STAT_CODE[row.market_type],
  );

  if (rows.length === 0) return [];

  const numericIdByName = await attachLatestNumericPlayerIdsByName(rows.map((row) => row.player_name));

  // Deduplicate by player_name + market_type and keep the row with the highest
  // book_count, then latest commence_time as a tiebreaker.
  const byKey = new Map<string, NbaPropRow>();
  for (const row of rows) {
    const key = `${row.player_name}__${row.market_type}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }

    const prevBooks = Number(prev.book_count ?? 0);
    const nextBooks = Number(row.book_count ?? 0);

    if (nextBooks > prevBooks) {
      byKey.set(key, row);
      continue;
    }

    if (nextBooks === prevBooks && (row.commence_time ?? "") > (prev.commence_time ?? "")) {
      byKey.set(key, row);
    }
  }

  const today = getETDate();
  const lines: BookableLine[] = [];

  for (const row of byKey.values()) {
    const numericPlayerId = numericIdByName.get(row.player_name);
    if (numericPlayerId == null) continue;

    lines.push({
      player_id: numericPlayerId,
      player_name: row.player_name,
      stat_code: MARKET_TYPE_TO_STAT_CODE[row.market_type],
      main_threshold: roundToNearestHalf(Number(row.line)),
      game_date: today,
      books_count: Number(row.book_count ?? 0),
    } as BookableLine);
  }

  lines.sort((a, b) => {
    if ((a.game_date ?? "") !== (b.game_date ?? "")) {
      return (a.game_date ?? "") < (b.game_date ?? "") ? 1 : -1;
    }
    return Number(b.books_count ?? 0) - Number(a.books_count ?? 0);
  });

  return lines.slice(0, MAX_LINES_PER_SPORT);
}

async function loadBookableLinesFromSnapshots(sport: SportKey, daysBack = 1): Promise<BookableLine[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceDate = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("line_snapshots")
    .select("player_id, player_name, stat_type, threshold, game_date, sportsbook")
    .gte("game_date", sinceDate)
    .limit(20000);

  if (error) throw error;

  const allowed = sport === "MLB" ? new Set([...MLB_HITTER_CODES, ...MLB_PITCHER_CODES]) : NBA_CODES; // WNBA shares the same per-stat codes as NBA on this legacy path

  const filtered = (data ?? []) as LineSnapshotRow[];
  const lines = buildBookableLines(filtered).filter((l) => allowed.has(l.stat_code));

  lines.sort((a, b) => {
    if (a.game_date !== b.game_date) return a.game_date < b.game_date ? 1 : -1;
    return b.books_count - a.books_count;
  });

  return lines.slice(0, MAX_LINES_PER_SPORT);
}

async function loadBookableLines(sport: SportKey, daysBack = 1): Promise<BookableLine[]> {
  // NBA is now sourced from the normalized internal RPC.
  if (sport === "NBA") {
    return loadNbaBookableLinesFromRpc();
  }

  // WNBA / MLB remain on the legacy snapshot path until their normalized
  // internal sources are wired up.
  return loadBookableLinesFromSnapshots(sport, daysBack);
}

async function attachTeamAbbrs(playerIds: number[], sport: SportKey): Promise<Map<number, string | null>> {
  if (playerIds.length === 0) return new Map();
  const map = new Map<number, string | null>();

  if (sport === "MLB") {
    const { data } = await supabase
      .from("player_prop_scores")
      .select("player_id, team_abbr")
      .in("player_id", playerIds)
      .eq("sport", "MLB")
      .order("scored_at", { ascending: false })
      .limit(2000);

    for (const row of (data ?? []) as PlayerTeamRow[]) {
      if (!map.has(row.player_id) && row.team_abbr) {
        map.set(row.player_id, row.team_abbr);
      }
    }
  } else {
    const { data } = await supabase
      .from("player_recent_games")
      .select("player_id, team_abbr, game_date")
      .in("player_id", playerIds)
      .order("game_date", { ascending: false })
      .limit(5000);

    for (const row of (data ?? []) as {
      player_id: number;
      team_abbr: string | null;
    }[]) {
      if (!map.has(row.player_id) && row.team_abbr) {
        map.set(row.player_id, row.team_abbr);
      }
    }
  }

  return map;
}

async function buildNbaStreaks(lines: BookableLine[], sport: SportKey): Promise<Streak[]> {
  const ids = [...new Set(lines.map((l) => l.player_id).filter((x): x is number => x != null))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("player_recent_games")
    .select("player_id, game_date, pts, reb, ast, fg3m, blk, stl")
    .in("player_id", ids)
    .order("game_date", { ascending: false })
    .limit(10000);

  if (error) throw error;

  const byPlayer = new Map<number, NbaGameLog[]>();
  for (const row of (data ?? []) as (NbaGameLog & { player_id: number })[]) {
    const arr = byPlayer.get(row.player_id) ?? [];
    arr.push(row);
    byPlayer.set(row.player_id, arr);
  }

  const teamMap = await attachTeamAbbrs(ids, sport);
  const out: Streak[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const line of lines) {
    if (line.player_id == null) continue;
    const games = byPlayer.get(line.player_id) ?? [];
    if (games.length === 0) continue;

    const dates = games.map((g) => g.game_date);
    const values = games.map((g) => nbaStatValue(g, line.stat_code));
    const splits = computeLineSplits(values, dates, line.main_threshold);
    if (splits.season_games === 0) continue;

    const team_abbr = teamMap.get(line.player_id) ?? null;

    out.push({
      id: `lf-${line.player_id}-${line.stat_code}-${line.main_threshold}`,
      player_id: line.player_id,
      player_name: line.player_name,
      team_abbr,
      stat: line.stat_code,
      threshold: line.main_threshold,
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
      book_threshold: line.main_threshold,
      book_main_threshold: line.main_threshold,
      book_informational: false,
    });
  }

  return out;
}

async function buildMlbStreaks(lines: BookableLine[]): Promise<Streak[]> {
  const hitterLines = lines.filter((l) => MLB_HITTER_CODES.has(l.stat_code));
  const pitcherLines = lines.filter((l) => MLB_PITCHER_CODES.has(l.stat_code));
  const hitterIds = [...new Set(hitterLines.map((l) => l.player_id).filter((x): x is number => x != null))];
  const pitcherIds = [...new Set(pitcherLines.map((l) => l.player_id).filter((x): x is number => x != null))];

  const [hitterLogsRes, pitcherLogsRes] = await Promise.all([
    hitterIds.length
      ? supabase
          .from("mlb_hitter_game_logs")
          .select("player_id, game_date, hits, total_bases, home_runs")
          .in("player_id", hitterIds)
          .order("game_date", { ascending: false })
          .limit(10000)
      : Promise.resolve({ data: [], error: null }),
    pitcherIds.length
      ? supabase
          .from("mlb_pitcher_game_logs")
          .select("player_id, game_date, strikeouts, earned_runs_allowed, walks_allowed, hits_allowed")
          .in("player_id", pitcherIds)
          .order("game_date", { ascending: false })
          .limit(10000)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (hitterLogsRes.error) throw hitterLogsRes.error;
  if (pitcherLogsRes.error) throw pitcherLogsRes.error;

  const hitterByPlayer = new Map<number, MlbHitterLog[]>();
  for (const row of (hitterLogsRes.data ?? []) as (MlbHitterLog & {
    player_id: number;
  })[]) {
    const arr = hitterByPlayer.get(row.player_id) ?? [];
    arr.push(row);
    hitterByPlayer.set(row.player_id, arr);
  }

  const pitcherByPlayer = new Map<number, MlbPitcherLog[]>();
  for (const row of (pitcherLogsRes.data ?? []) as (MlbPitcherLog & {
    player_id: number;
  })[]) {
    const arr = pitcherByPlayer.get(row.player_id) ?? [];
    arr.push(row);
    pitcherByPlayer.set(row.player_id, arr);
  }

  const allIds = [...hitterIds, ...pitcherIds];
  const teamMap = await attachTeamAbbrs(allIds, "MLB");
  const today = new Date().toISOString().slice(0, 10);
  const out: Streak[] = [];

  const push = (line: BookableLine, splits: ReturnType<typeof computeLineSplits>) => {
    if (splits.season_games === 0) return;
    const team_abbr = line.player_id != null ? (teamMap.get(line.player_id) ?? null) : null;

    out.push({
      id: `lf-mlb-${line.player_id}-${line.stat_code}-${line.main_threshold}`,
      player_id: line.player_id ?? 0,
      player_name: line.player_name,
      team_abbr,
      stat: line.stat_code,
      threshold: line.main_threshold,
      streak_len: splits.streak_len,
      streak_start: splits.streak_start || today,
      streak_win_pct: splits.streak_len > 0 ? 100 : 0,
      season_wins: splits.season_wins,
      season_games: splits.season_games,
      season_win_pct: splits.season_win_pct,
      last_game: splits.last_game || today,
      sport: "MLB",
      entity_type: "player",
      updated_at: today,
      last10_hits: splits.last10_hits,
      last10_games: splits.last10_games,
      last10_hit_pct: splits.last10_hit_pct,
      last5_hits: splits.last5_hits,
      last5_games: splits.last5_games,
      last5_hit_pct: splits.last5_hit_pct,
      book_threshold: line.main_threshold,
      book_main_threshold: line.main_threshold,
      book_informational: false,
    });
  };

  for (const line of hitterLines) {
    if (line.player_id == null) continue;
    const games = hitterByPlayer.get(line.player_id) ?? [];
    const splits = computeLineSplits(
      games.map((g) => mlbHitterValue(g, line.stat_code)),
      games.map((g) => g.game_date),
      line.main_threshold,
    );
    push(line, splits);
  }

  for (const line of pitcherLines) {
    if (line.player_id == null) continue;
    const games = pitcherByPlayer.get(line.player_id) ?? [];
    const splits = computeLineSplits(
      games.map((g) => mlbPitcherValue(g, line.stat_code)),
      games.map((g) => g.game_date),
      line.main_threshold,
    );
    push(line, splits);
  }

  return out;
}

function applyFiltersAndSort(rows: Streak[], filters: StreakFilters, sport: SportKey): Streak[] {
  let out = rows.filter((s) => {
    if (s.team_abbr) {
      if (!isLeagueTeam(sport, s.team_abbr)) return false;
      if (!isInScopeTeam(sport, s.team_abbr)) return false;
    }
    return true;
  });

  if (filters.stat !== "All") {
    out = out.filter((s) => s.stat === filters.stat);
  }
  if (filters.playerSearch.trim()) {
    const q = filters.playerSearch.trim().toLowerCase();
    out = out.filter((s) => s.player_name.toLowerCase().includes(q));
  }
  if (filters.minStreak > 0) {
    out = out.filter((s) => s.streak_len >= filters.minStreak);
  }
  if (filters.minSeasonWinPct > 0) {
    out = out.filter((s) => s.season_win_pct >= filters.minSeasonWinPct);
  }
  if (filters.thresholdMin != null) {
    out = out.filter((s) => s.threshold >= filters.thresholdMin!);
  }
  if (filters.thresholdMax != null) {
    out = out.filter((s) => s.threshold <= filters.thresholdMax!);
  }
  if (filters.teamFilter && filters.teamFilter !== "All") {
    out = out.filter((s) => s.team_abbr === filters.teamFilter);
  }
  if (filters.recentOnly) {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const cutoff = threeDaysAgo.toISOString().slice(0, 10);
    out = out.filter((s) => s.last_game >= cutoff);
  }
  if (filters.bestBets) {
    out = out.filter((s) => s.streak_len >= 3 && (s.season_win_pct >= 55 || (s.last10_hit_pct ?? 0) >= 60));
  }

  out.sort((a, b) => {
    switch (filters.sortBy) {
      case "season":
        if (b.season_win_pct !== a.season_win_pct) {
          return b.season_win_pct - a.season_win_pct;
        }
        return b.streak_len - a.streak_len;
      case "l10": {
        const aL10 = a.last10_hit_pct ?? 0;
        const bL10 = b.last10_hit_pct ?? 0;
        if (bL10 !== aL10) return bL10 - aL10;
        return b.streak_len - a.streak_len;
      }
      case "recent":
        return b.last_game.localeCompare(a.last_game);
      case "threshold":
        if (b.threshold !== a.threshold) return b.threshold - a.threshold;
        return b.streak_len - a.streak_len;
      case "bestBetsScore":
        return calculateBestBetsScore(b) - calculateBestBetsScore(a);
      case "streak":
      default:
        if (b.streak_len !== a.streak_len) return b.streak_len - a.streak_len;
        if (b.season_win_pct !== a.season_win_pct) {
          return b.season_win_pct - a.season_win_pct;
        }
        return b.last_game.localeCompare(a.last_game);
    }
  });

  return out;
}

/**
 * Sportsbook-line-first streaks.
 *
 * NBA now uses the internal normalized props RPC.
 * WNBA / MLB still use the legacy snapshot path until their normalized
 * equivalents are wired.
 */
export function useLineFirstStreaks(filters: StreakFilters, sportOverride?: SportKey) {
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;

  return useQuery({
    queryKey: ["lineFirstStreaks", sport, filters],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (filters.entityType === "team") return [];

      const lines = await loadBookableLines(sport);
      if (lines.length === 0) return [];

      const rows = sport === "MLB" ? await buildMlbStreaks(lines) : await buildNbaStreaks(lines, sport);

      return applyFiltersAndSort(rows, filters, sport);
    },
  });
}
