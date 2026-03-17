import { BarChart3, BookOpen, CheckCircle2, ShieldCheck, TrendingUp, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { MarketDepthData } from "@/hooks/useAIBetBuilder";
import type { AISlip } from "@/types/aiSlip";

interface Props {
  data: MarketDepthData;
  slips?: AISlip[];
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

/** Compute slip-level aggregate market quality stats */
function computeSlipMarketStats(slips: AISlip[]) {
  const allLegs = slips.flatMap(s => s.legs);
  const propLegs = allLegs.filter(l => !l.bet_type || l.bet_type === "player_prop");
  
  let totalConf = 0, confCount = 0;
  let minBooks = Infinity, maxBooks = 0;
  let allMainLine = true;
  let allVerified = true;
  let weakCount = 0;

  for (const leg of propLegs) {
    const ctx = leg.data_context;
    if (!ctx) continue;
    if (ctx.market_confidence != null) {
      totalConf += ctx.market_confidence;
      confCount++;
      if (ctx.market_confidence < 40) weakCount++;
    }
    if (ctx.books_count != null) {
      minBooks = Math.min(minBooks, ctx.books_count);
      maxBooks = Math.max(maxBooks, ctx.books_count);
    }
    if (ctx.is_main_line === false) allMainLine = false;
    if (ctx.odds_validated === false) allVerified = false;
  }

  return {
    avgConfidence: confCount > 0 ? Math.round(totalConf / confCount) : null,
    booksRange: minBooks <= maxBooks ? { min: minBooks, max: maxBooks } : null,
    allMainLine,
    allVerified,
    weakCount,
    propCount: propLegs.length,
  };
}

function getConfTier(conf: number): { label: string; color: string; bgColor: string } {
  if (conf >= 70) return { label: "Strong", color: "text-green-400", bgColor: "bg-green-500/15 border-green-500/25" };
  if (conf >= 45) return { label: "Moderate", color: "text-yellow-400", bgColor: "bg-yellow-500/15 border-yellow-500/25" };
  return { label: "Weak", color: "text-red-400", bgColor: "bg-red-500/15 border-red-500/25" };
}

export function MarketDepthSummary({ data, slips }: Props) {
  const mq = data.market_quality;
  const totalFiltered = mq
    ? (mq.removed_by_verified_only + mq.removed_by_main_lines_only + mq.removed_by_min_books + mq.removed_by_min_confidence + mq.removed_by_single_book_exclude)
    : 0;

  const slipStats = slips && slips.length > 0 ? computeSlipMarketStats(slips) : null;
  const confTier = slipStats?.avgConfidence != null ? getConfTier(slipStats.avgConfidence) : null;

  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardContent className="pt-4 pb-3 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-primary">Market Depth Summary</span>
          <div className="ml-auto flex items-center gap-2">
            {data.scoring_source && (
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full border ${
                data.scoring_source === "today" ? "bg-green-500/10 text-green-400 border-green-500/20"
                  : data.scoring_source === "auto-triggered" ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                  : data.scoring_source === "yesterday" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                  : "bg-muted/20 text-muted-foreground border-border/30"
              }`}>
                Scoring: {data.scoring_source}
              </span>
            )}
            <span className="text-[9px] text-muted-foreground font-mono">
              {data.mode === "verified_market_first" ? "✓ Verified-first" : data.mode}
            </span>
          </div>
        </div>

        {/* Slip-level trust banner */}
        {slipStats && slipStats.propCount > 0 && (
          <div className={`rounded-lg border p-2.5 space-y-2 ${confTier?.bgColor || "bg-muted/20 border-border/30"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Slip Market Quality</span>
              {confTier && (
                <span className={`text-[10px] font-bold ${confTier.color}`}>{confTier.label}</span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center">
                <div className={`text-sm font-bold ${confTier?.color || "text-foreground"}`}>
                  {slipStats.avgConfidence ?? "—"}
                </div>
                <div className="text-[8px] text-muted-foreground">Avg Conf</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold text-foreground">
                  {slipStats.booksRange
                    ? slipStats.booksRange.min === slipStats.booksRange.max
                      ? `${slipStats.booksRange.min}`
                      : `${slipStats.booksRange.min}–${slipStats.booksRange.max}`
                    : "—"}
                </div>
                <div className="text-[8px] text-muted-foreground">Books Range</div>
              </div>
              <div className="text-center">
                <div className={`text-sm font-bold ${slipStats.allMainLine ? "text-green-400" : "text-yellow-400"}`}>
                  {slipStats.allMainLine ? "✓" : "Mixed"}
                </div>
                <div className="text-[8px] text-muted-foreground">Main Lines</div>
              </div>
              <div className="text-center">
                <div className={`text-sm font-bold ${slipStats.allVerified ? "text-green-400" : "text-yellow-400"}`}>
                  {slipStats.allVerified ? "✓" : "Partial"}
                </div>
                <div className="text-[8px] text-muted-foreground">Verified</div>
              </div>
            </div>
            {slipStats.weakCount > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-yellow-400">
                <AlertTriangle className="h-3 w-3" />
                {slipStats.weakCount} leg{slipStats.weakCount > 1 ? "s" : ""} with weak market backing
              </div>
            )}
          </div>
        )}

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
