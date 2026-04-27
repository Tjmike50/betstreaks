import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSport } from "@/contexts/SportContext";
import { isInScopeTeam, isLeagueTeam } from "@/lib/sports/leagueTeams";
import type { SportKey } from "@/lib/sports/registry";

export type CheatsheetCategory = "value" | "streaks" | "matchups" | "best-bets";

export interface CheatsheetRow {
  id: string;
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  home_away: string | null;
  stat_type: string;
  threshold: number;
  confidence_score: number | null;
  value_score: number | null;
  consistency_score: number | null;
  volatility_score: number | null;
  score_overall: number | null;
  score_recent_form: number | null;
  score_matchup: number | null;
  score_opportunity: number | null;
  score_consistency: number | null;
  score_value: number | null;
  score_risk: number | null;
  confidence_tier: string | null;
  summary_json: unknown;
  last5_avg: number | null;
  last10_avg: number | null;
  season_avg: number | null;
  last5_hit_rate: number | null;
  last10_hit_rate: number | null;
  season_hit_rate: number | null;
  vs_opponent_hit_rate: number | null;
  vs_opponent_games: number | null;
  reason_tags: unknown;
  game_date: string;
  sport: string;
}

export interface CheatsheetResult {
  rows: CheatsheetRow[];
  requestedDate: string;
  effectiveDate: string | null;
  usingLatestFallback: boolean;
  activeTeams: string[];
  emptyReason: string | null;
}

export interface UseCheatsheetOptions {
  category: CheatsheetCategory;
  sport?: SportKey;
  limit?: number;
  minValueScore?: number;
  minConfidence?: number;
}

const DEFAULT_LIMIT = 50;
const MLB_ANCHOR_STATS = [
  "HITS",
  "TOTAL_BASES",
  "STRIKEOUTS",
  "HOME_RUNS",
  "EARNED_RUNS_ALLOWED",
  "WALKS_ALLOWED",
  "HITS_ALLOWED",
] as const;

const SELECT_COLUMNS =
  "id, player_id, player_name, team_abbr, opponent_abbr, home_away, stat_type, threshold, confidence_score, value_score, consistency_score, volatility_score, score_overall, score_recent_form, score_matchup, score_opportunity, score_consistency, score_value, score_risk, confidence_tier, summary_json, last5_avg, last10_avg, season_avg, last5_hit_rate, last10_hit_rate, season_hit_rate, vs_opponent_hit_rate, vs_opponent_games, reason_tags, game_date, sport" as const;

function getTodayEtDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function passesScope(sport: SportKey, teamAbbr: string | null): boolean {
  if (sport === "MLB") return true;
  if (isInScopeTeam(sport, teamAbbr)) return true;
  return isLeagueTeam(sport, teamAbbr);
}

function normalizeRate(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value <= 1 ? value * 100 : value;
}

function normalizeScore(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? "").trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function getSummaryFieldNumber(summary: unknown, key: string): number | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const raw = (summary as Record<string, unknown>)[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasAnyTag(tags: string[], patterns: string[]): boolean {
  return patterns.some((pattern) => tags.some((tag) => tag.includes(pattern)));
}

function tierPriority(tier: string | null | undefined): number {
  switch ((tier ?? "").toLowerCase()) {
    case "elite":
      return 4;
    case "strong":
      return 3;
    case "medium":
      return 2;
    case "lean":
      return 2;
    case "pass":
      return 1;
    default:
      return 0;
  }
}

function compareDesc(a: number, b: number): number {
  return b - a;
}

function decorateRows(rows: CheatsheetRow[]): CheatsheetRow[] {
  return rows.map((row) => {
    const confidenceScore = normalizeScore(row.confidence_score);
    const scoreOverall = row.score_overall ?? confidenceScore;
    const scoreValue = row.score_value ?? row.value_score ?? confidenceScore;
    const confidenceTier =
      row.confidence_tier ??
      (confidenceScore >= 75
        ? "elite"
        : confidenceScore >= 60
        ? "strong"
        : confidenceScore >= 45
        ? "lean"
        : "pass");

    return {
      ...row,
      score_overall: scoreOverall,
      score_value: scoreValue,
      confidence_tier: confidenceTier,
    };
  });
}

function filterRowsForCategory(
  rows: CheatsheetRow[],
  category: CheatsheetCategory,
  sport: SportKey,
  minValueScore: number,
  minConfidence: number,
): CheatsheetRow[] {
  const withDerived = decorateRows(rows);

  if (category === "value") {
    return withDerived
      .filter((row) =>
        row.threshold != null &&
        normalizeScore(row.score_value ?? row.value_score) >= (sport === "MLB" ? 50 : minValueScore)
      )
      .sort((a, b) => {
        const valueDelta = compareDesc(normalizeScore(a.score_value ?? a.value_score), normalizeScore(b.score_value ?? b.value_score));
        if (valueDelta !== 0) return valueDelta;
        return compareDesc(normalizeScore(a.confidence_score), normalizeScore(b.confidence_score));
      });
  }

  if (category === "best-bets") {
    return withDerived
      .filter((row) => {
        const tier = String(row.confidence_tier ?? "").toLowerCase();
        return ["elite", "strong", "medium", "lean"].includes(tier) || normalizeScore(row.confidence_score) >= minConfidence;
      })
      .sort((a, b) => {
        const confidenceDelta = compareDesc(normalizeScore(a.confidence_score), normalizeScore(b.confidence_score));
        if (confidenceDelta !== 0) return confidenceDelta;
        return compareDesc(normalizeScore(a.score_overall), normalizeScore(b.score_overall));
      });
  }

  if (category === "streaks") {
    return withDerived
      .filter((row) => {
        const tags = normalizeTags(row.reason_tags);
        const l10 = normalizeRate(row.last10_hit_rate);
        const recentForm = normalizeScore(row.score_recent_form ?? row.score_overall);
        return hasAnyTag(tags, ["hot_streak", "trending_up", "cashing", "streak"]) || l10 >= 70 || recentForm >= 60;
      })
      .sort((a, b) => {
        const l10Delta = compareDesc(
          Math.max(normalizeRate(a.last10_hit_rate), normalizeScore(a.score_recent_form)),
          Math.max(normalizeRate(b.last10_hit_rate), normalizeScore(b.score_recent_form)),
        );
        if (l10Delta !== 0) return l10Delta;
        return compareDesc(normalizeScore(a.confidence_score), normalizeScore(b.confidence_score));
      });
  }

  return withDerived
    .filter((row) => {
      const tags = normalizeTags(row.reason_tags);
      const vsOppRate = normalizeRate(row.vs_opponent_hit_rate);
      const matchupScore = normalizeScore(row.score_matchup ?? row.score_overall);
      return vsOppRate >= 60 || matchupScore >= 55 || hasAnyTag(tags, ["matchup", "favorable", "opp"]);
    })
    .sort((a, b) => {
      const matchupDelta = compareDesc(
        Math.max(normalizeRate(a.vs_opponent_hit_rate), normalizeScore(a.score_matchup)),
        Math.max(normalizeRate(b.vs_opponent_hit_rate), normalizeScore(b.score_matchup)),
      );
      if (matchupDelta !== 0) return matchupDelta;
      return compareDesc(normalizeScore(a.confidence_score), normalizeScore(b.confidence_score));
    });
}

export function useCheatsheet({
  category,
  sport: sportOverride,
  limit = DEFAULT_LIMIT,
  minValueScore = 60,
  minConfidence = 60,
}: UseCheatsheetOptions) {
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;
  const requestedDate = getTodayEtDate();

  return useQuery({
    queryKey: ["cheatsheet", category, sport, limit, minValueScore, minConfidence, requestedDate],
    queryFn: async (): Promise<CheatsheetResult> => {
      let effectiveDate = requestedDate;

      const { count: requestedCount, error: requestedCountError } = await supabase
        .from("player_prop_scores")
        .select("id", { count: "exact", head: true })
        .eq("sport", sport)
        .eq("game_date", requestedDate);

      if (requestedCountError) throw requestedCountError;

      if (!requestedCount || requestedCount === 0) {
        const { data: latestRow, error: latestDateError } = await supabase
          .from("player_prop_scores")
          .select("game_date")
          .eq("sport", sport)
          .order("game_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestDateError) throw latestDateError;
        effectiveDate = latestRow?.game_date ?? requestedDate;
      }

      const usingLatestFallback = effectiveDate !== requestedDate;

      const { data: activeGames, error: activeGamesError } = await supabase
        .from("games_today")
        .select("home_team_abbr, away_team_abbr")
        .eq("sport", sport)
        .eq("game_date", effectiveDate)
        .eq("is_active", true);

      if (activeGamesError) throw activeGamesError;

      const activeTeams = [...new Set(
        (activeGames ?? [])
          .flatMap((game) => [game.home_team_abbr, game.away_team_abbr])
          .filter((team): team is string => Boolean(team)),
      )];

      let query = supabase
        .from("player_prop_scores")
        .select(SELECT_COLUMNS)
        .eq("sport", sport)
        .eq("game_date", effectiveDate)
        .not("confidence_score", "is", null);

      if (sport === "MLB") {
        query = query.in("stat_type", MLB_ANCHOR_STATS as unknown as string[]);
      }

      const { data, error } = await query.limit(Math.max(limit * 4, 200));
      if (error) throw error;

      const rows = ((data ?? []) as unknown as CheatsheetRow[])
        .filter((row) => passesScope(sport, row.team_abbr ?? null))
        .filter((row) => activeTeams.length === 0 || !row.team_abbr || activeTeams.includes(row.team_abbr));

      const filteredRows = filterRowsForCategory(rows, category, sport, minValueScore, minConfidence).slice(0, limit);

      let emptyReason: string | null = null;
      if (rows.length === 0) {
        emptyReason = "No scored props found for the selected slate.";
      } else if (filteredRows.length === 0) {
        emptyReason = "No verified plays found for this category yet.";
      }

      return {
        rows: filteredRows,
        requestedDate,
        effectiveDate,
        usingLatestFallback,
        activeTeams,
        emptyReason,
      };
    },
    staleTime: 60_000,
  });
}
