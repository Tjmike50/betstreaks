import { useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Bookmark,
  Brain,
  CheckCircle2,
  Clock,
  CreditCard,
  Database,
  Loader2,
  Shield,
  Terminal,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/hooks/useAdmin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type HealthStatus = "green" | "yellow" | "red";
type JsonRecord = Record<string, unknown>;

const NBA_LINE_STATS = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_blocks",
  "player_steals",
  "PTS",
  "REB",
  "AST",
  "3PM",
  "FG3M",
  "BLK",
  "STL",
  "pts",
  "reb",
  "ast",
  "fg3m",
  "blk",
  "stl",
];

const MLB_LINE_STATS = [
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "pitcher_strikeouts",
  "pitcher_earned_runs",
  "pitcher_walks",
  "pitcher_hits_allowed",
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not available";
  return value.includes("T") ? new Date(value).toLocaleString() : value;
}

function ageHours(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return (Date.now() - parsed.getTime()) / 36e5;
}

function asDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function latestTimestamp(...values: Array<string | null | undefined>) {
  const valid = values
    .map(asDate)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime());
  return valid[0] ?? null;
}

function statusClasses(status: HealthStatus) {
  if (status === "green") return "border-emerald-500/30 bg-emerald-500/5 text-emerald-500";
  if (status === "yellow") return "border-amber-500/30 bg-amber-500/5 text-amber-500";
  return "border-red-500/30 bg-red-500/5 text-red-500";
}

function statusLabel(status: HealthStatus) {
  if (status === "green") return "Green";
  if (status === "yellow") return "Yellow";
  return "Red";
}

function metadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as JsonRecord)[key];
  return value == null ? null : String(value);
}

async function safeQuery<T>(label: string, fn: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await fn(), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? `${label}: ${error.message}` : `${label}: Not available` };
  }
}

async function requireOk<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function HealthCard({
  title,
  icon: Icon,
  status,
  summary,
  rows,
  error,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  status: HealthStatus;
  summary: string;
  rows: Array<{ label: string; value: ReactNode }>;
  error?: string | null;
}) {
  return (
    <Card className={status === "green" ? "border-border" : statusClasses(status)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <Badge variant="outline" className={statusClasses(status)}>
            {statusLabel(status)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{summary}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="max-w-[60%] text-right font-medium break-words">{row.value}</span>
          </div>
        ))}
        {error && (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-500">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminHealthPage() {
  const { isAdmin, isLoading: adminLoading } = useAdmin();
  const navigate = useNavigate();
  const today = useMemo(todayIso, []);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-system-health", today],
    enabled: isAdmin,
    staleTime: 60_000,
    queryFn: async () => {
      const latestGames = async (sport: "NBA" | "MLB") => {
        const row = await requireOk(await supabase.from("games_today").select("game_date, updated_at").eq("sport", sport).order("game_date", { ascending: false }).limit(1).maybeSingle());
        const latestDate = row?.game_date ?? null;
        const activeCount = latestDate
          ? (await supabase.from("games_today").select("id", { count: "exact", head: true }).eq("sport", sport).eq("game_date", latestDate).eq("is_active", true)).count ?? 0
          : null;
        return { latestDate, updatedAt: row?.updated_at ?? null, activeCount };
      };

      const latestLineStats = async (stats: string[]) => {
        const row = await requireOk(await supabase.from("line_snapshots").select("game_date, snapshot_at").in("stat_type", stats).order("game_date", { ascending: false }).limit(1).maybeSingle());
        const latestDate = row?.game_date ?? null;
        const count = latestDate
          ? (await supabase.from("line_snapshots").select("id", { count: "exact", head: true }).eq("game_date", latestDate).in("stat_type", stats)).count ?? 0
          : 0;
        return { latestDate, snapshotAt: row?.snapshot_at ?? null, count };
      };

      const latestScores = async (sport: "NBA" | "MLB") => {
        const row = await requireOk(await supabase.from("player_prop_scores").select("game_date, scored_at").eq("sport", sport).order("game_date", { ascending: false }).limit(1).maybeSingle());
        const latestDate = row?.game_date ?? null;
        const count = latestDate
          ? (await supabase.from("player_prop_scores").select("id", { count: "exact", head: true }).eq("sport", sport).eq("game_date", latestDate)).count ?? 0
          : 0;
        const candidates = latestDate
          ? (await supabase
              .from("player_prop_scores")
              .select("id", { count: "exact", head: true })
              .eq("sport", sport)
              .eq("game_date", latestDate)
              .gte("score_overall", sport === "MLB" ? 50 : 45)).count ?? 0
          : 0;
        return { latestDate, scoredAt: row?.scored_at ?? null, count, candidates };
      };

      const [
        nbaGames,
        mlbGames,
        nbaLines,
        mlbLines,
        nbaScores,
        mlbScores,
        quotaAlerts,
        providerWarnings,
        collectAlerts,
        mlbHealthRows,
        pipelineRows,
        nullMlbTeams,
        nullMlbCanonical,
        unresolvedPlayers,
        aiSlips,
        aiAlerts,
        stripeLatest,
        stripeActive,
        stripeAlerts,
        savedSlips,
        securityProbe,
      ] = await Promise.all([
        safeQuery("NBA games_today", () => latestGames("NBA")),
        safeQuery("MLB games_today", () => latestGames("MLB")),
        safeQuery("NBA line_snapshots", () => latestLineStats(NBA_LINE_STATS)),
        safeQuery("MLB line_snapshots", async () => {
          const base = await latestLineStats(MLB_LINE_STATS);
          const rows = base.latestDate
            ? await requireOk(await supabase.from("line_snapshots").select("stat_type").eq("game_date", base.latestDate).in("stat_type", MLB_LINE_STATS).limit(5000))
            : [];
          const byStat: Record<string, number> = {};
          for (const row of rows ?? []) byStat[row.stat_type] = (byStat[row.stat_type] ?? 0) + 1;
          return { ...base, byStat };
        }),
        safeQuery("NBA player_prop_scores", () => latestScores("NBA")),
        safeQuery("MLB player_prop_scores", () => latestScores("MLB")),
        safeQuery("quota backend_alerts", async () => requireOk(await supabase.from("backend_alerts").select("*").eq("alert_type", "odds_api_quota_exhausted").order("created_at", { ascending: false }).limit(5))),
        safeQuery("provider backend_alerts", async () => requireOk(await supabase.from("backend_alerts").select("*").or("alert_type.ilike.%provider%,alert_type.ilike.%odds%").order("created_at", { ascending: false }).limit(10))),
        safeQuery("collect-line-snapshots diagnostics", async () => requireOk(await supabase.from("backend_alerts").select("*").or("alert_type.ilike.%collect%,alert_type.ilike.%line%").order("created_at", { ascending: false }).limit(5))),
        safeQuery("mlb_refresh_health", async () => requireOk(await supabase.from("mlb_refresh_health").select("*").order("started_at", { ascending: false }).limit(5))),
        safeQuery("pipeline_runs", async () => requireOk(await supabase.from("pipeline_runs").select("*").order("ran_at", { ascending: false }).limit(5))),
        safeQuery("MLB null team_abbr games", async () => (await supabase.from("games_today").select("id", { count: "exact", head: true }).eq("sport", "MLB").eq("is_active", true).or("home_team_abbr.is.null,away_team_abbr.is.null")).count ?? 0),
        safeQuery("MLB null canonical games", async () => (await supabase.from("games_today").select("id", { count: "exact", head: true }).eq("sport", "MLB").eq("is_active", true).is("canonical_game_key", null)).count ?? 0),
        safeQuery("mlb_unresolved_players", async () => {
          const rows = await requireOk(await supabase.from("mlb_unresolved_players").select("resolution_status").limit(1000));
          return (rows ?? []).filter((row) => row.resolution_status !== "resolved").length;
        }),
        safeQuery("ai_slips", async () => {
          const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const rows = await requireOk(await supabase.from("ai_slips").select("sport, created_at").gte("created_at", since).limit(1000));
          return (rows ?? []).reduce<Record<string, number>>((acc, row) => {
            acc[row.sport || "unknown"] = (acc[row.sport || "unknown"] ?? 0) + 1;
            return acc;
          }, {});
        }),
        safeQuery("AI backend_alerts", async () => requireOk(await supabase.from("backend_alerts").select("*").or("alert_type.ilike.%candidate%,alert_type.ilike.%quota%,message.ilike.%candidate%").order("created_at", { ascending: false }).limit(5))),
        safeQuery("stripe_subscriptions latest", async () => requireOk(await supabase.from("stripe_subscriptions").select("updated_at, status").order("updated_at", { ascending: false }).limit(1).maybeSingle())),
        safeQuery("stripe_subscriptions active", async () => (await supabase.from("stripe_subscriptions").select("id", { count: "exact", head: true }).in("status", ["active", "trialing"])).count ?? 0),
        safeQuery("Stripe backend_alerts", async () => requireOk(await supabase.from("backend_alerts").select("*").or("alert_type.ilike.%stripe%,message.ilike.%stripe%,message.ilike.%webhook%").order("created_at", { ascending: false }).limit(5))),
        safeQuery("saved_slips", async () => {
          const latest = await requireOk(await supabase.from("saved_slips").select("created_at, sport").order("created_at", { ascending: false }).limit(1).maybeSingle());
          const count = (await supabase.from("saved_slips").select("id", { count: "exact", head: true })).count ?? 0;
          return { latest, count };
        }),
        safeQuery("admin RLS probe", async () => {
          const alertsReadable = (await supabase.from("backend_alerts").select("id", { count: "exact", head: true })).error == null;
          return { adminConfirmed: true, operationalTablesReadable: alertsReadable };
        }),
      ]);

      return {
        nbaGames,
        mlbGames,
        nbaLines,
        mlbLines,
        nbaScores,
        mlbScores,
        quotaAlerts,
        providerWarnings,
        collectAlerts,
        mlbHealthRows,
        pipelineRows,
        nullMlbTeams,
        nullMlbCanonical,
        unresolvedPlayers,
        aiSlips,
        aiAlerts,
        stripeLatest,
        stripeActive,
        stripeAlerts,
        savedSlips,
        securityProbe,
      };
    },
  });

  if (adminLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card>
          <CardContent className="space-y-3 pt-6 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
            <p className="font-semibold">Admin access required</p>
            <Button variant="outline" onClick={() => navigate("/")}>Go Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const latestQuota = data?.quotaAlerts.data?.[0] as any;
  const unresolvedQuota = (data?.quotaAlerts.data ?? []).some((alert: any) => alert.resolved !== true);
  const latestProviderWarning = (data?.providerWarnings.data ?? []).find((alert: any) => alert.alert_type !== "odds_api_quota_exhausted") as any;
  const latestMlbHealth = data?.mlbHealthRows.data?.[0] as any;
  const latestPipeline = data?.pipelineRows.data?.[0] as any;
  const latestMlbScoreRun = (data?.pipelineRows.data ?? []).find((row: any) => row.scoring_source === "score-mlb-anchors" || row.scoring_scored_count != null) as any;
  const nbaLatestDataAt = latestTimestamp(
    data?.nbaGames.data?.updatedAt,
    data?.nbaLines.data?.snapshotAt,
    data?.nbaScores.data?.scoredAt,
  );
  const mlbLatestDataAt = latestTimestamp(
    data?.mlbGames.data?.updatedAt,
    data?.mlbLines.data?.snapshotAt,
    data?.mlbScores.data?.scoredAt,
    latestMlbHealth?.finished_at ?? latestMlbHealth?.started_at,
  );
  const latestQuotaCreatedAt = asDate(latestQuota?.created_at);
  const quotaRecoveredAfterLatestAlert =
    unresolvedQuota && latestQuotaCreatedAt
      ? (
          (latestQuota?.sport === "NBA" && nbaLatestDataAt && nbaLatestDataAt > latestQuotaCreatedAt) ||
          (latestQuota?.sport === "MLB" && mlbLatestDataAt && mlbLatestDataAt > latestQuotaCreatedAt)
        )
      : false;
  const providerStatus: HealthStatus =
    unresolvedQuota
      ? (quotaRecoveredAfterLatestAlert ? "yellow" : "red")
      : latestProviderWarning
      ? "yellow"
      : "green";

  const nbaStatus: HealthStatus =
    data?.nbaGames.error || data?.nbaLines.error || data?.nbaScores.error ? "yellow"
    : unresolvedQuota && latestQuota?.sport === "NBA" && !quotaRecoveredAfterLatestAlert ? "red"
    : (data?.nbaScores.data?.count ?? 0) === 0 ? "yellow"
    : (data?.nbaLines.data?.count ?? 0) === 0 ? "yellow"
    : "green";

  const mlbStatus: HealthStatus =
    data?.mlbGames.error || data?.mlbLines.error || data?.mlbScores.error ? "yellow"
    : latestMlbHealth?.status === "failed" ? "red"
    : unresolvedQuota && latestQuota?.sport === "MLB" && !quotaRecoveredAfterLatestAlert ? "red"
    : (data?.mlbScores.data?.count ?? 0) === 0 ? "yellow"
    : (data?.nullMlbTeams.data ?? 0) > 0 || (data?.nullMlbCanonical.data ?? 0) > 0 ? "yellow"
    : "green";

  const aiStatus: HealthStatus =
    (data?.aiAlerts.data ?? []).some((alert: any) => alert.resolved !== true && alert.severity === "critical") ? "red"
    : (data?.nbaScores.data?.candidates ?? 0) + (data?.mlbScores.data?.candidates ?? 0) === 0 ? "yellow"
    : "green";

  const stripeStatus: HealthStatus =
    (data?.stripeAlerts.data ?? []).some((alert: any) => alert.resolved !== true && alert.severity === "critical") ? "red"
    : data?.stripeLatest.error ? "yellow"
    : ageHours(data?.stripeLatest.data?.updated_at) != null && (ageHours(data?.stripeLatest.data?.updated_at) ?? 0) > 72 ? "yellow"
    : "green";

  const savedSlipsStatus: HealthStatus = data?.savedSlips.error ? "yellow" : "green";
  const securityStatus: HealthStatus = data?.securityProbe.data?.operationalTablesReadable ? "green" : "yellow";

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">System Health</h1>
            <p className="text-sm text-muted-foreground">Read-only production monitoring for the 7-day watch period.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>

        {isLoading || !data ? (
          <div className="flex min-h-[240px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <HealthCard
                title="NBA Data Health"
                icon={Database}
                status={nbaStatus}
                summary="Games, line snapshots, scoring output, quota state, and AI Builder readiness."
                error={data.nbaGames.error ?? data.nbaLines.error ?? data.nbaScores.error ?? data.collectAlerts.error}
                rows={[
                  { label: "Latest games_today date", value: data.nbaGames.data?.latestDate ?? "Not available" },
                  { label: "Active games", value: data.nbaGames.data?.activeCount ?? "Not available" },
                  { label: "Latest line_snapshots", value: `${data.nbaLines.data?.latestDate ?? "Not available"} / ${data.nbaLines.data?.count ?? "Not available"}` },
                  { label: "Latest player_prop_scores", value: `${data.nbaScores.data?.latestDate ?? "Not available"} / ${data.nbaScores.data?.count ?? "Not available"}` },
                  { label: "Status note", value: (data.nbaScores.data?.count ?? 0) > 0 && (data.nbaLines.data?.count ?? 0) === 0 ? "Scored rows exist, live line snapshots missing" : "Latest slate paths aligned" },
                  { label: "Collect diagnostics", value: (data.collectAlerts.data?.[0] as any)?.created_at ? formatDate((data.collectAlerts.data?.[0] as any).created_at) : "Not available" },
                  { label: "Provider quota exhausted", value: unresolvedQuota && latestQuota?.sport === "NBA" ? (quotaRecoveredAfterLatestAlert ? "Old unresolved alert; later data exists" : "Yes") : "No unresolved NBA quota alert" },
                  { label: "Verified live candidates proxy", value: data.nbaScores.data?.candidates ?? "Not available" },
                ]}
              />

              <HealthCard
                title="MLB Data Health"
                icon={Zap}
                status={mlbStatus}
                summary="Beta pipeline coverage across schedule, odds, score rows, enrichment, and health-check history."
                error={data.mlbGames.error ?? data.mlbLines.error ?? data.mlbScores.error ?? data.mlbHealthRows.error}
                rows={[
                  { label: "Latest games_today date", value: data.mlbGames.data?.latestDate ?? "Not available" },
                  { label: "Active games", value: data.mlbGames.data?.activeCount ?? "Not available" },
                  { label: "Latest line_snapshots", value: `${data.mlbLines.data?.latestDate ?? "Not available"} / ${data.mlbLines.data?.count ?? "Not available"}` },
                  { label: "Line snapshots by type", value: Object.entries(data.mlbLines.data?.byStat ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "Not available" },
                  { label: "Latest player_prop_scores", value: `${data.mlbScores.data?.latestDate ?? "Not available"} / ${data.mlbScores.data?.count ?? "Not available"}` },
                  { label: "Status note", value: (data.mlbGames.data?.activeCount ?? 0) === 0 && (data.mlbScores.data?.count ?? 0) > 0 ? `No MLB games today; latest scored slate: ${data.mlbScores.data?.latestDate ?? "unknown"}` : "Latest MLB slate available" },
                  { label: "Null team_abbr games", value: data.nullMlbTeams.data ?? "Not available" },
                  { label: "Active null canonical games", value: data.nullMlbCanonical.data ?? "Not available" },
                  { label: "Unresolved players", value: data.unresolvedPlayers.data ?? "Not available" },
                  { label: "Latest mlb-health-check", value: latestMlbHealth ? `${latestMlbHealth.status} at ${formatDate(latestMlbHealth.finished_at ?? latestMlbHealth.started_at)}` : "Not available" },
                  { label: "Latest score-mlb-anchors proxy", value: latestMlbScoreRun ? `${latestMlbScoreRun.scoring_scored_count ?? "?"} scored at ${formatDate(latestMlbScoreRun.ran_at)}` : "Not available" },
                ]}
              />

              <HealthCard
                title="Odds Provider Health"
                icon={AlertTriangle}
                status={providerStatus}
                summary="Green means no unresolved quota/provider alerts; yellow means older provider warnings; red means unresolved quota/provider alert."
                error={data.quotaAlerts.error ?? data.providerWarnings.error}
                rows={[
                  { label: "Latest quota alert", value: latestQuota ? latestQuota.alert_type : "None" },
                  { label: "Resolved", value: latestQuota ? (latestQuota.resolved ? "Yes" : "No") : "Not applicable" },
                  { label: "Sport", value: latestQuota?.sport ?? "Not available" },
                  { label: "Created", value: formatDate(latestQuota?.created_at) },
                  { label: "Later successful data", value: unresolvedQuota ? (quotaRecoveredAfterLatestAlert ? "Yes, data arrived after alert" : "No later success detected") : "Not applicable" },
                  { label: "Skipped after stop", value: metadataValue(latestQuota?.metadata, "provider_calls_skipped_after_quota_stop") ?? "Not available" },
                ]}
              />

              <HealthCard
                title="AI Builder Health"
                icon={Brain}
                status={aiStatus}
                summary="Uses recent generated slips plus score-row readiness when no explicit no-candidate alert exists."
                error={data.aiSlips.error ?? data.aiAlerts.error}
                rows={[
                  { label: "Recent ai_slips by sport", value: Object.entries(data.aiSlips.data ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "Not available" },
                  { label: "Recent AI/no-candidate alerts", value: data.aiAlerts.data?.length ?? "Not available" },
                  { label: "NBA ready candidates", value: data.nbaScores.data?.candidates ?? "Not available" },
                  { label: "MLB ready candidates", value: data.mlbScores.data?.candidates ?? "Not available" },
                ]}
              />

              <HealthCard
                title="Stripe Webhook Health"
                icon={CreditCard}
                status={stripeStatus}
                summary="Local app-side indicators only. This page does not call Stripe or expose secrets."
                error={data.stripeLatest.error ?? data.stripeActive.error ?? data.stripeAlerts.error}
                rows={[
                  { label: "Latest subscription update", value: data.stripeLatest.data?.updated_at ? formatDate(data.stripeLatest.data.updated_at) : "Not available" },
                  { label: "Latest status", value: data.stripeLatest.data?.status ?? "Not available" },
                  { label: "Active/trialing count", value: data.stripeActive.data ?? "Not available" },
                  { label: "Webhook/backend alerts", value: data.stripeAlerts.data?.length ? `${data.stripeAlerts.data.length} recent` : "None stored locally" },
                  { label: "External check", value: "Check Stripe dashboard for latest deliveries" },
                ]}
              />

              <HealthCard
                title="Saved Slips Health"
                icon={Bookmark}
                status={savedSlipsStatus}
                summary="Read-only availability check for saved slip persistence under current RLS."
                error={data.savedSlips.error}
                rows={[
                  { label: "Readable saved rows", value: data.savedSlips.data?.count ?? "Not available" },
                  { label: "Latest saved slip", value: data.savedSlips.data?.latest?.created_at ? formatDate(data.savedSlips.data.latest.created_at) : "Not available" },
                  { label: "Latest sport", value: data.savedSlips.data?.latest?.sport ?? "Not available" },
                  { label: "RLS note", value: "May be scoped to current user unless admin SELECT policy exists" },
                ]}
              />

              <HealthCard
                title="Security / RLS"
                icon={Shield}
                status={securityStatus}
                summary="Confirms this page is admin-gated and probes admin-readable operational tables without exposing raw provider payloads."
                error={data.securityProbe.error}
                rows={[
                  { label: "Admin route guard", value: data.securityProbe.data?.adminConfirmed ? "Confirmed" : "Not available" },
                  { label: "Operational tables readable", value: data.securityProbe.data?.operationalTablesReadable ? "Yes, as admin" : "Not available" },
                  { label: "Raw odds responses", value: "Not queried" },
                  { label: "Secrets/API keys", value: "Not exposed" },
                ]}
              />

              <HealthCard
                title="Pipeline Snapshot"
                icon={CheckCircle2}
                status={latestPipeline?.success === false ? "red" : latestPipeline ? "green" : "yellow"}
                summary="Latest daily pipeline run from pipeline_runs."
                error={data.pipelineRows.error}
                rows={[
                  { label: "Latest run", value: latestPipeline ? formatDate(latestPipeline.ran_at) : "Not available" },
                  { label: "Success", value: latestPipeline ? (latestPipeline.success ? "Yes" : "No") : "Not available" },
                  { label: "Line snapshots", value: latestPipeline?.line_new_snapshots ?? "Not available" },
                  { label: "Scored count", value: latestPipeline?.scoring_scored_count ?? "Not available" },
                  { label: "Errors", value: latestPipeline?.errors?.length ? latestPipeline.errors.join("; ") : "None" },
                ]}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Terminal className="h-4 w-4 text-primary" />
                  Admin Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>No write buttons were added here. Existing admin/eval already wires pipeline-style mutations, and this health page stays read-only for production monitoring.</p>
                <div className="rounded-md bg-muted p-3 font-mono text-xs text-foreground">
                  {`curl -X POST "$SUPABASE_URL/functions/v1/collect-line-snapshots" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{"sport":"NBA"}'`}
                  <br />
                  {`curl -X POST "$SUPABASE_URL/functions/v1/mlb-health-check" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{"game_date":"${today}"}'`}
                  <br />
                  {`update public.backend_alerts set resolved = true where alert_type = 'odds_api_quota_exhausted' and sport = 'NBA' and resolved is distinct from true;`}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
