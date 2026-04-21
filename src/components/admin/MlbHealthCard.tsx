// =============================================================================
// MlbHealthCard — lightweight MLB pipeline health card for admin surface.
// Shows last refresh, scored row counts, candidate counts, warnings.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, Clock, Database } from "lucide-react";

function hoursAgo(d: Date | null): string {
  if (!d) return "never";
  const h = (Date.now() - d.getTime()) / (1000 * 60 * 60);
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  return `${h.toFixed(1)}h ago`;
}

export function MlbHealthCard() {
  const todayStr = new Date().toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ["mlb-health", todayStr],
    queryFn: async () => {
      // 1) Last MLB refresh (refresh_status id=5 if exists, else check scored_at)
      const { data: scores } = await supabase
        .from("player_prop_scores")
        .select("id, scored_at, stat_type, score_overall, confidence_tier, team_abbr, opponent_abbr")
        .eq("sport", "MLB")
        .eq("game_date", todayStr)
        .limit(1000);

      const rows = scores ?? [];
      const totalScored = rows.length;
      const nonPass = rows.filter((r: any) => r.score_overall != null && r.score_overall >= 45).length;
      const withTeam = rows.filter((r: any) => r.team_abbr).length;
      const withOpp = rows.filter((r: any) => r.opponent_abbr).length;
      const eliteStrong = rows.filter((r: any) => r.confidence_tier === "elite" || r.confidence_tier === "strong").length;

      // Latest scored_at as proxy for last scoring run
      const latestScoredAt = rows.length > 0
        ? new Date(rows.reduce((max: string, r: any) => r.scored_at > max ? r.scored_at : max, rows[0].scored_at))
        : null;

      // Per-stat breakdown
      const statCounts: Record<string, number> = {};
      for (const r of rows) {
        const s = (r as any).stat_type;
        statCounts[s] = (statCounts[s] || 0) + 1;
      }

      // 2) Today's MLB games
      const { data: games } = await supabase
        .from("games_today")
        .select("id")
        .eq("sport", "MLB")
        .eq("game_date", todayStr);

      // 3) Today's line snapshots for MLB
      const { count: lineCount } = await supabase
        .from("line_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("game_date", todayStr);
      // We can't easily filter line_snapshots by sport, but MLB lines use stat_types
      // like HITS, TOTAL_BASES, STRIKEOUTS etc.

      // 4) Daily pick for today
      const { data: dailyPick } = await supabase
        .from("ai_daily_picks")
        .select("id, slip_name, sport")
        .eq("sport", "MLB")
        .eq("pick_date", todayStr)
        .limit(1);

      return {
        totalScored,
        nonPass,
        withTeam,
        withOpp,
        eliteStrong,
        latestScoredAt,
        statCounts,
        gamesCount: games?.length ?? 0,
        lineSnapshots: lineCount ?? 0,
        hasDailyPick: (dailyPick?.length ?? 0) > 0,
      };
    },
    staleTime: 60_000,
  });

  if (isLoading || !data) return null;

  const warnings: string[] = [];
  if (data.totalScored === 0) warnings.push("No MLB scored rows today");
  if (data.gamesCount === 0) warnings.push("No MLB games in games_today");
  if (data.withTeam === 0 && data.totalScored > 0) warnings.push("No team_abbr on scored rows");
  if (data.eliteStrong === 0 && data.totalScored > 5) warnings.push("No elite/strong candidates");
  if (!data.hasDailyPick && data.totalScored > 0) warnings.push("No MLB Daily Pick generated");

  const healthy = warnings.length === 0 && data.totalScored > 0;

  return (
    <Card className={warnings.length > 0 ? "border-amber-500/30" : "border-border"}>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            MLB Health
          </h3>
          <Badge variant={healthy ? "default" : "outline"} className="text-[10px]">
            {healthy ? "✅ Healthy" : data.totalScored === 0 ? "⚪ No Data" : "⚠️ Issues"}
          </Badge>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold text-foreground">{data.totalScored}</div>
            <div className="text-[10px] text-muted-foreground">Scored</div>
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">{data.nonPass}</div>
            <div className="text-[10px] text-muted-foreground">Non-pass</div>
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">{data.eliteStrong}</div>
            <div className="text-[10px] text-muted-foreground">Elite/Strong</div>
          </div>
        </div>

        {/* Timing */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Last scored: {hoursAgo(data.latestScoredAt)}</span>
          <span>·</span>
          <span>{data.gamesCount} games</span>
          <span>·</span>
          <span>Daily Pick: {data.hasDailyPick ? "✓" : "✗"}</span>
        </div>

        {/* Per-stat breakdown */}
        {Object.keys(data.statCounts).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(data.statCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([stat, count]) => (
                <Badge key={stat} variant="outline" className="text-[10px]">
                  {stat}: {count}
                </Badge>
              ))}
          </div>
        )}

        {/* Team enrichment */}
        {data.totalScored > 0 && (
          <div className="text-[10px] text-muted-foreground">
            Team enrichment: {data.withTeam}/{data.totalScored} team_abbr · {data.withOpp}/{data.totalScored} opponent_abbr
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-border/30">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {w}
              </div>
            ))}
          </div>
        )}

        {healthy && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle className="h-3 w-3" />
            All MLB surfaces healthy
          </div>
        )}
      </CardContent>
    </Card>
  );
}
