import { BarChart3, BookOpen, CheckCircle2, ShieldCheck, TrendingUp, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { MarketDepthData } from "@/hooks/useAIBetBuilder";

interface Props {
  data: MarketDepthData;
}

function StatCell({ label, value, icon: Icon, color }: { label: string; value: string | number; icon?: typeof BarChart3; color?: string }) {
  return (
    <div className="text-center space-y-0.5">
      <div className={`text-sm font-bold ${color || "text-foreground"} flex items-center justify-center gap-1`}>
        {Icon && <Icon className="h-3 w-3" />}
        {value}
      </div>
      <div className="text-[9px] text-muted-foreground leading-tight">{label}</div>
    </div>
  );
}

function DistributionBar({ distribution, label, colorFn }: {
  distribution: Record<string, number>;
  label: string;
  colorFn: (key: string) => string;
}) {
  const entries = Object.entries(distribution).sort(([a], [b]) => a.localeCompare(b));
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="flex rounded-full overflow-hidden h-2 bg-muted/30">
        {entries.map(([key, count]) => {
          const pct = (count / total) * 100;
          if (pct < 1) return null;
          return (
            <div
              key={key}
              className={`${colorFn(key)} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${key}: ${count} (${Math.round(pct)}%)`}
            />
          );
        })}
      </div>
      <div className="flex gap-2 flex-wrap">
        {entries.map(([key, count]) => (
          <span key={key} className="text-[8px] text-muted-foreground">
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-0.5 ${colorFn(key)}`} />
            {key}: {count}
          </span>
        ))}
      </div>
    </div>
  );
}

function booksColor(key: string): string {
  const n = parseInt(key);
  if (n >= 4) return "bg-green-500";
  if (n >= 3) return "bg-emerald-500";
  if (n >= 2) return "bg-yellow-500";
  return "bg-red-500";
}

function confidenceColor(key: string): string {
  const n = parseInt(key);
  if (n >= 70) return "bg-green-500";
  if (n >= 50) return "bg-emerald-500";
  if (n >= 30) return "bg-yellow-500";
  return "bg-red-500";
}

export function MarketDepthSummary({ data }: Props) {
  const mq = data.market_quality;
  const totalFiltered = mq
    ? (mq.removed_by_verified_only + mq.removed_by_main_lines_only + mq.removed_by_min_books + mq.removed_by_min_confidence + mq.removed_by_single_book_exclude)
    : 0;

  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardContent className="pt-4 pb-3 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-primary">Market Depth Summary</span>
          <span className="text-[9px] text-muted-foreground ml-auto font-mono">
            {data.mode === "verified_market_first" ? "✓ Verified-first" : data.mode}
          </span>
        </div>

        {/* Key metrics grid */}
        <div className="grid grid-cols-4 gap-2">
          <StatCell label="Live Props" value={data.live_props_found} icon={BookOpen} color="text-primary" />
          <StatCell label="Verified" value={data.verified_prop_candidates} icon={CheckCircle2} color="text-green-400" />
          <StatCell label="Sent to AI" value={data.verified_candidates_passed_to_llm} icon={TrendingUp} color="text-blue-400" />
          <StatCell label="Games" value={data.games_today} icon={BarChart3} />
        </div>

        {/* Market quality filter funnel */}
        {mq && (
          <div className="bg-card/50 rounded-lg p-2.5 space-y-2 border border-border/20">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Quality Filter Funnel</span>
              <span className="text-[9px] text-muted-foreground">
                {mq.before_market_filters} → {mq.after_market_filters}
              </span>
            </div>

            <div className="space-y-1">
              {mq.removed_by_verified_only > 0 && (
                <FilterRow label="Unverified removed" count={mq.removed_by_verified_only} />
              )}
              {mq.removed_by_main_lines_only > 0 && (
                <FilterRow label="Alt lines removed" count={mq.removed_by_main_lines_only} />
              )}
              {mq.removed_by_min_books > 0 && (
                <FilterRow label="Below min books" count={mq.removed_by_min_books} />
              )}
              {mq.removed_by_min_confidence > 0 && (
                <FilterRow label="Below min confidence" count={mq.removed_by_min_confidence} />
              )}
              {mq.removed_by_single_book_exclude > 0 && (
                <FilterRow label="Single-book excluded" count={mq.removed_by_single_book_exclude} />
              )}
              {totalFiltered === 0 && (
                <div className="flex items-center gap-1.5 text-[10px] text-green-400">
                  <CheckCircle2 className="h-3 w-3" />
                  All candidates passed quality filters
                </div>
              )}
            </div>

            {/* Distributions */}
            {mq.books_count_distribution && Object.keys(mq.books_count_distribution).length > 0 && (
              <DistributionBar
                distribution={mq.books_count_distribution}
                label="Books Count Distribution"
                colorFn={booksColor}
              />
            )}
            {mq.market_confidence_distribution && Object.keys(mq.market_confidence_distribution).length > 0 && (
              <DistributionBar
                distribution={mq.market_confidence_distribution}
                label="Market Confidence Distribution"
                colorFn={confidenceColor}
              />
            )}
          </div>
        )}

        {/* Leg validation summary */}
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1 text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            {data.final_legs_accepted} legs accepted
          </span>
          {data.final_legs_rejected_no_match > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <XCircle className="h-3 w-3" />
              {data.final_legs_rejected_no_match} rejected (no match)
            </span>
          )}
          <span className="text-muted-foreground ml-auto">
            {data.unique_players} players • {data.scoring_data_available} scored
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-red-400/80">-{count}</span>
    </div>
  );
}
