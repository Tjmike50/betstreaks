import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { errors, metrics, operators } from "../../../supabase/functions/_shared/analyticsAssistant/contract";
import { formatPrice, formatStamp } from "./client";
import type { Quote, Research } from "../../../supabase/functions/_shared/nbaWorkflow/domain";

export function QuoteList({ quotes }: { quotes: Quote[] }) {
  if (!quotes.length) return <p className="text-sm text-muted-foreground">No quotes in this snapshot.</p>;
  return (
    <ul className="divide-y divide-border">
      {quotes.map((quote) => (
        <li key={JSON.stringify([quote.book, quote.line])} className="flex items-start justify-between gap-3 py-2.5">
          <div>
            <p className="text-sm font-medium">{quote.book}{!quote.main && " · Alternate"}</p>
            <p className="text-xs text-muted-foreground">{formatStamp(quote.observedAt)}</p>
          </div>
          <p className="font-mono text-sm tabular-nums">{quote.line} <span className="text-muted-foreground">({formatPrice(quote.price)})</span></p>
        </li>
      ))}
    </ul>
  );
}

export function ResearchEvidence({ result }: { result: Research }) {
  const evidence = result.evidence;
  const calculation = evidence?.status === "answer" ? evidence.calculation : undefined;
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-label="Research evidence">
      {evidence && (
        <Card className="sm:col-span-2">
          <CardContent className="space-y-3 p-4">
            <h3 className="font-semibold">Game log</h3>
            {calculation?.kind === "count" && (
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="text-2xl font-semibold text-primary">{calculation.hits}/{calculation.denominator}</span>
                <span>{metrics[result.plan.metric].label} {operators[calculation.comparator]} {calculation.threshold}</span>
                <span className="text-muted-foreground">{calculation.denominator - calculation.hits - calculation.pushes} misses · {calculation.pushes} pushes</span>
              </p>
            )}
            {evidence.status === "error" && <p role="status" className="text-sm text-muted-foreground">{errors[evidence.code]}</p>}
            {evidence.status !== "clarification" && evidence.provenance && (
              <p className="text-xs text-muted-foreground">
                Data through {evidence.provenance.coverageThrough} ET · {evidence.provenance.source}
                {evidence.query && <> · Games through {evidence.query.asOf}</>}
              </p>
            )}
            {evidence.status !== "clarification" && !!evidence.evidence?.length && (
              <details className="rounded-md border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm">View {evidence.evidence.length} appearances</summary>
                <table className="mt-2 w-full text-left text-sm">
                  <thead><tr className="text-muted-foreground"><th className="font-medium">Date</th><th className="text-right font-medium">{metrics[result.plan.metric].label}</th></tr></thead>
                  <tbody>
                    {evidence.evidence.map((row) => <tr className="border-t border-border" key={row.gameId}><td className="py-1">{row.date}</td><td className="text-right tabular-nums">{row.value ?? "Unknown"}</td></tr>)}
                  </tbody>
                </table>
              </details>
            )}
          </CardContent>
        </Card>
      )}
      {result.score !== undefined && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h3 className="font-semibold">Score breakdown</h3>
            {result.score ? (
              <>
                <p><span className="text-xl font-semibold">{result.score.value}</span> <span className="text-xs text-muted-foreground">BetStreaks score · {formatStamp(result.score.asOf)}</span></p>
                <ul className="divide-y divide-border text-sm">
                  {result.score.factors.map((factor) => (
                    <li key={factor.label} className="flex justify-between gap-3 py-1.5"><span>{factor.label}</span><span className="font-mono">{factor.contribution > 0 ? "+" : ""}{factor.contribution}</span></li>
                  ))}
                </ul>
                {!!result.score.missing.length && <p className="text-xs text-muted-foreground">Missing inputs · {result.score.missing.join(", ")}</p>}
              </>
            ) : <p className="text-sm text-muted-foreground">No score factors available for this market.</p>}
          </CardContent>
        </Card>
      )}
      {result.availability !== undefined && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h3 className="font-semibold">Player availability</h3>
            {result.availability ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="capitalize">{result.availability.status}</Badge>
                <span className="text-xs text-muted-foreground">{formatStamp(result.availability.observedAt)}</span>
              </div>
            ) : <p className="text-sm text-muted-foreground">Availability is unverified.</p>}
          </CardContent>
        </Card>
      )}
      {result.quotes && (
        <Card className="sm:col-span-2">
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
            <div><h3 className="font-semibold">Latest quotes</h3><QuoteList quotes={result.quotes.current} /></div>
            <div><h3 className="font-semibold">Earlier quotes</h3><QuoteList quotes={result.quotes.previous} /></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
