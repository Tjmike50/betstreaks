import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type SportKey = "NBA" | "WNBA" | "MLB";

// ─── SportsData.io configuration ──────────────────────────────────────────────

interface SportsDataConfig {
  /** SportsData.io API path segment (v3/{sport}/scores/json/GamesByDate) */
  scheduleEndpoint: string;
  /** Map SportsData.io team abbreviations to our canonical abbreviations */
  teamNormalize: Record<string, string>;
  /** Season state — skip offseason sports */
  seasonState: "preseason" | "regular" | "postseason" | "offseason";
}

// SportsData.io team abbreviation corrections (their abbrs → ours)
const NBA_SDIO_TEAM_NORMALIZE: Record<string, string> = {
  // Most match, but a few differ
  "GS": "GSW", "SA": "SAS", "NY": "NYK", "NO": "NOP", "CHA": "CHA",
  "PHO": "PHX",
};

const WNBA_SDIO_TEAM_NORMALIZE: Record<string, string> = {
  "LV": "LVA", "LAS": "LA", "NY": "NYL", "GS": "GSV",
};

const MLB_SDIO_TEAM_NORMALIZE: Record<string, string> = {
  // SportsData.io uses standard MLB abbreviations; override only known diffs
  "ARI": "ARI", "CHW": "CWS", "KC": "KC", "SD": "SD", "SF": "SF", "TB": "TB",
};

const SDIO_CONFIG: Record<SportKey, SportsDataConfig> = {
  NBA: {
    scheduleEndpoint: "v3/nba/scores/json/GamesByDate",
    teamNormalize: NBA_SDIO_TEAM_NORMALIZE,
    seasonState: "postseason",
  },
  WNBA: {
    scheduleEndpoint: "v3/wnba/scores/json/GamesByDate",
    teamNormalize: WNBA_SDIO_TEAM_NORMALIZE,
    seasonState: "offseason",
  },
  MLB: {
    scheduleEndpoint: "v3/mlb/scores/json/GamesByDate",
    teamNormalize: MLB_SDIO_TEAM_NORMALIZE,
    seasonState: "regular",
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface SportsDataGame {
  GameID: number;
  DateTime: string | null;
  AwayTeam: string;
  HomeTeam: string;
  Status: string;
  IsClosed: boolean;
}

interface CanonicalRow {
  id: string;
  canonical_game_key: string | null;
  sport: string;
  game_date: string;
  home_team_abbr: string | null;
  away_team_abbr: string | null;
  game_time: string | null;
  status: string | null;
  verification_status: string;
  schedule_confidence: number;
  source_primary: string;
  source_secondary: string | null;
  mismatch_flags: unknown[];
  is_active: boolean;
  is_postponed: boolean;
}

interface MismatchFlag {
  flag: string;
  detected_at: string;
  detail?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeAbbr(raw: string, map: Record<string, string>): string {
  return map[raw] || raw;
}

function buildCanonicalKey(sport: string, gameDate: string, awayAbbr: string, homeAbbr: string): string {
  return `${sport}_${gameDate}_${awayAbbr}_${homeAbbr}`;
}

/**
 * Parse SportsData.io DateTime to ET game_time string for comparison.
 * SportsData returns UTC ISO strings like "2026-04-21T23:30:00".
 */
function sdioToEtTime(dt: string | null): string | null {
  if (!dt) return null;
  try {
    const d = new Date(dt.endsWith("Z") ? dt : dt + "Z");
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/New_York",
    });
  } catch {
    return null;
  }
}

/**
 * Compare two ET time strings (e.g. "07:30 PM" vs "07:00 PM").
 * Returns true if they differ by more than 30 minutes.
 */
function timeDisagrees(t1: string | null, t2: string | null): boolean {
  if (!t1 || !t2) return false; // can't compare if missing
  // Simple approach: parse hour/minute
  const parse = (t: string) => {
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let h = parseInt(m[1]);
    const min = parseInt(m[2]);
    const ampm = m[3].toUpperCase();
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return h * 60 + min;
  };
  const m1 = parse(t1);
  const m2 = parse(t2);
  if (m1 === null || m2 === null) return false;
  return Math.abs(m1 - m2) > 30;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * verify-schedule — Cross-source schedule verification pass.
 *
 * For each in-season sport:
 *   1. Fetch today's schedule from SportsData.io (secondary source)
 *   2. Load existing canonical games_today rows (primary = odds feed)
 *   3. Match by canonical_game_key
 *   4. Detect mismatches and update verification_status, schedule_confidence,
 *      source_secondary, mismatch_flags
 *
 * Sources:
 *   Primary: The Odds API (via collect-line-snapshots)
 *   Secondary: SportsData.io schedule feed
 *
 * Called by run-daily-pipeline after collect-line-snapshots.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SPORTSDATAIO_KEY = Deno.env.get("SPORTSDATAIO_API_KEY");

  if (!SPORTSDATAIO_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "SPORTSDATAIO_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const reqBody = await req.json().catch(() => ({}));
  const overrideSports: SportKey[] | null = Array.isArray(reqBody?.sports)
    ? reqBody.sports.filter((s: unknown): s is SportKey => s === "NBA" || s === "WNBA" || s === "MLB")
    : null;

  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const gameDate = (reqBody?.game_date as string) || todayET;

  const allSports: SportKey[] = overrideSports || (["NBA", "WNBA", "MLB"] as SportKey[]);
  const perSport: Record<string, unknown> = {};

  for (const sport of allSports) {
    const cfg = SDIO_CONFIG[sport];
    if (cfg.seasonState === "offseason") {
      perSport[sport] = { skipped: "offseason" };
      continue;
    }

    console.log(`[${sport}] verify-schedule: fetching SportsData.io for ${gameDate}...`);

    // ── 1. Fetch secondary source (SportsData.io) ──
    let sdioGames: SportsDataGame[] = [];
    const sdioDateFormatted = gameDate.replace(/-/g, "-"); // already YYYY-MM-DD
    const sdioUrl = `https://api.sportsdata.io/${cfg.scheduleEndpoint}/${sdioDateFormatted}?key=${SPORTSDATAIO_KEY}`;

    try {
      const res = await fetch(sdioUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`[${sport}] SportsData.io HTTP ${res.status}: ${errText}`);
        perSport[sport] = { error: `SportsData.io HTTP ${res.status}`, verification_skipped: true };
        continue;
      }
      sdioGames = await res.json();
      console.log(`[${sport}] SportsData.io returned ${sdioGames.length} games`);
    } catch (e) {
      console.error(`[${sport}] SportsData.io fetch failed:`, e);
      perSport[sport] = { error: String(e), verification_skipped: true };
      continue;
    }

    // ── 2. Build secondary game map by canonical key ──
    interface SecondaryGame {
      canonical_key: string;
      home_abbr: string;
      away_abbr: string;
      game_time_et: string | null;
      status: string;
      is_closed: boolean;
      sdio_game_id: number;
    }

    const secondaryByKey = new Map<string, SecondaryGame>();
    for (const sg of sdioGames) {
      const homeAbbr = normalizeAbbr(sg.HomeTeam, cfg.teamNormalize);
      const awayAbbr = normalizeAbbr(sg.AwayTeam, cfg.teamNormalize);
      const key = buildCanonicalKey(sport, gameDate, awayAbbr, homeAbbr);
      const etTime = sdioToEtTime(sg.DateTime);
      secondaryByKey.set(key, {
        canonical_key: key,
        home_abbr: homeAbbr,
        away_abbr: awayAbbr,
        game_time_et: etTime,
        status: sg.Status,
        is_closed: sg.IsClosed,
        sdio_game_id: sg.GameID,
      });
    }

    // ── 3. Load canonical games_today rows for this sport + date ──
    const { data: canonicalRows, error: dbErr } = await supabase
      .from("games_today")
      .select("id, canonical_game_key, sport, game_date, home_team_abbr, away_team_abbr, game_time, status, verification_status, schedule_confidence, source_primary, source_secondary, mismatch_flags, is_active, is_postponed")
      .eq("sport", sport)
      .eq("game_date", gameDate);

    if (dbErr) {
      console.error(`[${sport}] DB read error:`, dbErr);
      perSport[sport] = { error: dbErr.message };
      continue;
    }

    const rows = (canonicalRows || []) as CanonicalRow[];
    console.log(`[${sport}] Found ${rows.length} canonical rows to verify against ${secondaryByKey.size} secondary games`);

    const now = new Date().toISOString();
    const updates: { id: string; patch: Record<string, unknown> }[] = [];
    const matchedSecondaryKeys = new Set<string>();

    let verified = 0, mismatched = 0, missingSecondary = 0, secondaryOnly = 0;

    // ── 4. Cross-check each canonical row against secondary ──
    for (const row of rows) {
      const key = row.canonical_game_key;
      const flags: MismatchFlag[] = [];

      // Preserve any existing non-verification flags
      const existingFlags = Array.isArray(row.mismatch_flags) ? row.mismatch_flags : [];
      const existingNonVerifFlags = (existingFlags as MismatchFlag[]).filter(
        f => !f.flag?.startsWith("secondary_") && f.flag !== "primary_only_no_secondary" && f.flag !== "start_time_cross_source_disagrees" && f.flag !== "home_team_cross_source_disagrees" && f.flag !== "away_team_cross_source_disagrees"
      );

      if (!key) {
        // No canonical key — can't cross-check
        flags.push({ flag: "no_canonical_key_for_cross_check", detected_at: now });
        updates.push({
          id: row.id,
          patch: {
            mismatch_flags: [...existingNonVerifFlags, ...flags],
            verification_status: "unverified",
            schedule_confidence: Math.min(row.schedule_confidence, 35),
            last_verified_at: now,
            updated_at: now,
          },
        });
        missingSecondary++;
        continue;
      }

      const secondary = secondaryByKey.get(key);
      matchedSecondaryKeys.add(key);

      if (!secondary) {
        // Primary has game, secondary does not
        flags.push({ flag: "primary_only_no_secondary", detected_at: now, detail: "Game in odds feed but not in SportsData.io schedule" });
        updates.push({
          id: row.id,
          patch: {
            source_secondary: null,
            mismatch_flags: [...existingNonVerifFlags, ...flags],
            verification_status: "missing_secondary",
            schedule_confidence: Math.min(row.schedule_confidence, 55),
            last_verified_at: now,
            updated_at: now,
          },
        });
        missingSecondary++;
        continue;
      }

      // Secondary found — cross-check fields
      let hasConflict = false;

      // Time check
      if (timeDisagrees(row.game_time, secondary.game_time_et)) {
        flags.push({
          flag: "start_time_cross_source_disagrees",
          detected_at: now,
          detail: `primary=${row.game_time}, secondary=${secondary.game_time_et}`,
        });
        hasConflict = true;
      }

      // Team checks
      if (row.home_team_abbr && secondary.home_abbr && row.home_team_abbr !== secondary.home_abbr) {
        flags.push({
          flag: "home_team_cross_source_disagrees",
          detected_at: now,
          detail: `primary=${row.home_team_abbr}, secondary=${secondary.home_abbr}`,
        });
        hasConflict = true;
      }

      if (row.away_team_abbr && secondary.away_abbr && row.away_team_abbr !== secondary.away_abbr) {
        flags.push({
          flag: "away_team_cross_source_disagrees",
          detected_at: now,
          detail: `primary=${row.away_team_abbr}, secondary=${secondary.away_abbr}`,
        });
        hasConflict = true;
      }

      // Derive is_active / is_postponed from secondary status
      const secStatus = (secondary.status || "").toLowerCase();
      const secPostponed = secStatus.includes("postponed") || secStatus === "ppd";
      const secCanceled = secStatus.includes("canceled") || secStatus.includes("cancelled");
      if (secPostponed && row.is_active) {
        flags.push({ flag: "secondary_reports_postponed", detected_at: now });
        hasConflict = true;
      }
      if (secCanceled && row.is_active) {
        flags.push({ flag: "secondary_reports_canceled", detected_at: now });
        hasConflict = true;
      }

      // Compute final verification
      let verificationStatus: string;
      let confidence = row.schedule_confidence;

      if (hasConflict) {
        verificationStatus = "mismatch";
        confidence = Math.min(confidence, 45);
        mismatched++;
      } else {
        verificationStatus = "verified";
        // Boost confidence — two sources agree
        confidence = Math.max(confidence, 90);
        verified++;
      }

      // Update is_postponed if secondary confirms
      const patchIsPostponed = secPostponed ? true : row.is_postponed;
      const patchIsActive = (secPostponed || secCanceled) ? false : row.is_active;

      updates.push({
        id: row.id,
        patch: {
          source_secondary: "sportsdata_io",
          mismatch_flags: [...existingNonVerifFlags, ...flags],
          verification_status: verificationStatus,
          schedule_confidence: Math.max(0, Math.min(100, confidence)),
          last_verified_at: now,
          is_postponed: patchIsPostponed,
          is_active: patchIsActive,
          updated_at: now,
        },
      });
    }

    // ── 5. Detect secondary-only games (in SportsData.io but not in primary) ──
    const secondaryOnlyGames: string[] = [];
    for (const [key, sg] of secondaryByKey.entries()) {
      if (!matchedSecondaryKeys.has(key)) {
        secondaryOnlyGames.push(key);
        secondaryOnly++;

        // Check if this game is missing from odds feed but exists in schedule
        // Flag it on any existing row for this sport+date that has closest match,
        // or log it for admin review.
        console.warn(`[${sport}] Secondary-only game not in primary: ${key} (SDIO #${sg.sdio_game_id}, time=${sg.game_time_et})`);
      }
    }

    // ── 6. Apply updates ──
    let updateErrors = 0;
    for (const { id, patch } of updates) {
      const { error: uErr } = await supabase
        .from("games_today")
        .update(patch)
        .eq("id", id);
      if (uErr) {
        console.error(`[${sport}] Update error for ${id}:`, uErr);
        updateErrors++;
      }
    }

    perSport[sport] = {
      canonical_rows: rows.length,
      secondary_games: secondaryByKey.size,
      verified,
      mismatched,
      missing_secondary: missingSecondary,
      secondary_only: secondaryOnly,
      secondary_only_keys: secondaryOnlyGames,
      update_errors: updateErrors,
    };

    console.log(`[${sport}] Verification complete: ${verified} verified, ${mismatched} mismatched, ${missingSecondary} missing_secondary, ${secondaryOnly} secondary-only`);
  }

  const summary = {
    ok: true,
    game_date: gameDate,
    sports: perSport,
    ran_at: new Date().toISOString(),
  };

  console.log("verify-schedule complete:", JSON.stringify(summary));

  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
