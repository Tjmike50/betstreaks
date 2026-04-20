// ============================================================
// BetStreaks — MLB game-log ingestion (hitter + pitcher)
//
// Pulls SportsDataIO PlayerGameStatsByDate for one or more dates
// and upserts into:
//   • mlb_hitter_game_logs
//   • mlb_pitcher_game_logs
//
// Used by `refresh-mlb-data`. Idempotent — every row upserts on
// (game_id, player_id) via the v1 schema's natural key.
//
// v1 scope: only the fields needed by score-mlb-anchors for the
// 3 anchor props (HITS / TOTAL_BASES / STRIKEOUTS). We still
// store doubles / triples / HR so total_bases is real even though
// SportsDataIO already supplies a TotalBases field — we trust
// theirs first and fall back to a derived sum.
// ============================================================

const SPORTSDATA_STATS_BASE = "https://api.sportsdata.io/v3/mlb/stats/json";

type Supa = {
  from: (table: string) => any;
};

export interface IngestLogResult {
  step: string;
  rows: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

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

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * SportsDataIO returns one record per player per game with both batting and
 * pitching stat fields populated where applicable. PositionCategory tells us
 * which "side" to write.
 */
function isPitcherRow(row: any): boolean {
  const pc = (row?.PositionCategory ?? "").toString().toUpperCase();
  if (pc === "P" || pc === "PITCHER") return true;
  // Fallback: if InningsPitchedDecimal > 0 they pitched in this game.
  const ip = Number(row?.InningsPitchedDecimal ?? row?.InningsPitchedFull ?? 0);
  return Number.isFinite(ip) && ip > 0;
}

function deriveTotalBases(row: any): number | null {
  const tb = num(row?.TotalBases);
  if (tb !== null) return tb;
  const singles = num(row?.Singles) ?? 0;
  const doubles = num(row?.Doubles) ?? 0;
  const triples = num(row?.Triples) ?? 0;
  const hr = num(row?.HomeRuns) ?? 0;
  return singles + 2 * doubles + 3 * triples + 4 * hr;
}

/**
 * Ingest hitter + pitcher game logs for the given ISO date (YYYY-MM-DD).
 * Returns one StepResult per table.
 */
export async function ingestGameLogsForDate(
  supabase: Supa,
  dateStr: string,
): Promise<{ hitter: IngestLogResult; pitcher: IngestLogResult }> {
  const result = {
    hitter: { step: "mlb_hitter_game_logs", rows: 0 } as IngestLogResult,
    pitcher: { step: "mlb_pitcher_game_logs", rows: 0 } as IngestLogResult,
  };

  let raw: any[];
  try {
    raw = (await fetchSportsData(
      `${SPORTSDATA_STATS_BASE}/PlayerGameStatsByDate/${dateStr}`,
    )) as any[];
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    result.hitter.error = msg;
    result.pitcher.error = msg;
    return result;
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    result.hitter.skipped = true;
    result.hitter.reason = "no game stats for date";
    result.pitcher.skipped = true;
    result.pitcher.reason = "no game stats for date";
    return result;
  }

  const hitterRows: any[] = [];
  const pitcherRows: any[] = [];

  for (const r of raw) {
    const playerId = intOrNull(r?.PlayerID);
    const gameIdRaw = intOrNull(r?.GameID);
    if (playerId === null || gameIdRaw === null) continue;
    const gameId = `mlb_${gameIdRaw}`;
    const gameDate = (r?.Day ?? r?.DateTime ?? dateStr).toString().slice(0, 10);
    const teamId = intOrNull(r?.TeamID);
    const opponentId = intOrNull(r?.OpponentID);
    const isHome = r?.HomeOrAway ? String(r.HomeOrAway).toUpperCase() === "HOME" : null;

    if (isPitcherRow(r)) {
      pitcherRows.push({
        player_id: playerId,
        game_id: gameId,
        game_date: gameDate,
        team_id: teamId,
        opponent_team_id: opponentId,
        is_home: isHome,
        innings_pitched: num(r?.InningsPitchedDecimal ?? r?.InningsPitchedFull),
        strikeouts: intOrNull(r?.PitchingStrikeouts),
        walks_allowed: intOrNull(r?.PitchingWalks),
        hits_allowed: intOrNull(r?.PitchingHits),
        earned_runs_allowed: intOrNull(r?.PitchingEarnedRuns),
        home_runs_allowed: intOrNull(r?.PitchingHomeRuns),
        batters_faced: intOrNull(r?.PitchingBattersFaced),
        pitch_count: intOrNull(r?.PitchesThrown),
      });
    } else {
      hitterRows.push({
        player_id: playerId,
        game_id: gameId,
        game_date: gameDate,
        team_id: teamId,
        opponent_team_id: opponentId,
        opposing_pitcher_id: intOrNull(r?.OpposingPitcherID),
        is_home: isHome,
        batting_order: intOrNull(r?.BattingOrder),
        plate_appearances: intOrNull(r?.PlateAppearances),
        at_bats: intOrNull(r?.AtBats),
        hits: intOrNull(r?.Hits),
        singles: intOrNull(r?.Singles),
        doubles: intOrNull(r?.Doubles),
        triples: intOrNull(r?.Triples),
        home_runs: intOrNull(r?.HomeRuns),
        total_bases: deriveTotalBases(r),
        runs: intOrNull(r?.Runs),
        rbi: intOrNull(r?.RunsBattedIn),
        walks: intOrNull(r?.Walks),
        strikeouts: intOrNull(r?.Strikeouts),
        stolen_bases: intOrNull(r?.StolenBases),
      });
    }
  }

  // Upsert hitters
  if (hitterRows.length > 0) {
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
    } catch (e: any) {
      result.hitter.error = String(e?.message ?? e);
    }
  } else {
    result.hitter.skipped = true;
    result.hitter.reason = "no hitter rows in payload";
  }

  // Upsert pitchers
  if (pitcherRows.length > 0) {
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
    result.pitcher.reason = "no pitcher rows in payload";
  }

  console.log(
    `[mlb-gamelogs] date=${dateStr} hitter=${result.hitter.rows} pitcher=${result.pitcher.rows}`,
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
): Promise<{ hitter: IngestLogResult; pitcher: IngestLogResult; dates: string[] }> {
  const dates: string[] = [];
  const end = new Date(`${endDateStr}T12:00:00Z`);
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const agg = {
    hitter: { step: "mlb_hitter_game_logs", rows: 0 } as IngestLogResult,
    pitcher: { step: "mlb_pitcher_game_logs", rows: 0 } as IngestLogResult,
    dates,
  };
  const errors: string[] = [];

  for (const d of dates) {
    const r = await ingestGameLogsForDate(supabase, d);
    agg.hitter.rows += r.hitter.rows;
    agg.pitcher.rows += r.pitcher.rows;
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
