// =============================================================================
// generate-daily-pick — deterministic daily-pick generator.
// Reads from player_prop_scores for today's game_date for the requested sport,
// selects up to N legs using a deterministic recipe, and writes one row to
// ai_daily_picks (+ ai_daily_pick_legs). Idempotent via UNIQUE(sport,pick_date)
// — duplicate calls for the same (sport,date) skip silently.
//
// No AI prose layer yet (deterministic name + templated reasoning only).
// No cron yet — invoke manually via supabase.functions.invoke or curl.
//
// Query/body params:
//   sport: "NBA" | "WNBA"  (required, default "NBA")
//   leg_count: number      (optional, default 3, clamped 1..6)
//   game_date: "YYYY-MM-DD" (optional, defaults to today UTC date)
//   force: boolean         (optional, ADMIN-ONLY) — when true, deletes any
//                          existing pick for (sport, pick_date) and regenerates.
//                          Requires Authorization: Bearer <user_jwt> for an
//                          admin user (user_flags.is_admin = true).
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getMlbDailyPickCandidates,
  inferMlbSide,
  mlbStatLabel,
  type MlbCandidate,
} from "../_shared/mlbCandidates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PropScoreRow {
  id: string;
  game_date: string;
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  stat_type: string;
  threshold: number;
  confidence_score: number | null;
  value_score: number | null;
  last10_avg: number | null;
  season_avg: number | null;
  sport: string;
}

const RISK_LABEL = (avgConfidence: number): "safe" | "balanced" | "aggressive" => {
  // Calibrated to market-first scoring scale (15–85, typical high ~70).
  if (avgConfidence >= 65) return "safe";
  if (avgConfidence >= 55) return "balanced";
  return "aggressive";
};

const STAT_LABEL: Record<string, string> = {
  pts: "Points",
  reb: "Rebounds",
  ast: "Assists",
  stl: "Steals",
  blk: "Blocks",
  fg3m: "3-Pointers Made",
  pra: "PRA",
  pr: "PR",
  pa: "PA",
  ra: "RA",
};

function statLabel(stat: string): string {
  return STAT_LABEL[stat.toLowerCase()] ?? stat.toUpperCase();
}

function determineSide(row: PropScoreRow): "Over" | "Under" {
  // Pick "Over" if recent average comfortably exceeds threshold; else infer from
  // value_score sign-equivalent. Value score >= 50 typically encodes positive EV
  // toward the over in our scoring engine, so default to Over unless recents
  // clearly favor the Under.
  const recent = row.last10_avg ?? row.season_avg ?? 0;
  if (row.threshold > 0 && recent < row.threshold * 0.9) return "Under";
  return "Over";
}

function pickLegs(rows: PropScoreRow[], legCount: number): PropScoreRow[] {
  // Deterministic recipe (calibrated to market-first scoring scale 15–85):
  // - Sanity floors: confidence_score >= 55, value_score >= 50
  // - Composite = (confidence * 0.6 + value * 0.4) — confidence weighted higher
  // - Diversification passes: stat-type, then game-uniqueness, then player-uniqueness
  // - Returns top N after diversification
  const eligible = rows
    .filter(
      (r) =>
        (r.confidence_score ?? 0) >= 55 &&
        (r.value_score ?? 0) >= 50 &&
        r.threshold > 0 &&
        r.player_name &&
        r.stat_type,
    )
    .sort((a, b) => {
      const sa =
        (a.confidence_score ?? 0) * 0.6 + (a.value_score ?? 0) * 0.4;
      const sb =
        (b.confidence_score ?? 0) * 0.6 + (b.value_score ?? 0) * 0.4;
      return sb - sa;
    });


  const picked: PropScoreRow[] = [];
  const seenPlayers = new Set<number>();
  const seenGames = new Set<string>();
  const seenStats = new Set<string>();

  // Pass 1: enforce stat diversity
  for (const row of eligible) {
    if (picked.length >= legCount) break;
    const gameKey = [row.team_abbr, row.opponent_abbr].sort().join("@");
    if (seenPlayers.has(row.player_id)) continue;
    if (seenGames.has(gameKey)) continue;
    if (seenStats.has(row.stat_type)) continue;
    picked.push(row);
    seenPlayers.add(row.player_id);
    seenGames.add(gameKey);
    seenStats.add(row.stat_type);
  }

  // Pass 2: relax stat diversity if still short
  if (picked.length < legCount) {
    for (const row of eligible) {
      if (picked.length >= legCount) break;
      const gameKey = [row.team_abbr, row.opponent_abbr].sort().join("@");
      if (seenPlayers.has(row.player_id)) continue;
      if (seenGames.has(gameKey)) continue;
      picked.push(row);
      seenPlayers.add(row.player_id);
      seenGames.add(gameKey);
    }
  }

  // Pass 3: relax game uniqueness as last resort
  if (picked.length < legCount) {
    for (const row of eligible) {
      if (picked.length >= legCount) break;
      if (seenPlayers.has(row.player_id)) continue;
      picked.push(row);
      seenPlayers.add(row.player_id);
    }
  }

  return picked;
}

// =============================================================================
// Odds enrichment helpers (DraftKings-only for v1)
// =============================================================================
function americanToDecimal(american: string | null | undefined): number | null {
  if (!american) return null;
  const trimmed = String(american).trim().replace(/^\+/, "");
  const n = Number(trimmed);
  if (!isFinite(n) || n === 0) return null;
  if (n > 0) return n / 100 + 1;
  return 100 / Math.abs(n) + 1;
}

function decimalToAmerican(decimal: number | null): string | null {
  if (decimal == null || !isFinite(decimal) || decimal <= 1) return null;
  if (decimal >= 2) {
    const v = Math.round((decimal - 1) * 100);
    return `+${v}`;
  }
  const v = Math.round(-100 / (decimal - 1));
  return `${v}`; // already negative
}

// Map prop-score stat codes (pts/reb/ast/fg3m/...) → line_snapshots labels
// (Points/Rebounds/Assists/3-Pointers/...). DK is our v1 source.
const STAT_CODE_TO_SNAPSHOT_LABEL: Record<string, string[]> = {
  pts: ["Points"],
  reb: ["Rebounds"],
  ast: ["Assists"],
  fg3m: ["3-Pointers", "3-Pointers Made", "Threes Made"],
  stl: ["Steals"],
  blk: ["Blocks"],
  pra: ["Pts+Rebs+Asts", "PRA"],
  pr: ["Pts+Rebs", "PR"],
  pa: ["Pts+Asts", "PA"],
  ra: ["Rebs+Asts", "RA"],
};

interface EnrichedLeg extends PropScoreRow {
  side: "Over" | "Under";
  odds: string | null;
}

async function enrichLegsWithOdds(
  supabase: ReturnType<typeof createClient>,
  legs: PropScoreRow[],
  gameDate: string,
): Promise<{ enriched: EnrichedLeg[]; estimatedOdds: string | null }> {
  const enriched = await Promise.all(
    legs.map(async (leg): Promise<EnrichedLeg> => {
      const side = determineSide(leg);
      const labelCandidates =
        STAT_CODE_TO_SNAPSHOT_LABEL[leg.stat_type.toLowerCase()] ?? [leg.stat_type];
      try {
        const { data, error } = await supabase
          .from("line_snapshots")
          .select("over_odds, under_odds, snapshot_at, stat_type")
          .eq("player_name", leg.player_name)
          .in("stat_type", labelCandidates)
          .eq("threshold", leg.threshold)
          .eq("game_date", gameDate)
          .eq("sportsbook", "draftkings")
          .order("snapshot_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          console.warn(
            `[generate-daily-pick] odds lookup error for ${leg.player_name} ${leg.stat_type} ${leg.threshold}:`,
            error.message,
          );
          return { ...leg, side, odds: null };
        }
        const odds = side === "Over" ? data?.over_odds ?? null : data?.under_odds ?? null;
        return { ...leg, side, odds: odds ?? null };
      } catch (err) {
        console.warn(
          `[generate-daily-pick] odds lookup failed for ${leg.player_name}:`,
          err instanceof Error ? err.message : err,
        );
        return { ...leg, side, odds: null };
      }
    }),
  );

  // Compute parlay total only if every leg has odds
  const decimals = enriched.map((l) => americanToDecimal(l.odds));
  if (decimals.some((d) => d == null)) {
    return { enriched, estimatedOdds: null };
  }
  const totalDecimal = decimals.reduce((acc, d) => acc * (d as number), 1);
  return { enriched, estimatedOdds: decimalToAmerican(totalDecimal) };
}

function buildSlipName(sport: string, dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  return `${sport} Daily Pick — ${month} ${day}`;
}

function buildReasoning(legs: PropScoreRow[], avgConfidence: number): string {
  const stats = [...new Set(legs.map((l) => statLabel(l.stat_type)))].join(", ");
  return `Auto-selected from today's top scoring-engine props (avg confidence ${avgConfidence.toFixed(
    0,
  )}). Mix of ${stats}. Based on recent form, matchup history, and value vs market. Not financial advice — please bet responsibly.`;
}

// =============================================================================
// AI prose layer (Lovable AI Gateway, fail-soft)
// Only rewrites slip_name + reasoning. Picks/odds/risk stay deterministic.
// =============================================================================
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-3-flash-preview";
const AI_TIMEOUT_MS = 8000;

async function generateProse(
  sport: string,
  legs: EnrichedLeg[],
  riskLabel: string,
  avgConfidence: number,
  estimatedOdds: string | null,
  gameDate: string,
): Promise<{ slip_name: string; reasoning: string } | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.warn("[generate-daily-pick] LOVABLE_API_KEY missing — skipping AI prose");
    return null;
  }

  const legSummaries = legs.map((l, i) => {
    const recent = l.last10_avg ?? l.season_avg ?? 0;
    return `Leg ${i + 1}: ${l.player_name} (${l.team_abbr ?? "?"} vs ${l.opponent_abbr ?? "?"}) — ${l.side} ${l.threshold} ${statLabel(l.stat_type)}${l.odds ? ` @ ${l.odds}` : ""}. Confidence ${(l.confidence_score ?? 0).toFixed(0)}, Value ${(l.value_score ?? 0).toFixed(0)}, recent avg ${recent.toFixed(1)}.`;
  }).join("\n");

  const systemPrompt = `You are a sports analyst writing concise, neutral copy for ${sport} player-prop parlays. Rules:
- Never use the words "guaranteed", "lock", "sure thing", "free money", or similar certainty language.
- Sound analytical, not hype-y.
- No emojis, no markdown.
- Reference real factors: recent form, matchup, value vs market.
- Keep reasoning to 1-2 sentences (max ~30 words).
- Slip name: 3-6 words, punchy, references a player or theme. No date in the name.`;

  const userPrompt = `Sport: ${sport}
Date: ${gameDate}
Risk profile: ${riskLabel} (avg confidence ${avgConfidence.toFixed(0)})
Estimated parlay odds: ${estimatedOdds ?? "not available"}

Legs:
${legSummaries}

Write a short slip_name and a 1-2 sentence reasoning explaining why these legs were chosen.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "format_daily_pick",
              description: "Return a slip name and reasoning for a daily pick.",
              parameters: {
                type: "object",
                properties: {
                  slip_name: {
                    type: "string",
                    description: "3-6 word punchy headline for the parlay.",
                  },
                  reasoning: {
                    type: "string",
                    description: "1-2 sentence neutral analyst summary, max ~30 words.",
                  },
                },
                required: ["slip_name", "reasoning"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "format_daily_pick" } },
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(
        `[generate-daily-pick] AI prose failed [${response.status}]: ${body.slice(0, 300)}`,
      );
      return null;
    }

    const data = await response.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    const argsStr = toolCall?.function?.arguments;
    if (!argsStr) {
      console.warn("[generate-daily-pick] AI prose returned no tool_call arguments");
      return null;
    }
    const parsed = JSON.parse(argsStr);
    const slip_name = typeof parsed?.slip_name === "string" ? parsed.slip_name.trim() : "";
    const reasoning = typeof parsed?.reasoning === "string" ? parsed.reasoning.trim() : "";
    if (!slip_name || !reasoning) {
      console.warn("[generate-daily-pick] AI prose returned empty fields");
      return null;
    }

    // Compliance guard — strip if forbidden terms slipped through
    const forbidden = /\b(guaranteed|guarantee|lock|sure thing|free money)\b/i;
    if (forbidden.test(slip_name) || forbidden.test(reasoning)) {
      console.warn("[generate-daily-pick] AI prose tripped compliance guard, falling back");
      return null;
    }

    return { slip_name, reasoning };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[generate-daily-pick] AI prose exception: ${msg}`);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const url = new URL(req.url);
    let sport = (url.searchParams.get("sport") ?? "NBA").toUpperCase();
    let legCount = Number(url.searchParams.get("leg_count") ?? "3");
    let gameDate = url.searchParams.get("game_date") ?? "";
    let force = url.searchParams.get("force") === "true";

    // Allow body to override
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.sport) sport = String(body.sport).toUpperCase();
        if (body?.leg_count != null) legCount = Number(body.leg_count);
        if (body?.game_date) gameDate = String(body.game_date);
        if (body?.force === true) force = true;
      } catch {
        // ignore — empty body is fine
      }
    }

    if (sport !== "NBA" && sport !== "WNBA" && sport !== "MLB") {
      return new Response(
        JSON.stringify({ ok: false, error: `Unsupported sport: ${sport}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    legCount = Math.max(1, Math.min(6, isNaN(legCount) ? 3 : legCount));

    if (!gameDate) {
      gameDate = new Date().toISOString().slice(0, 10);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // -------------------------------------------------------------------------
    // Admin verification — only when force=true.
    // Default (cron / non-force) path stays open.
    // -------------------------------------------------------------------------
    let adminUserId: string | null = null;
    if (force) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!token) {
        return new Response(
          JSON.stringify({ ok: false, error: "Authentication required for force=true" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { data: userData, error: userError } = await supabase.auth.getUser(token);
      if (userError || !userData?.user) {
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid auth token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { data: flags, error: flagsError } = await supabase
        .from("user_flags")
        .select("is_admin")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (flagsError || !flags?.is_admin) {
        return new Response(
          JSON.stringify({ ok: false, error: "Admin privileges required for force=true" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      adminUserId = userData.user.id;
      console.log(
        `[generate-daily-pick] Force regenerate authorized for admin ${adminUserId} (${sport} ${gameDate})`,
      );
    }

    // -------------------------------------------------------------------------
    // Existing pick handling
    //   force=false → skip-on-conflict (current behavior, unchanged)
    //   force=true  → delete existing pick + legs (FK cascade), then regenerate
    // -------------------------------------------------------------------------
    const { data: existing, error: existingError } = await supabase
      .from("ai_daily_picks")
      .select("id, slip_name, created_at")
      .eq("sport", sport)
      .eq("pick_date", gameDate)
      .maybeSingle();

    if (existingError) throw existingError;

    let previousPickId: string | null = null;
    if (existing) {
      if (!force) {
        console.log(
          `[generate-daily-pick] Skip: pick already exists for ${sport} ${gameDate} (id=${existing.id})`,
        );
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: true,
            reason: "already_exists",
            existing_pick_id: existing.id,
            sport,
            pick_date: gameDate,
            duration_ms: Date.now() - startTime,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      previousPickId = existing.id;
      const { error: deleteError } = await supabase
        .from("ai_daily_picks")
        .delete()
        .eq("id", existing.id);
      if (deleteError) {
        console.error(
          `[generate-daily-pick] Failed to delete existing pick ${existing.id}:`,
          deleteError,
        );
        throw deleteError;
      }
      console.log(
        `[generate-daily-pick] Force: deleted previous pick ${existing.id} for ${sport} ${gameDate}`,
      );
    }

    // Pull candidate prop scores for this sport + date
    const { data: scores, error: scoresError } = await supabase
      .from("player_prop_scores")
      .select(
        "id, game_date, player_id, player_name, team_abbr, opponent_abbr, stat_type, threshold, confidence_score, value_score, last10_avg, season_avg, sport",
      )
      .eq("sport", sport)
      .eq("game_date", gameDate)
      .order("confidence_score", { ascending: false })
      .limit(500);

    if (scoresError) throw scoresError;

    const candidates = (scores ?? []) as PropScoreRow[];
    console.log(
      `[generate-daily-pick] ${sport} ${gameDate}: ${candidates.length} candidate prop scores`,
    );

    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: "no_candidates",
          sport,
          pick_date: gameDate,
          message: `No player_prop_scores rows for ${sport} on ${gameDate} — likely offseason or pre-pipeline.`,
          duration_ms: Date.now() - startTime,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const legs = pickLegs(candidates, legCount);

    if (legs.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: "no_eligible_legs",
          sport,
          pick_date: gameDate,
          message: `Found ${candidates.length} candidates but none met confidence>=70 & value>=60 thresholds.`,
          duration_ms: Date.now() - startTime,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const avgConfidence =
      legs.reduce((sum, l) => sum + (l.confidence_score ?? 0), 0) / legs.length;
    const riskLabel = RISK_LABEL(avgConfidence);
    const deterministicSlipName = buildSlipName(sport, gameDate);
    const deterministicReasoning = buildReasoning(legs, avgConfidence);

    // Enrich with DraftKings odds (fail-soft: missing snapshot → null)
    const { enriched, estimatedOdds } = await enrichLegsWithOdds(
      supabase,
      legs,
      gameDate,
    );
    const oddsHitCount = enriched.filter((l) => l.odds != null).length;
    console.log(
      `[generate-daily-pick] Odds enrichment: ${oddsHitCount}/${enriched.length} legs matched · estimated_odds=${estimatedOdds ?? "null"}`,
    );

    // AI prose layer — fail-soft, falls back to deterministic strings
    const proseStart = Date.now();
    const prose = await generateProse(
      sport,
      enriched,
      riskLabel,
      avgConfidence,
      estimatedOdds,
      gameDate,
    );
    const proseSource: "ai" | "deterministic" = prose ? "ai" : "deterministic";
    const slipName = prose?.slip_name ?? deterministicSlipName;
    const reasoning = prose?.reasoning ?? deterministicReasoning;
    console.log(
      `[generate-daily-pick] Prose source: ${proseSource} (${Date.now() - proseStart}ms)`,
    );

    // Insert pick
    const { data: insertedPick, error: insertPickError } = await supabase
      .from("ai_daily_picks")
      .insert({
        sport,
        pick_date: gameDate,
        risk_label: riskLabel,
        slip_name: slipName,
        reasoning,
        estimated_odds: estimatedOdds,
        generation_source: "auto",
      })
      .select("id")
      .single();

    if (insertPickError) {
      // Could be a race on the unique constraint — treat as skip
      if (insertPickError.code === "23505") {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: true,
            reason: "race_conflict",
            sport,
            pick_date: gameDate,
            duration_ms: Date.now() - startTime,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw insertPickError;
    }

    const pickId = insertedPick.id;

    // Insert legs (with enriched odds)
    const legRows = enriched.map((leg, idx) => ({
      daily_pick_id: pickId,
      leg_order: idx + 1,
      player_name: leg.player_name,
      team_abbr: leg.team_abbr,
      stat_type: leg.stat_type,
      pick: leg.side,
      line: String(leg.threshold),
      odds: leg.odds,
      reasoning: `Confidence ${(leg.confidence_score ?? 0).toFixed(0)} · Value ${(leg.value_score ?? 0).toFixed(0)} · L10 avg ${(leg.last10_avg ?? leg.season_avg ?? 0).toFixed(1)}`,
    }));

    const { error: insertLegsError } = await supabase
      .from("ai_daily_pick_legs")
      .insert(legRows);

    if (insertLegsError) {
      // Roll back the parent pick to keep things clean
      await supabase.from("ai_daily_picks").delete().eq("id", pickId);
      throw insertLegsError;
    }

    console.log(
      `[generate-daily-pick] Created pick ${pickId} for ${sport} ${gameDate} with ${legs.length} legs (risk=${riskLabel})`,
    );

    // Audit log — success only, admin-triggered force regenerates
    if (force && adminUserId) {
      try {
        await supabase.from("analytics_events").insert({
          event_name: "admin_regenerate_daily_pick",
          user_id: adminUserId,
          metadata: {
            sport,
            pick_date: gameDate,
            previous_pick_id: previousPickId,
            new_pick_id: pickId,
            leg_count: legs.length,
            risk_label: riskLabel,
            avg_confidence: Number(avgConfidence.toFixed(1)),
            estimated_odds: estimatedOdds,
            odds_hit_count: oddsHitCount,
            prose_source: proseSource,
          },
        });
      } catch (auditErr) {
        console.error("[generate-daily-pick] audit log write failed:", auditErr);
        // non-fatal — pick is already created
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        created: true,
        forced: force,
        previous_pick_id: previousPickId,
        pick_id: pickId,
        sport,
        pick_date: gameDate,
        slip_name: slipName,
        risk_label: riskLabel,
        leg_count: legs.length,
        avg_confidence: Number(avgConfidence.toFixed(1)),
        estimated_odds: estimatedOdds,
        odds_hit_count: oddsHitCount,
        prose_source: proseSource,
        duration_ms: Date.now() - startTime,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[generate-daily-pick] failed:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
