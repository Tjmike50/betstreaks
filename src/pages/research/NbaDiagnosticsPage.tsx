import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { callWorkflow, formatStamp } from "@/components/nba-workflow/client";
import type { Board } from "../../../supabase/functions/_shared/nbaWorkflow/domain";

type Diagnostics = {
  source: Board["snapshot"]; asOf: string; markets: number; quotes: number; freshQuotes: number;
  scoringCoverage: number; availabilityCoverage: number; finalMarkets: number; modelConfigured: boolean; pushConfigured: boolean;
  feedback: { reference: string; reason: string; created_at: string }[];
};

export default function NbaDiagnosticsPage() {
  const { user } = useAuth();
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["nba-research-diagnostics", user?.id],
    queryFn: async () => (await callWorkflow<Diagnostics>({ action: "diagnostics" })).data,
    retry: false,
    enabled: !!user,
  });
  const rows = data ? [
    ["Mode", data.source.mode], ["Source", data.source.source], ["Revision", data.source.revision],
    ["Board observed", formatStamp(data.asOf)], ["Game logs through (ET)", data.source.coverageThrough],
    ["Markets", data.markets], ["Quotes within freshness window", `${data.freshQuotes}/${data.quotes}`],
    ["Scores", `${data.scoringCoverage}/${data.markets}`], ["Availability records", `${data.availabilityCoverage}/${data.markets}`],
    ["Final markets", data.finalMarkets], ["Google Gemini", data.modelConfigured ? "Configured" : "Research rules only"],
    ["Push", data.pushConfigured ? "Configured" : "In-app only"],
  ] : [];
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-5 pb-24">
      <Link className="text-sm text-muted-foreground underline" to="/research/nba">NBA Research</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">NBA research diagnostics</h1>
        {user && <Button variant="outline" size="sm" onClick={() => void refetch()}>Refresh</Button>}
      </div>
      {!user && <Button asChild><Link to="/auth?next=nba">Sign in</Link></Button>}
      {user && isPending && <p role="status">Checking snapshot…</p>}
      {error && <p role="alert" className="text-destructive">{error.message}</p>}
      {!!rows.length && <Card><CardContent className="p-4"><dl className="divide-y divide-border text-sm">
        {rows.map(([label, value]) => <div className="flex flex-wrap items-start justify-between gap-2 py-2" key={label}>
          <dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd>
        </div>)}
      </dl></CardContent></Card>}
      {data && <Card><CardContent className="space-y-2 p-4">
        <h2 className="font-semibold">Recent data reports</h2>
        {data.feedback.length ? <ul className="divide-y divide-border">
          {data.feedback.map((entry, index) => <li key={`${entry.reference}:${index}`} className="py-2 text-sm">
            <p className="capitalize">{entry.reason} · {formatStamp(entry.created_at)}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{entry.reference}</p>
          </li>)}
        </ul> : <p className="text-sm text-muted-foreground">No reports yet.</p>}
      </CardContent></Card>}
    </div>
  );
}
