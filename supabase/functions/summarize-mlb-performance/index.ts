import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_WINDOWS = ["daily", "last_7_days"] as const;
const ALLOWED_WINDOWS = ["daily", "last_7_days", "last_14_days", "season_to_date"] as const;

type SummaryWindow = typeof ALLOWED_WINDOWS[number];
type Outcome = "hit" | "miss" | "push" | "pending" | "void";

interface OutcomeRow {
  player_prop_score_id: string;
  sport: string;
  game_date: string;
  stat_type: string | null;
  outcome: Outcome | null;
}

interface ScoreMetaRow {
  id: string;
  confidence_tier: string | null;
  summary_json: Record<string, unknown> | null;
}

interface SummaryRow {
  sport: string;
  summary_date: string;
  summary_window: SummaryWindow;
  group_type: "overall" | "stat_type" | "confidence_tier" | "line_quality_tier";
  group_key: string;
  total_count: number;
  graded_count: number;
  hit_count: number;
  miss_count: number;
  push_count: number;
  pending_count: number;
  void_count: number;
  hit_rate: number | null;
  push_adjusted_hit_rate: number | null;
  metadata: Record<string, unknown>;
  generated_at: string;
}

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function shiftIsoDate(isoDate: string, dayDelta: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayDelta);
  return date.toISOString().slice(0, 10);
}

function seasonStartFor(summaryDate: string): string {
  return `${summaryDate.slice(0, 4)}-03-01`;
}

function normalizeWindows(input: unknown): SummaryWindow[] {
  if (!Array.isArray(input) || input.length === 0) return [...DEFAULT_WINDOWS];
  const unique = new Set<SummaryWindow>();
  for (const item of input) {
    if (typeof item !== "string") continue;
    if ((ALLOWED_WINDOWS as readonly string[]).includes(item)) unique.add(item as SummaryWindow);
  }
  return unique.size > 0 ? Array.from(unique) : [...DEFAULT_WINDOWS];
}

function windowRange(summaryDate: string, window: SummaryWindow): { startDate: string; endDate: string } {
  switch (window) {
    case "daily":
      return { startDate: summaryDate, endDate: summaryDate };
    case "last_7_days":
      return { startDate: shiftIsoDate(summaryDate, -6), endDate: summaryDate };
    case "last_14_days":
      return { startDate: shiftIsoDate(summaryDate, -13), endDate: summaryDate };
    case "season_to_date":
      return { startDate: seasonStartFor(summaryDate), endDate: summaryDate };
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function outcomeKey(value: Outcome | null | undefined): Outcome {
  if (value === "hit" || value === "miss" || value === "push" || value === "pending" || value === "void") {
    return value;
  }
  return "pending";
}

async function fetchOutcomeRows(
  supabase: ReturnType<typeof createClient>,
  startDate: string,
  endDate: string,
): Promise<OutcomeRow[]> {
  const pageSize = 1000;
  let from = 0;
  const rows: OutcomeRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("mlb_prop_outcomes")
      .select("player_prop_score_id,sport,game_date,stat_type,outcome")
      .eq("sport", "MLB")
      .gte("game_date", startDate)
      .lte("game_date", endDate)
      .order("game_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to fetch mlb_prop_outcomes: ${error.message}`);
    const batch = (data ?? []) as OutcomeRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function fetchScoreMetaByIds(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
): Promise<Map<string, ScoreMetaRow>> {
  const map = new Map<string, ScoreMetaRow>();
  if (ids.length === 0) return map;

  const chunkSize = 500;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("player_prop_scores")
      .select("id,confidence_tier,summary_json")
      .in("id", slice);
    if (error) throw new Error(`Failed to fetch player_prop_scores metadata: ${error.message}`);
    for (const row of (data ?? []) as ScoreMetaRow[]) {
      map.set(row.id, row);
    }
  }

  return map;
}

function buildSummaryRow(
  rows: Array<OutcomeRow & { confidence_tier: string; line_quality_tier: string }>,
  summaryDate: string,
  summaryWindow: SummaryWindow,
  groupType: SummaryRow["group_type"],
  groupKey: string,
  windowStart: string,
  windowEnd: string,
  generatedAt: string,
): SummaryRow {
  let hitCount = 0;
  let missCount = 0;
  let pushCount = 0;
  let pendingCount = 0;
  let voidCount = 0;

  for (const row of rows) {
    const outcome = outcomeKey(row.outcome);
    if (outcome === "hit") hitCount++;
    else if (outcome === "miss") missCount++;
    else if (outcome === "push") pushCount++;
    else if (outcome === "void") voidCount++;
    else pendingCount++;
  }

  const gradedCount = hitCount + missCount + pushCount + voidCount;
  const hitRateDenominator = hitCount + missCount;
  const pushAdjustedDenominator = hitCount + missCount + pushCount;

  return {
    sport: "MLB",
    summary_date: summaryDate,
    summary_window: summaryWindow,
    group_type: groupType,
    group_key: groupKey,
    total_count: rows.length,
    graded_count: gradedCount,
    hit_count: hitCount,
    miss_count: missCount,
    push_count: pushCount,
    pending_count: pendingCount,
    void_count: voidCount,
    hit_rate: hitRateDenominator > 0 ? round4(hitCount / hitRateDenominator) : null,
    push_adjusted_hit_rate: pushAdjustedDenominator > 0 ? round4(hitCount / pushAdjustedDenominator) : null,
    metadata: {
      window_start: windowStart,
      window_end: windowEnd,
      source_table: "mlb_prop_outcomes",
      score_metadata_source: "player_prop_scores",
    },
    generated_at: generatedAt,
  };
}

function buildGroupedSummaries(
  rows: Array<OutcomeRow & { confidence_tier: string; line_quality_tier: string }>,
  summaryDate: string,
  summaryWindow: SummaryWindow,
  windowStart: string,
  windowEnd: string,
  generatedAt: string,
): SummaryRow[] {
  const summaries: SummaryRow[] = [];

  summaries.push(
    buildSummaryRow(rows, summaryDate, summaryWindow, "overall", "ALL", windowStart, windowEnd, generatedAt),
  );

  const statTypeGroups = new Map<string, Array<OutcomeRow & { confidence_tier: string; line_quality_tier: string }>>();
  const confidenceTierGroups = new Map<string, Array<OutcomeRow & { confidence_tier: string; line_quality_tier: string }>>();
  const lineQualityGroups = new Map<string, Array<OutcomeRow & { confidence_tier: string; line_quality_tier: string }>>();

  for (const row of rows) {
    const statTypeKey = row.stat_type?.trim() || "unknown";
    const confidenceKey = row.confidence_tier || "unknown";
    const lineQualityKey = row.line_quality_tier || "unknown";

    if (!statTypeGroups.has(statTypeKey)) statTypeGroups.set(statTypeKey, []);
    statTypeGroups.get(statTypeKey)!.push(row);

    if (!confidenceTierGroups.has(confidenceKey)) confidenceTierGroups.set(confidenceKey, []);
    confidenceTierGroups.get(confidenceKey)!.push(row);

    if (!lineQualityGroups.has(lineQualityKey)) lineQualityGroups.set(lineQualityKey, []);
    lineQualityGroups.get(lineQualityKey)!.push(row);
  }

  for (const [groupKey, groupRows] of statTypeGroups) {
    summaries.push(
      buildSummaryRow(groupRows, summaryDate, summaryWindow, "stat_type", groupKey, windowStart, windowEnd, generatedAt),
    );
  }

  for (const [groupKey, groupRows] of confidenceTierGroups) {
    summaries.push(
      buildSummaryRow(
        groupRows,
        summaryDate,
        summaryWindow,
        "confidence_tier",
        groupKey,
        windowStart,
        windowEnd,
        generatedAt,
      ),
    );
  }

  for (const [groupKey, groupRows] of lineQualityGroups) {
    summaries.push(
      buildSummaryRow(
        groupRows,
        summaryDate,
        summaryWindow,
        "line_quality_tier",
        groupKey,
        windowStart,
        windowEnd,
        generatedAt,
      ),
    );
  }

  return summaries;
}

async function logHealth(
  supabase: ReturnType<typeof createClient>,
  payload: {
    status: "success" | "failed";
    started_at: string;
    finished_at: string;
    duration_ms: number;
    rows_inserted: number;
    rows_updated: number;
    metadata: Record<string, unknown>;
    error_message?: string | null;
  },
) {
  try {
    await supabase.from("mlb_refresh_health").insert({
      job_name: "summarize-mlb-performance",
      status: payload.status,
      started_at: payload.started_at,
      finished_at: payload.finished_at,
      duration_ms: payload.duration_ms,
      rows_inserted: payload.rows_inserted,
      rows_updated: payload.rows_updated,
      metadata: payload.metadata,
      error_message: payload.error_message ?? null,
    });
  } catch (e) {
    console.error("[summarize-mlb-performance] failed to write health row", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: { summary_date?: string; windows?: string[]; dry_run?: boolean } = {};
    try {
      body = await req.json();
    } catch (_) {
      // allow empty body
    }

    const summaryDate = body.summary_date || todayET();
    const windows = normalizeWindows(body.windows);
    const dryRun = body.dry_run ?? true;
    const generatedAt = new Date().toISOString();
    const earliestStart = windows
      .map((window) => windowRange(summaryDate, window).startDate)
      .sort()[0];

    const outcomes = await fetchOutcomeRows(supabase, earliestStart, summaryDate);
    const scoreMetaById = await fetchScoreMetaByIds(
      supabase,
      [...new Set(outcomes.map((row) => row.player_prop_score_id).filter(Boolean))],
    );

    const enriched = outcomes.map((row) => {
      const meta = scoreMetaById.get(row.player_prop_score_id);
      const summaryJson = (meta?.summary_json ?? {}) as Record<string, unknown>;
      const lineQualityTier =
        typeof summaryJson.line_quality_tier === "string" && summaryJson.line_quality_tier.trim().length > 0
          ? summaryJson.line_quality_tier.trim()
          : "unknown";
      const confidenceTier =
        typeof meta?.confidence_tier === "string" && meta.confidence_tier.trim().length > 0
          ? meta.confidence_tier.trim()
          : "unknown";
      return {
        ...row,
        confidence_tier: confidenceTier,
        line_quality_tier: lineQualityTier,
      };
    });

    const summaries: SummaryRow[] = [];
    for (const window of windows) {
      const { startDate, endDate } = windowRange(summaryDate, window);
      const windowRows = enriched.filter((row) => row.game_date >= startDate && row.game_date <= endDate);
      summaries.push(...buildGroupedSummaries(windowRows, summaryDate, window, startDate, endDate, generatedAt));
    }

    if (!dryRun && summaries.length > 0) {
      const chunkSize = 250;
      for (let i = 0; i < summaries.length; i += chunkSize) {
        const slice = summaries.slice(i, i + chunkSize);
        const { error } = await supabase.from("mlb_performance_summaries").upsert(slice, {
          onConflict: "sport,summary_date,summary_window,group_type,group_key",
        });
        if (error) throw new Error(`Failed to upsert mlb_performance_summaries: ${error.message}`);
      }
    }

    const overallRecords = summaries
      .filter((row) => row.group_type === "overall")
      .map((row) => ({
        summary_window: row.summary_window,
        total_count: row.total_count,
        graded_count: row.graded_count,
        hit_count: row.hit_count,
        miss_count: row.miss_count,
        push_count: row.push_count,
        pending_count: row.pending_count,
        hit_rate: row.hit_rate,
        push_adjusted_hit_rate: row.push_adjusted_hit_rate,
      }));

    const finishedAt = new Date();
    const metadata = {
      dry_run: dryRun,
      summary_date: summaryDate,
      windows,
      summaries_generated: summaries.length,
      overall_records: overallRecords,
      errors: [],
      season_start_assumption: seasonStartFor(summaryDate),
    };

    await logHealth(supabase, {
      status: "success",
      started_at: startedAtIso,
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      rows_inserted: dryRun ? 0 : summaries.length,
      rows_updated: 0,
      metadata,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        summary_date: summaryDate,
        windows,
        summaries_generated: summaries.length,
        summaries,
        errors: [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[summarize-mlb-performance] fatal error", e);
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const finishedAt = new Date();
        await logHealth(supabase, {
          status: "failed",
          started_at: startedAtIso,
          finished_at: finishedAt.toISOString(),
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
          rows_inserted: 0,
          rows_updated: 0,
          metadata: { errors: [e instanceof Error ? e.message : String(e)] },
          error_message: e instanceof Error ? e.message : String(e),
        });
      }
    } catch (logErr) {
      console.error("[summarize-mlb-performance] failed to write fatal health row", logErr);
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
