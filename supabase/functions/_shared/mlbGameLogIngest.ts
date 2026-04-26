// ============================================================
// BetStreaks — MLB game-log ingestion (hitter + pitcher)
//
// Supports two source modes:
//   • mlb_stats_api  -> official MLB Stats API schedule + boxscore path
//   • sportsdataio   -> guarded/blocked for grading safety
//
// The official MLB Stats API path only writes logs for final games and only
// writes integer outcome stats. Fractional rows are rejected so projected or
// non-official stats never contaminate mlb_hitter_game_logs /
// mlb_pitcher_game_logs.
// ============================================================

const MLB_STATS_API_SCHEDULE_ENDPOINT = "https://statsapi.mlb.com/api/v1/schedule";
const MLB_STATS_API_GAME_ENDPOINT = "https://statsapi.mlb.com/api/v1/game";
const SPORTSDATA_BLOCKED_ENDPOINT = "https://api.sportsdata.io/v3/mlb/stats/json/BoxScores";

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
  source?: "mlb_stats_api" | "sportsdataio";
}

interface IntStatResult {
  value: number | null;
  fractional: boolean;
  keyFound: boolean;
}

interface ScheduleGame {
  gamePk: number;
  status: unknown;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
}

interface PlayerLookupRow {
  player_id: number;
  player_name: string | null;
  team_abbr: string | null;
  primary_role: string | null;
}

const MLB_TEAM_NAME_TO_ABBR: Record<string, string> = {
  "Arizona Diamondbacks": "ARI",
  "Athletics": "ATH",
  "Atlanta Braves": "ATL",
  "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS",
  "Chicago Cubs": "CHC",
  "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN",
  "Cleveland Guardians": "CLE",
  "Colorado Rockies": "COL",
  "Detroit Tigers": "DET",
  "Houston Astros": "HOU",
  "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA",
  "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL",
  "Minnesota Twins": "MIN",
  "New York Mets": "NYM",
  "New York Yankees": "NYY",
  "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT",
  "San Diego Padres": "SD",
  "San Francisco Giants": "SF",
  "Seattle Mariners": "SEA",
  "St. Louis Cardinals": "STL",
  "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX",
  "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH",
};

const SAMPLE_LIMIT = 3;
const UNRESOLVED_SAMPLE_LIMIT = 10;

const DEBUG_HITTER_VALUE_KEYS = [
  "fullName",
  "battingOrder",
  "atBats",
  "hits",
  "doubles",
  "triples",
  "homeRuns",
  "runs",
  "rbi",
  "baseOnBalls",
  "strikeOuts",
  "stolenBases",
  "plateAppearances",
  "totalBases",
];

const DEBUG_PITCHER_VALUE_KEYS = [
  "fullName",
  "inningsPitched",
  "strikeOuts",
  "earnedRuns",
  "baseOnBalls",
  "hits",
  "battersFaced",
  "pitchesThrown",
];

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${url}: ${body.slice(0, 300)}`);
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

function readIntegerStat(row: any, keys: string[]): IntStatResult {
  const value = firstDefinedValue(row, keys);
  if (value == null) return { value: null, fractional: false, keyFound: false };
  const numeric = num(value);
  if (numeric == null) return { value: null, fractional: false, keyFound: true };
  if (!Number.isInteger(numeric)) return { value: null, fractional: true, keyFound: true };
  return { value: intOrNull(numeric), fractional: false, keyFound: true };
}

function readNumericStat(row: any, keys: string[]): number | null {
  return num(firstDefinedValue(row, keys));
}

function pickDebugValues(row: any, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row ?? {}, key) && row?.[key] != null) {
      out[key] = row[key];
    }
  }
  return out;
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBattingOrder(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 100) return Math.trunc(numeric / 100);
  return Math.trunc(numeric);
}

function hasPitchingParticipation(pitching: any): boolean {
  if (!pitching || typeof pitching !== "object") return false;
  const inningsPitched = readNumericStat(pitching, ["inningsPitched"]);
  const battersFaced = readIntegerStat(pitching, ["battersFaced"]);
  const pitchesThrown = readIntegerStat(pitching, ["numberOfPitches", "pitchesThrown"]);
  const strikeOuts = readIntegerStat(pitching, ["strikeOuts"]);
  const hitsAllowed = readIntegerStat(pitching, ["hits"]);
  const walksAllowed = readIntegerStat(pitching, ["baseOnBalls"]);
  return (inningsPitched ?? 0) > 0 ||
    (battersFaced.value ?? 0) > 0 ||
    (pitchesThrown.value ?? 0) > 0 ||
    (strikeOuts.value ?? 0) > 0 ||
    (hitsAllowed.value ?? 0) > 0 ||
    (walksAllowed.value ?? 0) > 0;
}

function hasBattingParticipation(batting: any): boolean {
  if (!batting || typeof batting !== "object") return false;
  const plateAppearances = readIntegerStat(batting, ["plateAppearances"]);
  const atBats = readIntegerStat(batting, ["atBats"]);
  const hits = readIntegerStat(batting, ["hits"]);
  const walks = readIntegerStat(batting, ["baseOnBalls"]);
  const runs = readIntegerStat(batting, ["runs"]);
  const rbi = readIntegerStat(batting, ["rbi"]);
  return (plateAppearances.value ?? 0) > 0 ||
    (atBats.value ?? 0) > 0 ||
    (hits.value ?? 0) > 0 ||
    (walks.value ?? 0) > 0 ||
    (runs.value ?? 0) > 0 ||
    (rbi.value ?? 0) > 0;
}

function isFinalScheduleStatus(status: any): boolean {
  const abstractState = String(status?.abstractGameState ?? "").toLowerCase();
  const abstractCode = String(status?.abstractGameCode ?? "").toUpperCase();
  const detailedState = String(status?.detailedState ?? "").toLowerCase();
  return abstractState === "final" ||
    abstractCode === "F" ||
    detailedState.includes("final") ||
    detailedState.includes("completed") ||
    detailedState.includes("game over");
}

function extractScheduleGames(payload: any): ScheduleGame[] {
  const dates = Array.isArray(payload?.dates) ? payload.dates : [];
  const games: ScheduleGame[] = [];
  for (const dateEntry of dates) {
    for (const game of Array.isArray(dateEntry?.games) ? dateEntry.games : []) {
      const gamePk = intOrNull(game?.gamePk);
      if (gamePk == null) continue;
      games.push({
        gamePk,
        status: game?.status ?? null,
        homeTeamId: intOrNull(game?.teams?.home?.team?.id),
        awayTeamId: intOrNull(game?.teams?.away?.team?.id),
        homeTeamName: String(game?.teams?.home?.team?.name ?? "").trim() || null,
        awayTeamName: String(game?.teams?.away?.team?.name ?? "").trim() || null,
      });
    }
  }
  return games;
}

function extractPlayersMap(boxscore: any, side: "home" | "away"): Array<{ player: any; isHome: boolean; teamName: string | null; teamMlbamId: number | null; opponentMlbamId: number | null }> {
  const team = boxscore?.teams?.[side];
  const opponent = boxscore?.teams?.[side === "home" ? "away" : "home"];
  const players = Object.values(team?.players ?? {}) as any[];
  return players.map((player) => ({
    player,
    isHome: side === "home",
    teamName: String(team?.team?.name ?? "").trim() || null,
    teamMlbamId: intOrNull(team?.team?.id),
    opponentMlbamId: intOrNull(opponent?.team?.id),
  }));
}

async function buildPlayerLookup(supabase: Supa): Promise<{
  exactByNameTeamRole: Map<string, PlayerLookupRow[]>;
  teamAbbrToSportsdataId: Map<string, number>;
}> {
  const { data: teamRows, error: teamErr } = await supabase
    .from("mlb_team_id_map")
    .select("team_id, team_abbr");
  if (teamErr) throw new Error(`Failed to read mlb_team_id_map: ${teamErr.message}`);

  const teamIdToAbbr = new Map<number, string>();
  const teamAbbrToSportsdataId = new Map<string, number>();
  for (const row of teamRows ?? []) {
    const teamId = intOrNull((row as any).team_id);
    const abbr = String((row as any).team_abbr ?? "").toUpperCase();
    if (teamId != null && abbr) {
      teamIdToAbbr.set(teamId, abbr);
      teamAbbrToSportsdataId.set(abbr, teamId);
    }
  }

  const { data: profileRows, error: profileErr } = await supabase
    .from("mlb_player_profiles")
    .select("player_id, player_name, mlb_team_id, primary_role");
  if (profileErr) throw new Error(`Failed to read mlb_player_profiles: ${profileErr.message}`);

  const exactByNameTeamRole = new Map<string, PlayerLookupRow[]>();
  for (const row of profileRows ?? []) {
    const playerId = intOrNull((row as any).player_id);
    const playerName = String((row as any).player_name ?? "").trim() || null;
    const teamId = intOrNull((row as any).mlb_team_id);
    const primaryRole = String((row as any).primary_role ?? "").trim() || null;
    const teamAbbr = teamId != null ? teamIdToAbbr.get(teamId) ?? null : null;
    if (playerId == null || !playerName || !teamAbbr) continue;
    const role = primaryRole === "pitcher" ? "pitcher" : "batter";
    const key = `${normalizeName(playerName)}|${teamAbbr}|${role}`;
    const list = exactByNameTeamRole.get(key) ?? [];
    list.push({
      player_id: playerId,
      player_name: playerName,
      team_abbr: teamAbbr,
      primary_role: role,
    });
    exactByNameTeamRole.set(key, list);
  }

  return { exactByNameTeamRole, teamAbbrToSportsdataId };
}

function buildBlockedSourceResult(dateStr: string, source: string, debugRaw: boolean): { hitter: IngestLogResult; pitcher: IngestLogResult } {
  const metadata: Record<string, unknown> = {
    ok_for_grading: false,
    source_endpoint: source === "sportsdataio" ? SPORTSDATA_BLOCKED_ENDPOINT : source,
    official_boxscore_mode: false,
    reason: "source returned fractional/non-official stats",
    fractional_stat_rows: 0,
    skipped_fractional_rows: 0,
    rows_written: 0,
    recommendation: "Use a verified final boxscore endpoint/source before grading.",
    game_date: dateStr,
  };
  if (debugRaw) {
    metadata.sample_hitter_raw_keys = [];
    metadata.sample_pitcher_raw_keys = [];
    metadata.sample_hitter_raw_values = [];
    metadata.sample_pitcher_raw_values = [];
  }
  return {
    hitter: {
      step: "mlb_hitter_game_logs",
      rows: 0,
      skipped: true,
      reason: "source returned fractional/non-official stats",
      metadata,
    },
    pitcher: {
      step: "mlb_pitcher_game_logs",
      rows: 0,
      skipped: true,
      reason: "source returned fractional/non-official stats",
      metadata,
    },
  };
}

function withDebugSamples(metadata: Record<string, unknown>, hitterSamples: any[], pitcherSamples: any[], unresolvedPlayers: Array<Record<string, unknown>>, debugRaw: boolean) {
  if (!debugRaw) return metadata;
  return {
    ...metadata,
    sample_hitter_rows: hitterSamples,
    sample_pitcher_rows: pitcherSamples,
    sample_unresolved_players: unresolvedPlayers,
  };
}

export async function ingestGameLogsForDate(
  supabase: Supa,
  dateStr: string,
  options: IngestGameLogOptions = {},
): Promise<{ hitter: IngestLogResult; pitcher: IngestLogResult }> {
  const source = options.source ?? "mlb_stats_api";
  if (source !== "mlb_stats_api") {
    return buildBlockedSourceResult(dateStr, source, options.debugRaw === true);
  }

  const scheduleUrl =
    `${MLB_STATS_API_SCHEDULE_ENDPOINT}?sportId=1&date=${dateStr}&hydrate=game(content(summary)),status`;

  const schedulePayload = await fetchJson(scheduleUrl);
  const scheduleGames = extractScheduleGames(schedulePayload);
  const finalGames = scheduleGames.filter((g) => isFinalScheduleStatus(g.status));

  const { exactByNameTeamRole, teamAbbrToSportsdataId } = await buildPlayerLookup(supabase);

  const hitterRows: any[] = [];
  const pitcherRows: any[] = [];
  const sampleHitterRows: any[] = [];
  const samplePitcherRows: any[] = [];
  const unresolvedPlayers: Array<Record<string, unknown>> = [];
  const boxscoreErrorGames: number[] = [];

  let unresolvedPlayerCount = 0;
  let fractionalStatRows = 0;
  let skippedFractionalRows = 0;
  let boxscoreFetchErrors = 0;
  let hitterTotalHits = 0;
  let hitterTotalTotalBases = 0;
  let hitterRowsWithHits = 0;
  let hitterRowsWithTotalBases = 0;
  let hitterRowsWithHeadlineHitsKeyFound = 0;
  let hitterRowsWithHeadlineTotalBasesKeyFound = 0;
  let hitterRowsWithBreakdownAvailable = 0;
  let suspiciousHitterRows = 0;

  for (const game of finalGames) {
    let boxscore: any;
    try {
      boxscore = await fetchJson(`${MLB_STATS_API_GAME_ENDPOINT}/${game.gamePk}/boxscore`);
    } catch (_) {
      boxscoreFetchErrors++;
      if (boxscoreErrorGames.length < UNRESOLVED_SAMPLE_LIMIT) boxscoreErrorGames.push(game.gamePk);
      continue;
    }
    const players = [
      ...extractPlayersMap(boxscore, "home"),
      ...extractPlayersMap(boxscore, "away"),
    ];

    for (const entry of players) {
      const player = entry.player;
      const stats = player?.stats ?? {};
      const batting = stats?.batting ?? null;
      const pitching = stats?.pitching ?? null;
      const battingParticipated = hasBattingParticipation(batting);
      const pitchingParticipated = hasPitchingParticipation(pitching);
      const fullName = String(player?.person?.fullName ?? "").trim() || null;
      const teamAbbr = entry.teamName ? MLB_TEAM_NAME_TO_ABBR[entry.teamName] ?? null : null;
      const teamId = teamAbbr ? teamAbbrToSportsdataId.get(teamAbbr) ?? null : null;
      const opponentName = entry.opponentMlbamId != null
        ? (scheduleGames.find((g) => g.homeTeamId === entry.opponentMlbamId)?.homeTeamName ??
          scheduleGames.find((g) => g.awayTeamId === entry.opponentMlbamId)?.awayTeamName ??
          null)
        : null;
      const opponentAbbr = opponentName ? MLB_TEAM_NAME_TO_ABBR[opponentName] ?? null : null;
      const opponentTeamId = opponentAbbr ? teamAbbrToSportsdataId.get(opponentAbbr) ?? null : null;

      const role = pitchingParticipated ? "pitcher" : battingParticipated ? "hitter" : null;
      if (!role || !fullName || !teamAbbr) continue;

      const lookupRole = role === "hitter" ? "batter" : role;
      const lookupKey = `${normalizeName(fullName)}|${teamAbbr}|${lookupRole}`;
      const matches = exactByNameTeamRole.get(lookupKey) ?? [];
      if (matches.length !== 1) {
        unresolvedPlayerCount++;
        if (unresolvedPlayers.length < UNRESOLVED_SAMPLE_LIMIT) {
          unresolvedPlayers.push({
            player_name: fullName,
            team_abbr: teamAbbr,
            role,
            game_pk: game.gamePk,
            match_count: matches.length,
          });
        }
        continue;
      }
      const resolvedPlayerId = matches[0].player_id;

      if (role === "hitter" && battingParticipated && batting) {
        const hits = readIntegerStat(batting, ["hits"]);
        const doubles = readIntegerStat(batting, ["doubles"]);
        const triples = readIntegerStat(batting, ["triples"]);
        const homeRuns = readIntegerStat(batting, ["homeRuns"]);
        const totalBases = readIntegerStat(batting, ["totalBases"]);
        const atBats = readIntegerStat(batting, ["atBats"]);
        const plateAppearances = readIntegerStat(batting, ["plateAppearances"]);
        const runs = readIntegerStat(batting, ["runs"]);
        const rbi = readIntegerStat(batting, ["rbi"]);
        const walks = readIntegerStat(batting, ["baseOnBalls"]);
        const strikeouts = readIntegerStat(batting, ["strikeOuts"]);
        const stolenBases = readIntegerStat(batting, ["stolenBases"]);

        const fractional = [
          hits, doubles, triples, homeRuns, totalBases,
        ].some((s) => s.fractional);
        if (fractional) {
          fractionalStatRows++;
          skippedFractionalRows++;
          continue;
        }

        const resolvedHits = hits.value;
        const resolvedSingles =
          resolvedHits != null && doubles.value != null && triples.value != null && homeRuns.value != null
            ? resolvedHits - doubles.value - triples.value - homeRuns.value
            : null;
        const resolvedTotalBases =
          totalBases.value != null
            ? totalBases.value
            : resolvedSingles != null && doubles.value != null && triples.value != null && homeRuns.value != null
            ? resolvedSingles + 2 * doubles.value + 3 * triples.value + 4 * homeRuns.value
            : null;

        if ((resolvedTotalBases ?? 0) > 0 && (resolvedHits ?? 0) === 0) suspiciousHitterRows++;
        if ((resolvedHits ?? 0) > 0) hitterRowsWithHits++;
        if ((resolvedTotalBases ?? 0) > 0) hitterRowsWithTotalBases++;
        if (hits.keyFound) hitterRowsWithHeadlineHitsKeyFound++;
        if (totalBases.keyFound) hitterRowsWithHeadlineTotalBasesKeyFound++;
        if (doubles.keyFound || triples.keyFound || homeRuns.keyFound) hitterRowsWithBreakdownAvailable++;
        hitterTotalHits += resolvedHits ?? 0;
        hitterTotalTotalBases += resolvedTotalBases ?? 0;

        const battingParticipationIsZero =
          (plateAppearances.value ?? 0) === 0 &&
          (atBats.value ?? 0) === 0 &&
          (resolvedHits ?? 0) === 0 &&
          (walks.value ?? 0) === 0;
        if (battingParticipationIsZero) continue;

        const row = {
          player_id: resolvedPlayerId,
          game_id: `mlb_statsapi_${game.gamePk}`,
          game_date: dateStr,
          team_id: teamId,
          opponent_team_id: opponentTeamId,
          batting_order: parseBattingOrder(player?.battingOrder),
          plate_appearances:
            plateAppearances.value ??
            ((atBats.value ?? 0) + (walks.value ?? 0)),
          at_bats: atBats.value,
          hits: resolvedHits,
          singles: resolvedSingles,
          doubles: doubles.value,
          triples: triples.value,
          home_runs: homeRuns.value,
          runs: runs.value,
          rbi: rbi.value,
          walks: walks.value,
          strikeouts: strikeouts.value,
          stolen_bases: stolenBases.value,
          total_bases: resolvedTotalBases,
          is_home: entry.isHome,
          opposing_pitcher_id: null,
          updated_at: new Date().toISOString(),
        };
        hitterRows.push(row);
        if (sampleHitterRows.length < SAMPLE_LIMIT) {
          sampleHitterRows.push({
            player_name: fullName,
            team_abbr: teamAbbr,
            hits: row.hits,
            total_bases: row.total_bases,
            home_runs: row.home_runs,
            at_bats: row.at_bats,
          });
        }
      }

      if (role === "pitcher" && pitchingParticipated && pitching) {
        const strikeouts = readIntegerStat(pitching, ["strikeOuts"]);
        const earnedRuns = readIntegerStat(pitching, ["earnedRuns"]);
        const walksAllowed = readIntegerStat(pitching, ["baseOnBalls"]);
        const hitsAllowed = readIntegerStat(pitching, ["hits"]);
        const battersFaced = readIntegerStat(pitching, ["battersFaced"]);

        const fractional = [strikeouts, earnedRuns, walksAllowed, hitsAllowed, battersFaced]
          .some((s) => s.fractional);
        if (fractional) {
          fractionalStatRows++;
          skippedFractionalRows++;
          continue;
        }

        const row = {
          player_id: resolvedPlayerId,
          game_id: `mlb_statsapi_${game.gamePk}`,
          game_date: dateStr,
          team_id: teamId,
          opponent_team_id: opponentTeamId,
          innings_pitched: readNumericStat(pitching, ["inningsPitched"]),
          pitch_count: readIntegerStat(pitching, ["numberOfPitches", "pitchesThrown"]).value,
          strikeouts: strikeouts.value,
          earned_runs_allowed: earnedRuns.value,
          walks_allowed: walksAllowed.value,
          hits_allowed: hitsAllowed.value,
          home_runs_allowed: readIntegerStat(pitching, ["homeRuns"]).value,
          batters_faced: battersFaced.value,
          is_home: entry.isHome,
          updated_at: new Date().toISOString(),
        };
        pitcherRows.push(row);
        if (samplePitcherRows.length < SAMPLE_LIMIT) {
          samplePitcherRows.push({
            player_name: fullName,
            team_abbr: teamAbbr,
            strikeouts: row.strikeouts,
            earned_runs_allowed: row.earned_runs_allowed,
            hits_allowed: row.hits_allowed,
            walks_allowed: row.walks_allowed,
          });
        }
      }
    }
  }

  const okForGrading = fractionalStatRows === 0;
  const baseMetadata: Record<string, unknown> = {
    source_endpoint: "MLB Stats API",
    official_boxscore_mode: true,
    ok_for_grading: okForGrading,
    reason: okForGrading ? null : "source returned fractional/non-official stats",
    games_checked: scheduleGames.length,
    games_final: finalGames.length,
    games_skipped_not_final: Math.max(0, scheduleGames.length - finalGames.length),
    hitter_rows: hitterRows.length,
    pitcher_rows: pitcherRows.length,
    hitter_rows_written: 0,
    pitcher_rows_written: 0,
    unresolved_player_count: unresolvedPlayerCount,
    fractional_stat_rows: fractionalStatRows,
    skipped_fractional_rows: skippedFractionalRows,
    rows_written: 0,
    boxscore_fetch_errors: boxscoreFetchErrors,
    recommendation: "Use a verified final boxscore endpoint/source before grading.",
    hitter_total_hits: hitterTotalHits,
    hitter_total_total_bases: hitterTotalTotalBases,
    hitter_rows_with_hits: hitterRowsWithHits,
    hitter_rows_with_total_bases: hitterRowsWithTotalBases,
    hitter_rows_with_headline_hits_key_found: hitterRowsWithHeadlineHitsKeyFound,
    hitter_rows_with_headline_total_bases_key_found: hitterRowsWithHeadlineTotalBasesKeyFound,
    hitter_rows_with_breakdown_available: hitterRowsWithBreakdownAvailable,
    suspicious_hitter_rows: suspiciousHitterRows,
  };
  const metadata = withDebugSamples(
    baseMetadata,
    sampleHitterRows,
    samplePitcherRows,
    unresolvedPlayers,
    options.debugRaw === true,
  );
  if (boxscoreErrorGames.length > 0) {
    (metadata as Record<string, unknown>).boxscore_error_game_pks = boxscoreErrorGames;
  }

  if (!okForGrading) {
    return {
      hitter: {
        step: "mlb_hitter_game_logs",
        rows: 0,
        skipped: true,
        reason: "source returned fractional/non-official stats",
        metadata,
      },
      pitcher: {
        step: "mlb_pitcher_game_logs",
        rows: 0,
        skipped: true,
        reason: "source returned fractional/non-official stats",
        metadata,
      },
    };
  }

  let hitterRowsWritten = 0;
  if (hitterRows.length > 0) {
    const CHUNK = 400;
    for (let i = 0; i < hitterRows.length; i += CHUNK) {
      const slice = hitterRows.slice(i, i + CHUNK);
      const { error } = await supabase.from("mlb_hitter_game_logs").upsert(slice, {
        onConflict: "game_id,player_id",
      });
      if (error) throw new Error(`Failed to upsert mlb_hitter_game_logs: ${error.message}`);
      hitterRowsWritten += slice.length;
    }
  }

  let pitcherRowsWritten = 0;
  if (pitcherRows.length > 0) {
    const CHUNK = 400;
    for (let i = 0; i < pitcherRows.length; i += CHUNK) {
      const slice = pitcherRows.slice(i, i + CHUNK);
      const { error } = await supabase.from("mlb_pitcher_game_logs").upsert(slice, {
        onConflict: "game_id,player_id",
      });
      if (error) throw new Error(`Failed to upsert mlb_pitcher_game_logs: ${error.message}`);
      pitcherRowsWritten += slice.length;
    }
  }

  const finalMetadata = {
    ...metadata,
    hitter_rows_written: hitterRowsWritten,
    pitcher_rows_written: pitcherRowsWritten,
    rows_written: hitterRowsWritten + pitcherRowsWritten,
  };

  return {
    hitter: {
      step: "mlb_hitter_game_logs",
      rows: hitterRowsWritten,
      skipped: hitterRowsWritten === 0,
      reason: hitterRowsWritten === 0 ? "no official hitter rows written" : undefined,
      metadata: finalMetadata,
    },
    pitcher: {
      step: "mlb_pitcher_game_logs",
      rows: pitcherRowsWritten,
      skipped: pitcherRowsWritten === 0,
      reason: pitcherRowsWritten === 0 ? "no official pitcher rows written" : undefined,
      metadata: finalMetadata,
    },
  };
}

function numericMetadataValue(metadata: Record<string, unknown> | undefined, key: string): number {
  const value = metadata?.[key];
  return typeof value === "number" ? value : 0;
}

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

  const unresolvedSamples: Array<Record<string, unknown>> = [];
  const hitterSamples: any[] = [];
  const pitcherSamples: any[] = [];
  const errors: string[] = [];

  for (const d of dates) {
    const res = await ingestGameLogsForDate(supabase, d, options);
    agg.hitter.rows += res.hitter.rows;
    agg.pitcher.rows += res.pitcher.rows;
    const metadata = (res.hitter.metadata ?? {}) as Record<string, unknown>;
    agg.hitter.metadata = {
      ...(agg.hitter.metadata ?? {}),
      source_endpoint: metadata.source_endpoint,
      official_boxscore_mode: Boolean(metadata.official_boxscore_mode ?? true),
      ok_for_grading: Boolean(agg.hitter.metadata?.ok_for_grading ?? true) && Boolean(metadata.ok_for_grading ?? true),
      reason: metadata.reason ?? agg.hitter.metadata?.reason,
      games_checked: numericMetadataValue(agg.hitter.metadata, "games_checked") + numericMetadataValue(metadata, "games_checked"),
      games_final: numericMetadataValue(agg.hitter.metadata, "games_final") + numericMetadataValue(metadata, "games_final"),
      games_skipped_not_final:
        numericMetadataValue(agg.hitter.metadata, "games_skipped_not_final") +
        numericMetadataValue(metadata, "games_skipped_not_final"),
      hitter_rows: numericMetadataValue(agg.hitter.metadata, "hitter_rows") + numericMetadataValue(metadata, "hitter_rows"),
      pitcher_rows: numericMetadataValue(agg.hitter.metadata, "pitcher_rows") + numericMetadataValue(metadata, "pitcher_rows"),
      hitter_rows_written:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_written") +
        numericMetadataValue(metadata, "hitter_rows_written"),
      pitcher_rows_written:
        numericMetadataValue(agg.hitter.metadata, "pitcher_rows_written") +
        numericMetadataValue(metadata, "pitcher_rows_written"),
      unresolved_player_count:
        numericMetadataValue(agg.hitter.metadata, "unresolved_player_count") +
        numericMetadataValue(metadata, "unresolved_player_count"),
      boxscore_fetch_errors:
        numericMetadataValue(agg.hitter.metadata, "boxscore_fetch_errors") +
        numericMetadataValue(metadata, "boxscore_fetch_errors"),
      fractional_stat_rows:
        numericMetadataValue(agg.hitter.metadata, "fractional_stat_rows") +
        numericMetadataValue(metadata, "fractional_stat_rows"),
      skipped_fractional_rows:
        numericMetadataValue(agg.hitter.metadata, "skipped_fractional_rows") +
        numericMetadataValue(metadata, "skipped_fractional_rows"),
      rows_written:
        numericMetadataValue(agg.hitter.metadata, "rows_written") +
        numericMetadataValue(metadata, "rows_written"),
      recommendation:
        (metadata.recommendation as string | undefined) ??
        (agg.hitter.metadata?.recommendation as string | undefined),
      hitter_total_hits:
        numericMetadataValue(agg.hitter.metadata, "hitter_total_hits") +
        numericMetadataValue(metadata, "hitter_total_hits"),
      hitter_total_total_bases:
        numericMetadataValue(agg.hitter.metadata, "hitter_total_total_bases") +
        numericMetadataValue(metadata, "hitter_total_total_bases"),
      hitter_rows_with_hits:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_with_hits") +
        numericMetadataValue(metadata, "hitter_rows_with_hits"),
      hitter_rows_with_total_bases:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_with_total_bases") +
        numericMetadataValue(metadata, "hitter_rows_with_total_bases"),
      hitter_rows_with_headline_hits_key_found:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_with_headline_hits_key_found") +
        numericMetadataValue(metadata, "hitter_rows_with_headline_hits_key_found"),
      hitter_rows_with_headline_total_bases_key_found:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_with_headline_total_bases_key_found") +
        numericMetadataValue(metadata, "hitter_rows_with_headline_total_bases_key_found"),
      hitter_rows_with_breakdown_available:
        numericMetadataValue(agg.hitter.metadata, "hitter_rows_with_breakdown_available") +
        numericMetadataValue(metadata, "hitter_rows_with_breakdown_available"),
      suspicious_hitter_rows:
        numericMetadataValue(agg.hitter.metadata, "suspicious_hitter_rows") +
        numericMetadataValue(metadata, "suspicious_hitter_rows"),
    };
    agg.pitcher.metadata = agg.hitter.metadata;

    if (options.debugRaw) {
      const unresolved = Array.isArray(metadata.sample_unresolved_players)
        ? metadata.sample_unresolved_players as Array<Record<string, unknown>>
        : [];
      for (const item of unresolved) {
        if (unresolvedSamples.length < UNRESOLVED_SAMPLE_LIMIT) unresolvedSamples.push(item);
      }
      const hs = Array.isArray(metadata.sample_hitter_rows) ? metadata.sample_hitter_rows as any[] : [];
      for (const item of hs) {
        if (hitterSamples.length < SAMPLE_LIMIT) hitterSamples.push(item);
      }
      const ps = Array.isArray(metadata.sample_pitcher_rows) ? metadata.sample_pitcher_rows as any[] : [];
      for (const item of ps) {
        if (pitcherSamples.length < SAMPLE_LIMIT) pitcherSamples.push(item);
      }
    }

    if (res.hitter.error) errors.push(`hitter ${d}: ${res.hitter.error}`);
    if (res.pitcher.error) errors.push(`pitcher ${d}: ${res.pitcher.error}`);
  }

  if (options.debugRaw) {
    agg.hitter.metadata = {
      ...(agg.hitter.metadata ?? {}),
      sample_unresolved_players: unresolvedSamples,
      sample_hitter_rows: hitterSamples,
      sample_pitcher_rows: pitcherSamples,
    };
    agg.pitcher.metadata = agg.hitter.metadata;
  }

  if (errors.length > 0) {
    const msg = errors.slice(0, 3).join(" | ");
    agg.hitter.error = msg;
    agg.pitcher.error = msg;
  }

  return agg;
}
