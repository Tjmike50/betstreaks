import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, BookOpen, BarChart3, Target, TrendingUp } from "lucide-react";
import type { LegDataContext } from "@/types/aiSlip";

interface Props {
  ctx: LegDataContext;
  isGameLevel?: boolean;
}

function getMarketStrength(ctx: LegDataContext): { tier: "strong" | "moderate" | "weak"; borderClass: string } {
  const conf = ctx.market_confidence ?? 0;
  const books = ctx.books_count ?? 0;
  if (conf >= 65 && books >= 3) return { tier: "strong", borderClass: "border-l-green-500" };
  if (conf >= 40 && books >= 2) return { tier: "moderate", borderClass: "border-l-yellow-500" };
  return { tier: "weak", borderClass: "border-l-red-500" };
}

function ConfidenceMeter({ value }: { value: number }) {
  const color = value >= 70 ? "bg-success" : value >= 45 ? "bg-warning" : "bg-danger";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-[9px] font-mono font-bold">{value}</span>
    </div>
  );
}

export function LegMarketBadges({ ctx, isGameLevel }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (isGameLevel) return null;

  const hasMarketData = ctx.books_count != null || ctx.market_confidence != null || ctx.odds_validated != null;
  if (!hasMarketData) return null;

  const strength = getMarketStrength(ctx);

  return (
    <div className="mt-1.5 space-y-1.5">
      {/* Badge row */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* Verified badge */}
        {ctx.odds_validated && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-success/15 text-success border border-success/25">
            <CheckCircle2 className="h-2.5 w-2.5" />
            Verified
          </span>
        )}
        {ctx.odds_validated === false && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/25">
            Unverified
          </span>
        )}

        {/* Books count */}
        {ctx.books_count != null && ctx.books_count > 0 && (
          <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${
            ctx.books_count >= 3 ? "bg-success/10 text-success border-success/20"
              : ctx.books_count >= 2 ? "bg-warning/10 text-warning border-warning/20"
              : "bg-danger/10 text-danger border-danger/20"
          }`}>
            <BookOpen className="h-2.5 w-2.5" />
            {ctx.books_count} book{ctx.books_count > 1 ? "s" : ""}
          </span>
        )}

        {/* Main line */}
        {ctx.is_main_line === true && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            Main Line
          </span>
        )}
        {ctx.is_main_line === false && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20">
            Alt Line
          </span>
        )}

        {/* Market confidence inline */}
        {ctx.market_confidence != null && (
          <ConfidenceMeter value={ctx.market_confidence} />
        )}

        {/* Sportsbook source */}
        {ctx.odds_source && (
          <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase">
            {ctx.odds_source}
          </span>
        )}

        {/* Edge */}
        {ctx.edge != null && ctx.edge !== 0 && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
            ctx.edge > 0 ? "bg-success/10 text-success border-success/20" : "bg-danger/10 text-danger border-danger/20"
          }`}>
            {ctx.edge > 0 ? "+" : ""}{ctx.edge}% edge
          </span>
        )}

        {/* Expander toggle */}
        {(ctx.consensus_line != null || ctx.implied_probability != null || ctx.best_over_odds || ctx.best_under_odds) && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-auto text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Less" : "More"}
          </button>
        )}
      </div>

      {/* Expanded market detail */}
      {expanded && (
        <div className="bg-muted/20 border border-border/20 rounded-lg p-2.5 space-y-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Market Detail</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {ctx.consensus_line != null && (
              <DetailRow icon={Target} label="Consensus Line" value={String(ctx.consensus_line)} />
            )}
            {ctx.market_threshold != null && (
              <DetailRow icon={BarChart3} label="Market Threshold" value={String(ctx.market_threshold)} />
            )}
            {ctx.implied_probability != null && (
              <DetailRow icon={TrendingUp} label="Implied Prob" value={`${ctx.implied_probability}%`} />
            )}
            {ctx.books_count != null && (
              <DetailRow icon={BookOpen} label="Books Supporting" value={String(ctx.books_count)} />
            )}
            {ctx.best_over_odds && (
              <DetailRow label="Best Over" value={ctx.best_over_odds} />
            )}
            {ctx.best_under_odds && (
              <DetailRow label="Best Under" value={ctx.best_under_odds} />
            )}
            {ctx.edge != null && (
              <DetailRow label="Calculated Edge" value={`${ctx.edge > 0 ? "+" : ""}${ctx.edge}%`} />
            )}
            {ctx.market_confidence != null && (
              <DetailRow label="Market Confidence" value={String(ctx.market_confidence)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon?: typeof BarChart3; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="flex items-center gap-1 text-muted-foreground">
        {Icon && <Icon className="h-2.5 w-2.5" />}
        {label}
      </span>
      <span className="font-mono font-semibold text-foreground">{value}</span>
    </div>
  );
}

/** Returns a left-border class based on market strength for the leg card */
export function getLegMarketBorderClass(ctx: LegDataContext | null | undefined): string {
  if (!ctx) return "";
  return getMarketStrength(ctx).borderClass;
}
