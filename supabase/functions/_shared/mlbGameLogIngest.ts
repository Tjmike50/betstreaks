// ============================================================
// BetStreaks — MLB game-log ingestion (hitter + pitcher)
//
// Pulls official completed SportsDataIO box scores and upserts into:
//   • mlb_hitter_game_logs
//   • mlb_pitcher_game_logs
//
// Used by `refresh-mlb-data`. Idempotent — every row upserts on
// (game_id, player_id) via the v1 schema's natural key.
//
// Important: this path is grading-safe. It only writes player logs for
// games confirmed final, and it skips rows whose outcome stats are
// fractional so projected/live values never enter the grading tables.
// ============================================================

const SPORTSDATA_SCORES_BASE = "https://api.sportsdata.io/v3/mlb/scores/json";
const SPORTSDATA_STATS_BASE = "https://api.sportsdata.io/v3/mlb/stats/json";
const BOX_SCORE_ENDPOINT = "BoxScores";

type Supa = {
  from: (table: string) => any;
};

export interface IngestLogResult {
  step: string;
  rows: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestGameLogOptions {
  debugRaw?: boolean;
}

interface IntStatResult {
  value: number | null;
  fractional: boolean;
  keyFound: boolean;
}

const HITTER_HITS_KEYS = ["Hits", "hits", "BattingHits", "battingHits", "batting_hits"];
const HITTER_TOTAL_BASES_KEYS = [
  "TotalBases",
  "totalBases",
  "total_bases",
  "BattingTotalBases",
  "battingTotalBases",
  "batting_total_bases",
];
const HITTER_SINGLES_KEYS = ["Singles", "singles", "BattingSingles", "battingSingles", "batting_singles"];
const HITTER_DOUBLES_KEYS = ["Doubles", "doubles", "BattingDoubles", "battingDoubles", "batting_doubles"];
const HITTER_TRIPLES_KEYS = ["Triples", "triples", "BattingTriples", "battingTriples", "batting_triples"];
const HITTER_HOME_RUNS_KEYS = ["HomeRuns", "homeRuns", "home_runs", "BattingHomeRuns", "battingHomeRuns", "batting_home_runs"];
const HITTER_RUNS_KEYS = ["Runs", "runs", "BattingRuns", "battingRuns", "batting_runs"];
const HITTER_RBI_KEYS = ["RunsBattedIn", "runsBattedIn", "runs_batted_in", "RBI", "rbi"];
const HITTER_WALKS_KEYS = ["Walks", "walks", "BattingWalks", "battingWalks", "batting_walks"];
const HITTER_STRIKEOUTS_KEYS = ["Strikeouts", "strikeouts", "BattingStrikeouts", "battingStrikeouts", "batting_strikeouts"];
const HITTER_STOLEN_BASES_KEYS = ["StolenBases", "stolenBases", "stolen_bases"];
const HITTER_AT_BATS_KEYS = ["AtBats", "atBats", "at_bats"];
const HITTER_PLATE_APPEARANCES_KEYS = ["PlateAppearances", "plateAppearances", "plate_appearances"];
const HITTER_BATTING_ORDER_KEYS = ["BattingOrder", "battingOrder", "batting_order"];

const PITCHER_STRIKEOUTS_KEYS = ["PitchingStrikeouts", "pitchingStrikeouts", "pitching_strikeouts", "Strikeouts", "strikeouts"];
const PITCHER_EARNED_RUNS_KEYS = ["PitchingEarnedRuns", "pitchingEarnedRuns", "pitching_earned_runs", "EarnedRuns", "earnedRuns", "earned_runs"];
const PITCHER_WALKS_KEYS = ["PitchingWalks", "pitchingWalks", "pitching_walks", "Walks", "walks"];
const PITCHER_HITS_ALLOWED_KEYS = ["PitchingHits", "pitchingHits", "pitching_hits", "HitsAllowed", "hitsAllowed", "hits_allowed"];
const PITCHER_HOME_RUNS_ALLOWED_KEYS = ["PitchingHomeRuns", "pitchingHomeRuns", "pitching_home_runs", "HomeRunsAllowed", "homeRunsAllowed", "home_runs_allowed"];
const PITCHER_BATTERS_FACED_KEYS = [
  "PitchingPlateAppearances",
  "pitchingPlateAppearances",
  "pitching_plate_appearances",
  "BattersFaced",
  "battersFaced",
  "batters_faced",
  "PitchingBattersFaced",
  "pitchingBattersFaced",
  "pitching_batters_faced",
];
const PITCHER_INNINGS_PITCHED_KEYS = ["InningsPitchedDecimal", "inningsPitchedDecimal", "innings_pitched_decimal", "InningsPitchedFull", "inningsPitchedFull", "innings_pitched_full"];
const PITCHER_PITCH_COUNT_KEYS = ["PitchesThrown", "pitchesThrown", "pitches_thrown", "PitchCount", "pitchCount", "pitch_count"];

const DEBUG_HITTER_VALUE_KEYS = [
  "PlayerID",
  "Name",
  "Team",
  "Position",
  "PositionCategory",
  "Hits",
  "hits",
  "BattingHits",
  "TotalBases",
  "totalBases",
  "BattingTotalBases",
  "Singles",
  "Doubles",
  "Triples",
  "HomeRuns",
  "AtBats",
  "PlateAppearances",
  "BattingOrder",
];

const DEBUG_PITCHER_VALUE_KEYS = [
  "PlayerID",
  "Name",
  "Team",
  "Position",
  "PositionCategory",
  "PitchingStrikeouts",
  "pitchingStrikeouts",
  "PitchingEarnedRuns",
  "PitchingWalks",
  "PitchingHits",
  "PitchingPlateAppearances",
  "BattersFaced",
  "InningsPitchedDecimal",
  "PitchesThrown",
];

async function fetchSportsData(path: string): Promise<any> {
  const apiKey = Deno.env.get("SPORTSDATAIO_API_KEY");
  if (!apiKey) throw new Error("SPORTSDATAIO_API_KEY not configured");
  const url = `${path}?key=${apiKey}`;
  console.log(`[mlb-gamelogs] GET ${path}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SportsDataIO ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function firstDefinedValue(row: any, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row ?? {}, key) && row?.[key] != null) {
      return row[key];
    }
  }
  return undefined;
}

function hasAnyKey(row: any, keys: string[]): boolean {
  return keys.some((key) =>
    Object.prototype.hasOwnProperty.call(row ?? {}, key) && row?.[key] != null
  );
}

function readIntegerStat(row: any, keys: string[]): IntStatResult {
  const value = firstDefinedValue(row, keys);
  if (value == null) return { value: null, fractional: false, keyFound: false };
  const numeric = num(value);
  if (numeric == null) return { value: null, fractional: false, keyFound: true };
  if (!Number.isInteger(numeric)) return { value: null, fractional: true, keyFound: true };
  return { value: intOrNull(numeric), fractional: false, keyFound: true };
}

function readNumericStat(row: any, keys: string[]): number | null {
  const value = firstDefinedValue(row, keys);
  return num(value);
}

function pickDebugValues(row: any, keys: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row ?? {}, key) && row?.[key] != null) {
      values[key] = row[key];
    }
  }
  return values;
}

function formatSportsDataDate(dateStr: string): string {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const d = new Date(`${dateStr}T12:00:00Z`);
  return `${d.getUTCFullYear()}-${months[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function isFinalStatus(statusRaw: unknown): boolean {
  const status = String(statusRaw ?? "").trim().toLowerCase();
  return status.includes("final") || status === "f" || status === "f/ot" || status === "closed" || status === "complete";
}

function isPitcherRow(row: any): boolean {
  const pc = String(row?.PositionCategory ?? "").toUpperCase();
  const position = String(row?.Position ?? "").toUpperCase();
  if (pc === "P" || pc === "PITCHER" || position === "P" || position === "SP" || position === "RP") return true;
  const ip = readNumericStat(row, PITCHER_INNINGS_PITCHED_KEYS);
  return ip != null && ip > 0;
}

function extractPlayerRows(box: any): any[] {
  const playerGames = Array.isArray(box?.PlayerGames) ? box.PlayerGames : [];
  if (playerGames.length > 0) return playerGames;
  return [
    ...(Array.isArray(box?.HomeTeamPlayerStats) ? box.HomeTeamPlayerStats : []),
    ...(Array.isArray(box?.AwayTeamPlayerStats) ? box.AwayTeamPlayerStats : []),
  ];
}

function numericMetadataValue(metadata: Record<string, unknown> | undefined, key: string): number {
  const value = metadata?.[key];
  return typeof value === "number" ? value : 0;
}

/**
 * Ingest hitter + pitcher game logs for the given ISO date (YYYY-MM-DD).
 * Returns one StepResult per table.
 */
export async function ingestGameLogsForDate(
  supabase: Supa,
  dateStr: string,
  options: IngestGameLogOptions = {},
): Promise<{ hitter: IngestLogResult; pitcher: IngestLogResult }> {
  const result = {
    hitter: { step: "mlb_hitter_game_logs", rows: 0 } as IngestLogResult,
    pitcher: { step: "mlb_pitcher_game_logs", rows: 0 } as IngestLogResult,
  };

  let games: any[] = [];
  try {
    games = (await fetchSportsData(`${SPORTSDATA_SCORES_BASE}/GamesByDate/${dateStr}`)) as any[];
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    result.hitter.error = msg;
    result.pitcher.error = msg;
    return result;
  }

  if (!Array.isArray(games) || games.length === 0) {
    const metadata = {
      source_endpoint: `${SPORTSDATA_SCORES_BASE}/GamesByDate/${dateStr}`,
      official_boxscore_mode: true,
      games_checked: 0,
      games_final: 0,
      games_skipped_not_final: 0,
      hitter_rows: 0,
      pitcher_rows: 0,
      fractional_stat_rows: 0,
      skipped_fractional_rows: 0,
    };
    result.hitter.skipped = true;
    result.hitter.reason = "no games found for date";
    result.hitter.metadata = metadata;
    result.pitcher.skipped = true;
    result.pitcher.reason = "no games found for date";
    result.pitcher.metadata = metadata;
    return result;
  }

  const finalGameIds = new Set<number>();
  let gamesFinal = 0;
  for (const game of games) {
    const gameId = intOrNull(game?.GameID);
    if (gameId == null) continue;
    if (isFinalStatus(game?.Status)) {
      finalGameIds.add(gameId);
      gamesFinal++;
    }
  }

  const baseMetadata = {
    source_endpoint: `${SPORTSDATA_STATS_BASE}/${BOX_SCORE_ENDPOINT}/${formatSportsDataDate(dateStr)}`,
    official_boxscore_mode: true,
    games_checked: games.length,
    games_final: gamesFinal,
    games_skipped_not_final: Math.max(0, games.length - gamesFinal),
  };

  if (finalGameIds.size === 0) {
    result.hitter.skipped = true;
    result.hitter.reason = "no final games available";
    result.hitter.metadata = {
      ...baseMetadata,
      hitter_rows: 0,
      pitcher_rows: 0,
      fractional_stat_rows: 0,
      skipped_fractional_rows: 0,
    };
    result.pitcher.skipped = true;
    result.pitcher.reason = "no final games available";
    result.pitcher.metadata = {
      ...baseMetadata,
      hitter_rows: 0,
      pitcher_rows: 0,
      fractional_stat_rows: 0,
      skipped_fractional_rows: 0,
    };
    return result;
  }

  let boxes: any[] = [];
  try {
    boxes = (await fetchSportsData(
      `${SPORTSDATA_STATS_BASE}/${BOX_SCORE_ENDPOINT}/${formatSportsDataDate(dateStr)}`,
    )) as any[];
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    result.hitter.error = msg;
    result.hitter.metadata = baseMetadata;
    result.pitcher.error = msg;
    result.pitcher.metadata = baseMetadata;
    return result;
  }

  if (!Array.isArray(boxes) || boxes.length === 0) {
    result.hitter.skipped = true;
    result.hitter.reason = "no official box scores returned";
    result.hitter.metadata = {
      ...baseMetadata,
      hitter_rows: 0,
      pitcher_rows: 0,
      fractional_stat_rows: 0,
      skipped_fractional_rows: 0,
    };
    result.pitcher.skipped = true;
    result.pitcher.reason = "no official box scores returned";
    result.pitcher.metadata = {
      ...baseMetadata,
      hitter_rows: 0,
      pitcher_rows: 0,
      fractional_stat_rows: 0,
      skipped_fractional_rows: 0,
    };
    return result;
  }

  const hitterRows: any[] = [];
  const pitcherRows: any[] = [];
  const sampleHitterRawRows: any[] = [];
  const samplePitcherRawRows: any[] = [];

  let fractionalStatRows = 0;
  let skippedFractionalRows = 0;
  let suspiciousHitterRows = 0;
  let hitterRowsWithHeadlineHitsKeyFound = 0;
  let hitterRowsWithHeadlineTotalBasesKeyFound = 0;
  let hitterRowsWithBreakdownAvailable = 0;
  let hitterRowsWithHits = 0;
  let hitterRowsWithTotalBases = 0;
  let hitterTotalHits = 0;
  let hitterTotalTotalBases = 0;

  for (const box of boxes) {
    const game = box?.Game ?? {};
    const gameIdRaw = intOrNull(game?.GameID);
    if (gameIdRaw == null || !finalGameIds.has(gameIdRaw)) continue;

    const gameId = `mlb_${gameIdRaw}`;
    const homeTeamId = intOrNull(game?.HomeTeamID);
    const awayTeamId = intOrNull(game?.AwayTeamID);
    const playerRows = extractPlayerRows(box);

    for (const row of playerRows) {
      const playerId = intOrNull(row?.PlayerID);
      if (playerId == null) continue;

      const teamId = intOrNull(row?.TeamID);
      const isHome = row?.HomeOrAway != null
        ? String(row.HomeOrAway).toUpperCase() === "HOME"
        : (teamId != null && homeTeamId != null ? teamId === homeTeamId : null);
      const opponentTeamId =
        teamId != null && homeTeamId != null && awayTeamId != null
          ? (teamId === homeTeamId ? awayTeamId : homeTeamId)
          : null;

      if (isPitcherRow(row)) {
        if (options.debugRaw && samplePitcherRawRows.length < 3) samplePitcherRawRows.push(row);

        const strikeouts = readIntegerStat(row, PITCHER_STRIKEOUTS_KEYS);
        const earnedRuns = readIntegerStat(row, PITCHER_EARNED_RUNS_KEYS);
        const walksAllowed = readIntegerStat(row, PITCHER_WALKS_KEYS);
        const hitsAllowed = readIntegerStat(row, PITCHER_HITS_ALLOWED_KEYS);
        const homeRunsAllowed = readIntegerStat(row, PITCHER_HOME_RUNS_ALLOWED_KEYS);
        const battersFaced = readIntegerStat(row, PITCHER_BATTERS_FACED_KEYS);

        const fractional =
          strikeouts.fractional ||
          earnedRuns.fractional ||
          walksAllowed.fractional ||
          hitsAllowed.fractional ||
          homeRunsAllowed.fractional ||
          battersFaced.fractional;

        if (fractional) {
          fractionalStatRows++;
          skippedFractionalRows++;
          continue;
        }

        pitcherRows.push({
          player_id: playerId,
          game_id: gameId,
          game_date: dateStr,
          team_id: teamId,
          opponent_team_id: opponentTeamId,
          is_home: isHome,
          innings_pitched: readNumericStat(row, PITCHER_INNINGS_PITCHED_KEYS),
          pitch_count: intOrNull(firstDefinedValue(row, PITCHER_PITCH_COUNT_KEYS)),
          strikeouts: strikeouts.value,
          earned_runs_allowed: earnedRuns.value,
          walks_allowed: walksAllowed.value,
          hits_allowed: hitsAllowed.value,
          home_runs_allowed: homeRunsAllowed.value,
          batters_faced: battersFaced.value,
        });
      } else {
        if (options.debugRaw && sampleHitterRawRows.length < 3) sampleHitterRawRows.push(row);

        const hits = readIntegerStat(row, HITTER_HITS_KEYS);
        const singles = readIntegerStat(row, HITTER_SINGLES_KEYS);
        const doubles = readIntegerStat(row, HITTER_DOUBLES_KEYS);
        const triples = readIntegerStat(row, HITTER_TRIPLES_KEYS);
        const homeRuns = readIntegerStat(row, HITTER_HOME_RUNS_KEYS);
        const totalBases = readIntegerStat(row, HITTER_TOTAL_BASES_KEYS);

        const fractional =
          hits.fractional ||
          singles.fractional ||
          doubles.fractional ||
          triples.fractional ||
          homeRuns.fractional ||
          totalBases.fractional;

        if (fractional) {
          fractionalStatRows++;
          skippedFractionalRows++;
          continue;
        }

        const breakdownAvailable =
          singles.keyFound || doubles.keyFound || triples.keyFound || homeRuns.keyFound;
        const resolvedHits = hits.value ??
          (breakdownAvailable
            ? (singles.value ?? 0) + (doubles.value ?? 0) + (triples.value ?? 0) + (homeRuns.value ?? 0)
            : null);
        const resolvedTotalBases = totalBases.value ??
          (breakdownAvailable
            ? (singles.value ?? 0) + 2 * (doubles.value ?? 0) + 3 * (triples.value ?? 0) + 4 * (homeRuns.value ?? 0)
            : null);

        if (hits.keyFound) hitterRowsWithHeadlineHitsKeyFound++;
        if (totalBases.keyFound) hitterRowsWithHeadlineTotalBasesKeyFound++;
        if (breakdownAvailable) hitterRowsWithBreakdownAvailable++;
        if ((resolvedHits ?? 0) > 0) hitterRowsWithHits++;
        if ((resolvedTotalBases ?? 0) > 0) hitterRowsWithTotalBases++;
        if ((resolvedTotalBases ?? 0) > 0 && (resolvedHits ?? 0) === 0) suspiciousHitterRows++;
        hitterTotalHits += resolvedHits ?? 0;
        hitterTotalTotalBases += resolvedTotalBases ?? 0;

        hitterRows.push({
          player_id: playerId,
          game_id: gameId,
          game_date: dateStr,
          team_id: teamId,
          opponent_team_id: opponentTeamId,
          opposing_pitcher_id: intOrNull(row?.OpposingPitcherID),
          is_home: isHome,
          batting_order: intOrNull(firstDefinedValue(row, HITTER_BATTING_ORDER_KEYS)),
          plate_appearances: intOrNull(firstDefinedValue(row, HITTER_PLATE_APPEARANCES_KEYS)),
          at_bats: intOrNull(firstDefinedValue(row, HITTER_AT_BATS_KEYS)),
          hits: resolvedHits,
          singles: singles.value,
          doubles: doubles.value,
          triples: triples.value,
          home_runs: homeRuns.value,
          total_bases: resolvedTotalBases,
          runs: intOrNull(firstDefinedValue(row, HITTER_RUNS_KEYS)),
          rbi: intOrNull(firstDefinedValue(row, HITTER_RBI_KEYS)),
          walks: intOrNull(firstDefinedValue(row, HITTER_WALKS_KEYS)),
          strikeouts: intOrNull(firstDefinedValue(row, HITTER_STRIKEOUTS_KEYS)),
          stolen_bases: intOrNull(firstDefinedValue(row, HITTER_STOLEN_BASES_KEYS)),
        });
      }
    }
  }

  const metadata = {
    ...baseMetadata,
    ok_for_grading: fractionalStatRows === 0,
    reason: fractionalStatRows > 0 ? "source returned fractional/non-official stats" : null,
    hitter_rows: hitterRows.length,
    pitcher_rows: pitcherRows.length,
    fractional_stat_rows: fractionalStatRows,
    skipped_fractional_rows: skippedFractionalRows,
    rows_written: 0,
    hitter_total_hits: hitterTotalHits,
    hitter_total_total_bases: hitterTotalTotalBases,
    hitter_rows_with_hits: hitterRowsWithHits,
    hitter_rows_with_total_bases: hitterRowsWithTotalBases,
    hitter_rows_with_headline_hits_key_found: hitterRowsWithHeadlineHitsKeyFound,
    hitter_rows_with_headline_total_bases_key_found: hitterRowsWithHeadlineTotalBasesKeyFound,
    hitter_rows_with_breakdown_available: hitterRowsWithBreakdownAvailable,
    suspicious_hitter_rows: suspiciousHitterRows,
    recommendation: "Use a verified final boxscore endpoint/source before grading.",
  };

  if (options.debugRaw) {
    result.hitter.metadata = {
      ...metadata,
      sample_hitter_raw_keys: sampleHitterRawRows.map((row) => Object.keys(row).sort()),
      sample_hitter_raw_values: sampleHitterRawRows.map((row) => pickDebugValues(row, DEBUG_HITTER_VALUE_KEYS)),
    };
    result.pitcher.metadata = {
      ...metadata,
      sample_pitcher_raw_keys: samplePitcherRawRows.map((row) => Object.keys(row).sort()),
      sample_pitcher_raw_values: samplePitcherRawRows.map((row) => pickDebugValues(row, DEBUG_PITCHER_VALUE_KEYS)),
    };
  } else {
    result.hitter.metadata = metadata;
    result.pitcher.metadata = metadata;
  }

  if (fractionalStatRows > 0) {
    result.hitter.skipped = true;
    result.hitter.reason = "source returned fractional/non-official stats";
    result.pitcher.skipped = true;
    result.pitcher.reason = "source returned fractional/non-official stats";
  } else if (hitterRows.length > 0) {
    try {
      const CHUNK = 400;
      for (let i = 0; i < hitterRows.length; i += CHUNK) {
        const slice = hitterRows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("mlb_hitter_game_logs")
          .upsert(slice, { onConflict: "game_id,player_id" });
        if (error) throw error;
      }
      result.hitter.rows = hitterRows.length;
      if (result.hitter.metadata) result.hitter.metadata.rows_written = hitterRows.length + pitcherRows.length;
      if (result.pitcher.metadata) result.pitcher.metadata.rows_written = hitterRows.length + pitcherRows.length;
    } catch (e: any) {
      result.hitter.error = String(e?.message ?? e);
    }
  } else {
    result.hitter.skipped = true;
    result.hitter.reason = "no official hitter rows to upsert";
  }

  if (fractionalStatRows > 0) {
    // no-op: protected above; do not write any rows for this date
  } else if (pitcherRows.length > 0) {
    try {
      const CHUNK = 400;
      for (let i = 0; i < pitcherRows.length; i += CHUNK) {
        const slice = pitcherRows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("mlb_pitcher_game_logs")
          .upsert(slice, { onConflict: "game_id,player_id" });
        if (error) throw error;
      }
      result.pitcher.rows = pitcherRows.length;
    } catch (e: any) {
      result.pitcher.error = String(e?.message ?? e);
    }
  } else {
    result.pitcher.skipped = true;
    result.pitcher.reason = "no official pitcher rows to upsert";
  }

  console.log(
    `[mlb-gamelogs] date=${dateStr} source=${BOX_SCORE_ENDPOINT} games_checked=${games.length} games_final=${gamesFinal} hitter=${hitterRows.length} pitcher=${pitcherRows.length} fractional_stat_rows=${fractionalStatRows} skipped_fractional_rows=${skippedFractionalRows} ok_for_grading=${fractionalStatRows === 0}`,
  );

  return result;
}

/**
 * Ingest a sliding window of N most-recent dates ending on `endDateStr` (ET).
 * Used to backfill rolling windows in one refresh pass.
 */
export async function ingestGameLogsWindow(
  supabase: Supa,
  endDateStr: string,
  daysBack: number,
  options: IngestGameLogOptions = {},
): Promise<{ hitter: IngestLogResult; pitcher: IngestLogResult; dates: string[] }> {
  const dates: string[] = [];
  const end = new Date(`${endDateStr}T12:00:00Z`);
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const agg = {
    hitter: { step: "mlb_hitter_game_logs", rows: 0, metadata: {} } as IngestLogResult,
    pitcher: { step: "mlb_pitcher_game_logs", rows: 0, metadata: {} } as IngestLogResult,
    dates,
  };
  const errors: string[] = [];

  for (const d of dates) {
    const r = await ingestGameLogsForDate(supabase, d, options);
    agg.hitter.rows += r.hitter.rows;
    agg.pitcher.rows += r.pitcher.rows;

    const hitterMetadata = r.hitter.metadata ?? {};
    const pitcherMetadata = r.pitcher.metadata ?? {};
    const sourceEndpoint = hitterMetadata.source_endpoint ?? pitcherMetadata.source_endpoint;

    agg.hitter.metadata = {
      ...(agg.hitter.metadata ?? {}),
      source_endpoint: sourceEndpoint,
      official_boxscore_mode: true,
      ok_for_grading:
        Boolean(agg.hitter.metadata?.ok_for_grading ?? true) && Boolean(hitterMetadata.ok_for_grading ?? true),
      reason: hitterMetadata.reason ?? agg.hitter.metadata?.reason,
      games_checked: numericMetadataValue(agg.hitter.metadata, "games_checked") + numericMetadataValue(hitterMetadata, "games_checked"),
      games_final: numericMetadataValue(agg.hitter.metadata, "games_final") + numericMetadataValue(hitterMetadata, "games_final"),
      games_skipped_not_final:
        numericMetadataValue(agg.hitter.metadata, "games_skipped_not_final") +
        numericMetadataValue(hitterMetadata, "games_skipped_not_final"),
      hitter_rows: numericMetadataValue(agg.hitter.metadata, "hitter_rows") + numericMetadataValue(hitterMetadata, "hitter_rows"),
      pitcher_rows: numericMetadataValue(agg.hitter.metadata, "pitcher_rows") + numericMetadataValue(hitterMetadata, "pitcher_rows"),
      fractional_stat_rows:
        numericMetadataValue(agg.hitter.metadata, "fractional_stat_rows") +
        numericMetadataValue(hitterMetadata, "fractional_stat_rows"),
      skipped_fractional_rows:
        numericMetadataValue(agg.hitter.metadata, "skipped_fractional_rows") +
        numericMetadataValue(hitterMetadata, "skipped_fractional_rows"),
      rows_written:
        numericMetadataValue(agg.hitter.metadata, "rows_written") +
        numericMetadataValue(hitterMetadata, "rows_written"),
      hitter_total_hits:
        numericMetadataValue(agg.hitter.metadata, "hitter_total_hits") +
        numericMetadataValue(hitterMetadata, "hitter_total_hits"),
      hitter_total_total_bases:
        numericMetadataValue(agg.hitter.metadata, "hitter_total_total_bases") +
        numericMetadataValue(hitterMetadata, "hitter_total_total_bases"),
      hitter_rows_with_hits:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_with_hits") +
        numericMetadataValue(hitterMetadata, "hitter_rows_with_hits"),
      hitter_rows_with_total_bases:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_with_total_bases") +
        numericMetadataValue(hitterMetadata, "hitter_rows_with_total_bases"),
      hitter_rows_with_headline_hits_key_found:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_with_headline_hits_key_found") +
        numericMetadataValue(hitterMetadata, "hitter_rows_with_headline_hits_key_found"),
      hitter_rows_with_headline_total_bases_key_found:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_with_headline_total_bases_key_found") +
        numericMetadataValue(hitterMetadata, "hitter_rows_with_headline_total_bases_key_found"),
      hitter_rows_with_breakdown_available:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_with_breakdown_available") +
        numericMetadataValue(hitterMetadata, "hitter_rows_with_breakdown_available"),
      suspicious_hitter_rows:
        numericMetadataValue(agg.hitter.metadata, "suspicious_hitter_rows") +
        numericMetadataValue(hitterMetadata, "suspicious_hitter_rows"),
      recommendation:
        (hitterMetadata.recommendation as string | undefined) ??
        (agg.hitter.metadata?.recommendation as string | undefined) ??
        "Use a verified final boxscore endpoint/source before grading.",
    };

    agg.pitcher.metadata = {
      ...(agg.pitcher.metadata ?? {}),
      source_endpoint: sourceEndpoint,
      official_boxscore_mode: true,
      ok_for_grading:
        Boolean(agg.pitcher.metadata?.ok_for_grading ?? true) && Boolean(pitcherMetadata.ok_for_grading ?? true),
      reason: pitcherMetadata.reason ?? agg.pitcher.metadata?.reason,
      games_checked: numericMetadataValue(agg.pitcher.metadata, "games_checked") + numericMetadataValue(pitcherMetadata, "games_checked"),
      games_final: numericMetadataValue(agg.pitcher.metadata, "games_final") + numericMetadataValue(pitcherMetadata, "games_final"),
      games_skipped_not_final:
        numericMetadataValue(agg.pitcher.metadata, "games_skipped_not_final") +
        numericMetadataValue(pitcherMetadata, "games_skipped_not_final"),
      hitter_rows: numericMetadataValue(agg.pitcher.metadata, "hitter_rows") + numericMetadataValue(pitcherMetadata, "hitter_rows"),
      pitcher_rows: numericMetadataValue(agg.pitcher.metadata, "pitcher_rows") + numericMetadataValue(pitcherMetadata, "pitcher_rows"),
      fractional_stat_rows:
        numericMetadataValue(agg.pitcher.metadata, "fractional_stat_rows") +
        numericMetadataValue(pitcherMetadata, "fractional_stat_rows"),
      skipped_fractional_rows:
        numericMetadataValue(agg.pitcher.metadata, "skipped_fractional_rows") +
        numericMetadataValue(pitcherMetadata, "skipped_fractional_rows"),
      rows_written:
        numericMetadataValue(agg.pitcher.metadata, "rows_written") +
        numericMetadataValue(pitcherMetadata, "rows_written"),
      recommendation:
        (pitcherMetadata.recommendation as string | undefined) ??
        (agg.pitcher.metadata?.recommendation as string | undefined) ??
        "Use a verified final boxscore endpoint/source before grading.",
    };

    if (options.debugRaw) {
      if (!(agg.hitter.metadata?.sample_hitter_raw_keys) && hitterMetadata.sample_hitter_raw_keys) {
        agg.hitter.metadata.sample_hitter_raw_keys = hitterMetadata.sample_hitter_raw_keys;
        agg.hitter.metadata.sample_hitter_raw_values = hitterMetadata.sample_hitter_raw_values;
      }
      if (!(agg.pitcher.metadata?.sample_pitcher_raw_keys) && pitcherMetadata.sample_pitcher_raw_keys) {
        agg.pitcher.metadata.sample_pitcher_raw_keys = pitcherMetadata.sample_pitcher_raw_keys;
        agg.pitcher.metadata.sample_pitcher_raw_values = pitcherMetadata.sample_pitcher_raw_values;
      }
    }

    if (r.hitter.error) errors.push(`hitter ${d}: ${r.hitter.error}`);
    if (r.pitcher.error) errors.push(`pitcher ${d}: ${r.pitcher.error}`);
  }

  if (errors.length > 0) {
    const msg = errors.slice(0, 3).join(" | ");
    if (agg.hitter.rows === 0) agg.hitter.error = msg;
    if (agg.pitcher.rows === 0) agg.pitcher.error = msg;
  }

  return agg;
}
