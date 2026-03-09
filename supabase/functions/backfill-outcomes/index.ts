import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STAT_MAP: Record<string, string> = {
  Points: "pts", Rebounds: "reb", Assists: "ast", "3-Pointers": "fg3m",
  Steals: "stl", Blocks: "blk",
  pts: "pts", reb: "reb", ast: "ast", fg3m: "fg3m", stl: "stl", blk: "blk",
};

// All stat types we want to generate synthetic props for
const PROP_STATS = [
  { stat_type: "pts", label: "Points", thresholds: [10.5, 15.5, 20.5, 25.5, 30.5] },
  { stat_type: "reb", label: "Rebounds", thresholds: [3.5, 5.5, 7.5, 10.5] },
  { stat_type: "ast", label: "Assists", thresholds: [2.5, 4.5, 6.5, 8.5] },
  { stat_type: "fg3m", label: "3-Pointers", thresholds: [1.5, 2.5, 3.5] },
  { stat_type: "stl", label: "Steals", thresholds: [0.5, 1.5] },
  { stat_type: "blk", label: "Blocks", thresholds: [0.5, 1.5] },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const lookbackDays = body.lookback_days || 30;
    const dryRun = body.dry_run || false;

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - lookbackDays);
    const startStr = startDate.toISOString().split("T")[0];
    const endStr = new Date(now.getTime() - 86400000).toISOString().split("T")[0]; // yesterday

    console.log(`[Backfill] Generating synthetic prop outcomes from ${startStr} to ${endStr}`);

    // 1. Get ALL game logs in the range (paginate past 1000-row limit)
    const gameLogs: any[] = [];
    const PAGE_SIZE = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: page, error: pageErr } = await supabase
        .from("player_recent_games")
        .select("player_id, player_name, team_abbr, game_date, matchup, pts, reb, ast, fg3m, stl, blk")
        .gte("game_date", startStr)
        .lte("game_date", endStr)
        .order("game_date", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (pageErr) throw new Error(`Failed to fetch game logs: ${pageErr.message}`);
      if (!page || page.length === 0) {
        hasMore = false;
      } else {
        gameLogs.push(...page);
        offset += PAGE_SIZE;
        if (page.length < PAGE_SIZE) hasMore = false;
      }
    }

    if (gameLogs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No game logs in range", start: startStr, end: endStr }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Backfill] Found ${gameLogs.length} game logs across range`);

    // 2. Check which dates already have prop_outcomes to avoid duplicates
    const { data: existingDates } = await supabase
      .from("prop_outcomes")
      .select("game_date")
      .gte("game_date", startStr)
      .lte("game_date", endStr);

    const datesWithOutcomes = new Set((existingDates || []).map(d => d.game_date));
    console.log(`[Backfill] ${datesWithOutcomes.size} dates already have outcomes`);

    // 3. Group game logs by date
    const logsByDate: Record<string, typeof gameLogs> = {};
    for (const log of gameLogs) {
      if (!logsByDate[log.game_date]) logsByDate[log.game_date] = [];
      logsByDate[log.game_date].push(log);
    }

    // 4. Build historical averages per player for context
    // Simple approach: compute running averages from sorted game logs
    const playerHistory: Record<number, {
      games: { date: string; stats: Record<string, number> }[];
    }> = {};

    for (const log of gameLogs) {
      if (!playerHistory[log.player_id]) playerHistory[log.player_id] = { games: [] };
      playerHistory[log.player_id].games.push({
        date: log.game_date,
        stats: {
          pts: log.pts ?? 0, reb: log.reb ?? 0, ast: log.ast ?? 0,
          fg3m: log.fg3m ?? 0, stl: log.stl ?? 0, blk: log.blk ?? 0,
        },
      });
    }

    // 5. For each date, generate prop outcomes using reasonable thresholds
    let totalGenerated = 0;
    let totalSkipped = 0;
    const batchSize = 500;
    let currentBatch: any[] = [];

    const datesToProcess = Object.keys(logsByDate)
      .filter(d => !datesWithOutcomes.has(d))
      .sort();

    console.log(`[Backfill] Processing ${datesToProcess.length} dates`);

    for (const date of datesToProcess) {
      const dayLogs = logsByDate[date];

      for (const log of dayLogs) {
        const history = playerHistory[log.player_id];
        if (!history) continue;

        // Get games before this date for computing averages
        const priorGames = history.games.filter(g => g.date < date);
        if (priorGames.length < 3) continue; // Need minimum history

        for (const propDef of PROP_STATS) {
          const statCol = propDef.stat_type;
          const actualValue = (log as any)[statCol] ?? 0;

          // Compute season avg up to this point
          const seasonValues = priorGames.map(g => g.stats[statCol]);
          const seasonAvg = seasonValues.reduce((a, b) => a + b, 0) / seasonValues.length;

          // Find the threshold closest to the player's average
          const bestThreshold = propDef.thresholds.reduce((best, t) =>
            Math.abs(t - seasonAvg) < Math.abs(best - seasonAvg) ? t : best
          );

          // Skip if average is way below lowest threshold (not a realistic prop)
          if (seasonAvg < propDef.thresholds[0] * 0.5) continue;

          // Compute hit rates
          const last10 = priorGames.slice(-10);
          const last5 = priorGames.slice(-5);

          const seasonHitRate = seasonValues.filter(v => v >= bestThreshold).length / seasonValues.length;
          const l10HitRate = last10.length > 0
            ? last10.filter(g => g.stats[statCol] >= bestThreshold).length / last10.length
            : null;
          const l5Avg = last5.length > 0
            ? last5.reduce((s, g) => s + g.stats[statCol], 0) / last5.length
            : null;

          // Simple confidence/value scoring for historical data
          const consistency = seasonValues.length > 0
            ? 1 - (Math.sqrt(seasonValues.reduce((s, v) => s + Math.pow(v - seasonAvg, 2), 0) / seasonValues.length) / Math.max(seasonAvg, 1))
            : 0;

          const confidenceScore = Math.round(
            Math.min(100, Math.max(0,
              (seasonHitRate * 40) +
              ((l10HitRate ?? seasonHitRate) * 30) +
              (consistency * 20) +
              (Math.min(priorGames.length, 30) / 30 * 10)
            ))
          );

          const valueDiff = seasonAvg - bestThreshold;
          const valueScore = Math.round(
            Math.min(100, Math.max(0, 50 + valueDiff * 5))
          );

          const volatilityScore = Math.round((1 - consistency) * 100);

          const hit = actualValue >= bestThreshold;

          // Determine home/away from matchup
          const homeAway = log.matchup?.includes("vs.") ? "home" : "away";

          // Extract opponent
          const matchupParts = log.matchup?.split(/vs\.|@/) || [];
          const opponentAbbr = matchupParts.length > 1 ? matchupParts[1].trim() : null;

          const row = {
            game_date: date,
            player_id: log.player_id,
            player_name: log.player_name || "Unknown",
            team_abbr: log.team_abbr,
            opponent_abbr: opponentAbbr,
            home_away: homeAway,
            stat_type: statCol,
            threshold: bestThreshold,
            confidence_score: confidenceScore,
            value_score: valueScore,
            volatility_score: volatilityScore,
            consistency_score: Math.round(consistency * 100),
            line_hit_rate_l10: l10HitRate,
            line_hit_rate_season: seasonHitRate,
            actual_value: actualValue,
            hit,
            graded_at: new Date().toISOString(),
            reason_tags: [],
            source: "backfill",
          };

          currentBatch.push(row);
          totalGenerated++;

          // Flush batch
          if (currentBatch.length >= batchSize) {
            if (!dryRun) {
              const { error: insertErr } = await supabase
                .from("prop_outcomes")
                .upsert(currentBatch, { onConflict: "game_date,player_id,stat_type,threshold" });
              if (insertErr) console.error(`[Backfill] Batch insert error:`, insertErr.message);
            }
            console.log(`[Backfill] Flushed ${currentBatch.length} rows (total: ${totalGenerated})`);
            currentBatch = [];
          }
        }
      }
    }

    // Final flush
    if (currentBatch.length > 0 && !dryRun) {
      const { error: insertErr } = await supabase
        .from("prop_outcomes")
        .upsert(currentBatch, { onConflict: "game_date,player_id,stat_type,threshold" });
      if (insertErr) console.error(`[Backfill] Final batch error:`, insertErr.message);
      console.log(`[Backfill] Final flush: ${currentBatch.length} rows`);
    }

    // 6. Now generate eval_daily_snapshots for each backfilled date
    if (!dryRun && totalGenerated > 0) {
      console.log(`[Backfill] Generating daily snapshots...`);

      for (const date of datesToProcess) {
        const { data: dayProps } = await supabase
          .from("prop_outcomes")
          .select("hit, confidence_score, value_score, stat_type")
          .eq("game_date", date)
          .not("hit", "is", null);

        if (!dayProps || dayProps.length === 0) continue;

        const hits = dayProps.filter(p => p.hit === true).length;
        const total = dayProps.length;

        const confBuckets: Record<string, { hit: number; total: number }> = {};
        const valBuckets: Record<string, { hit: number; total: number }> = {};
        const statBuckets: Record<string, { hit: number; total: number }> = {};

        for (const p of dayProps) {
          const cb = bucketLabel(p.confidence_score);
          if (!confBuckets[cb]) confBuckets[cb] = { hit: 0, total: 0 };
          confBuckets[cb].total++;
          if (p.hit) confBuckets[cb].hit++;

          const vb = bucketLabel(p.value_score);
          if (!valBuckets[vb]) valBuckets[vb] = { hit: 0, total: 0 };
          valBuckets[vb].total++;
          if (p.hit) valBuckets[vb].hit++;

          if (!statBuckets[p.stat_type]) statBuckets[p.stat_type] = { hit: 0, total: 0 };
          statBuckets[p.stat_type].total++;
          if (p.hit) statBuckets[p.stat_type].hit++;
        }

        await supabase
          .from("eval_daily_snapshots")
          .upsert({
            snapshot_date: date,
            prop_total: total,
            prop_hits: hits,
            prop_hit_rate: total > 0 ? Math.round((hits / total) * 10000) / 100 : null,
            slip_total: 0,
            slip_hits: 0,
            slip_hit_rate: null,
            confidence_buckets: confBuckets,
            value_buckets: valBuckets,
            stat_type_buckets: statBuckets,
            risk_label_buckets: {},
          }, { onConflict: "snapshot_date" });
      }
    }

    return new Response(
      JSON.stringify({
        message: dryRun ? "Dry run complete" : "Backfill complete",
        start_date: startStr,
        end_date: endStr,
        total_game_logs: gameLogs.length,
        dates_processed: datesToProcess.length,
        dates_skipped: datesWithOutcomes.size,
        outcomes_generated: totalGenerated,
        dry_run: dryRun,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[Backfill] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function bucketLabel(score: number | null): string {
  if (score == null) return "N/A";
  if (score >= 70) return "70-100";
  if (score >= 50) return "50-69";
  if (score >= 30) return "30-49";
  return "0-29";
}
