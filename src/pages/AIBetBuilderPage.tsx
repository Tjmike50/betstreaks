import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, Sparkles, Loader2, Bookmark, BookmarkCheck, Copy, Shield, Zap, Target, AlertCircle, WifiOff, CreditCard, Database, TrendingUp, BarChart3, Activity, Users, UserMinus, Trophy, ArrowUpDown, Hash, RefreshCw, Info, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAIBetBuilder } from "@/hooks/useAIBetBuilder";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { useAuth } from "@/contexts/AuthContext";
import type { AISlip, LegDataContext, LegBetType } from "@/types/aiSlip";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { BuilderFilterPanel } from "@/components/builder/BuilderFilterPanel";
import { BuilderActiveFilters } from "@/components/builder/BuilderActiveFilters";
import type { BuilderFilters } from "@/types/builderFilters";
import { DEFAULT_BUILDER_FILTERS, getActiveBuilderFilterCount } from "@/types/builderFilters";
import { GameMatchupHeader } from "@/components/builder/GameMatchupHeader";
import { MarketDepthSummary } from "@/components/builder/MarketDepthSummary";
import { LegMarketBadges, getLegMarketBorderClass } from "@/components/builder/LegMarketBadges";

const QUICK_PROMPTS = [
  { label: "🔥 High hit rate plays", prompt: "Build me a parlay with the highest hit-rate props tonight" },
  { label: "📈 Hot streaks right now", prompt: "Find players on hot streaks and build a slip" },
  { label: "🎯 Safe slips", prompt: "Make me a safer 2-leg parlay with consistent players" },
  { label: "💰 Undervalued props", prompt: "Find undervalued player props with good value scores" },
  { label: "🏀 Tonight's best", prompt: "Build me a +200 NBA parlay for tonight" },
  { label: "⚡ Aggressive +500", prompt: "5-leg aggressive parlay +500" },
];

function getRiskColor(risk: string) {
  switch (risk) {
    case "safe": return "border-green-500/40 bg-green-500/5";
    case "balanced": return "border-yellow-500/40 bg-yellow-500/5";
    case "aggressive": return "border-red-500/40 bg-red-500/5";
    default: return "border-border/50";
  }
}

function getRiskBadge(risk: string) {
  switch (risk) {
    case "safe": return "bg-green-500/20 text-green-400 border-green-500/30";
    case "balanced": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "aggressive": return "bg-red-500/20 text-red-400 border-red-500/30";
    default: return "";
  }
}

function getRiskIcon(risk: string) {
  switch (risk) {
    case "safe": return Shield;
    case "aggressive": return Zap;
    default: return Target;
  }
}

function getVolatilityColor(label: string | null | undefined) {
  switch (label) {
    case "low": return "text-green-400";
    case "medium": return "text-yellow-400";
    case "high": return "text-red-400";
    default: return "text-muted-foreground";
  }
}

function getConfidenceColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-green-400";
  if (score >= 45) return "text-yellow-400";
  return "text-red-400";
}

function DataContextChips({ ctx }: { ctx: LegDataContext }) {
  const chips: { label: string; color: string }[] = [];

  if (ctx.line_hit_rate) chips.push({ label: `Line: ${ctx.line_hit_rate}`, color: "bg-primary/10 text-primary" });
  else if (ctx.last10_hit_rate) chips.push({ label: `L10: ${ctx.last10_hit_rate}`, color: "bg-primary/10 text-primary" });

  if (ctx.vs_opponent) {
    const sampleNote = ctx.vs_opponent_sample != null ? ` (${ctx.vs_opponent_sample}g)` : "";
    chips.push({ label: `vs OPP: ${ctx.vs_opponent}${sampleNote}`, color: "bg-blue-500/10 text-blue-400" });
  }
  if (ctx.home_away_split) {
    const sampleNote = ctx.home_away_sample != null ? ` (${ctx.home_away_sample}g)` : "";
    chips.push({ label: `${ctx.home_away_split}${sampleNote}`, color: "bg-purple-500/10 text-purple-400" });
  }
  if (ctx.rest_note) chips.push({ label: ctx.rest_note, color: "bg-orange-500/10 text-orange-400" });
  if (ctx.opp_defense_note) chips.push({ label: ctx.opp_defense_note, color: "bg-cyan-500/10 text-cyan-400" });
  if (ctx.teammate_note) chips.push({ label: ctx.teammate_note, color: "bg-pink-500/10 text-pink-400" });
  if (ctx.minutes_trend === "up") chips.push({ label: "📈 Usage trending up", color: "bg-green-500/10 text-green-400" });
  if (ctx.minutes_trend === "down") chips.push({ label: "📉 Usage trending down", color: "bg-red-500/10 text-red-400" });
  if (ctx.role_label === "starter") chips.push({ label: "Starter", color: "bg-primary/10 text-primary" });
  if (ctx.role_label === "bench") chips.push({ label: "Bench", color: "bg-muted text-muted-foreground" });
  if (ctx.availability_note) chips.push({ label: ctx.availability_note, color: "bg-amber-500/10 text-amber-400" });
  if (ctx.lineup_confidence === "low") chips.push({ label: "⚠ Uncertain lineup", color: "bg-red-500/10 text-red-400" });
  if (ctx.lineup_confidence === "medium") chips.push({ label: "Lineup TBD", color: "bg-yellow-500/10 text-yellow-400" });
  if (ctx.market_note) {
    const isPositive = ctx.market_note.includes("improved") || ctx.market_note.includes("favorable");
    chips.push({ label: `📊 ${ctx.market_note}`, color: isPositive ? "bg-green-500/10 text-green-400" : "bg-orange-500/10 text-orange-400" });
  }
  // Market badges (source, verified, books, confidence, edge) are now in LegMarketBadges — skip here

  if (ctx.tags?.length) {
    for (const tag of ctx.tags.slice(0, 3)) {
      const label = tag.replace(/_/g, " ");
      const color = tag.includes("Hot") || tag.includes("consistent") || tag.includes("Strong") || tag.includes("Hit")
        ? "bg-green-500/10 text-green-400"
        : tag.includes("cold") || tag.includes("volatile") || tag.includes("Weak") || tag.includes("small")
        ? "bg-red-500/10 text-red-400"
        : "bg-muted text-muted-foreground";
      chips.push({ label, color });
    }
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {chips.map((c, i) => (
        <span key={i} className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${c.color}`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

function ScoringFreshnessBadge({ ctx }: { ctx: LegDataContext }) {
  if (!ctx.scoring_stale && ctx.scoring_source !== "yesterday" && ctx.scoring_source !== "auto-triggered") return null;
  
  const isYesterday = ctx.scoring_source === "yesterday";
  const isAutoTriggered = ctx.scoring_source === "auto-triggered";
  const isMissing = ctx.scoring_stale && !isYesterday;
  
  if (isAutoTriggered && !ctx.scoring_stale) return null; // auto-triggered + fresh = no warning

  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      {isYesterday && (
        <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
          ⏳ Yesterday's data
        </span>
      )}
      {isMissing && !isYesterday && (
        <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-muted/30 text-muted-foreground border border-border/30">
          ◌ Limited scoring context
        </span>
      )}
      {ctx.scoring_freshness_note && (
        <span className="text-[8px] text-muted-foreground italic">{ctx.scoring_freshness_note}</span>
      )}
    </div>
  );
}

function LegDataBar({ ctx }: { ctx: LegDataContext }) {
  const allStatsNull = ctx.confidence_score == null && ctx.value_score == null && ctx.season_avg == null && ctx.volatility_label == null;

  if (allStatsNull) {
    return (
      <div className="mt-2 pt-2 border-t border-border/20 space-y-1">
        <div className="text-center">
          <span className="inline-flex items-center gap-1 text-[9px] font-medium px-2 py-1 rounded-full bg-muted/20 text-muted-foreground border border-border/20">
            ◌ Scoring data pending
          </span>
        </div>
        {ctx.scoring_freshness_note && (
          <div className="text-center">
            <span className="text-[8px] text-muted-foreground italic">{ctx.scoring_freshness_note}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2 mt-2 pt-2 border-t border-border/20">
      <div className="text-center">
        <div className={`text-xs font-bold ${getConfidenceColor(ctx.confidence_score)}`}>
          {ctx.confidence_score != null ? ctx.confidence_score : "—"}
        </div>
        <div className="text-[9px] text-muted-foreground">Confidence</div>
      </div>
      <div className="text-center">
        <div className={`text-xs font-bold ${getConfidenceColor(ctx.value_score)}`}>
          {ctx.value_score != null ? ctx.value_score : "—"}
        </div>
        <div className="text-[9px] text-muted-foreground">Value</div>
      </div>
      <div className="text-center">
        <div className="text-xs font-bold text-foreground">
          {ctx.season_avg != null ? ctx.season_avg : "—"}
        </div>
        <div className="text-[9px] text-muted-foreground">Szn Avg</div>
      </div>
      <div className="text-center">
        <div className={`text-xs font-bold ${getVolatilityColor(ctx.volatility_label)}`}>
          {ctx.volatility_label || "—"}
        </div>
        <div className="text-[9px] text-muted-foreground">Volatility</div>
      </div>
      {ctx.sample_size != null && (
        <div className="col-span-4 text-center flex items-center justify-center gap-1.5">
          <span className="text-[9px] text-muted-foreground">
            {ctx.sample_size} game sample
          </span>
          {ctx.sample_size < 15 && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
              ⚠ Low sample
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SlipCard({ slip, index }: { slip: AISlip; index: number }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const RiskIcon = getRiskIcon(slip.risk_label);

  const handleSave = async () => {
    if (!user) {
      toast({ title: "Log in to save slips", variant: "destructive" });
      return;
    }
    setSaving(true);
    // Read sport from the slip row (set by the edge function); fall back to NBA
    const slipSport = (slip as any).sport || "NBA";
    const { error } = await supabase.from("saved_slips").insert({
      user_id: user.id,
      slip_id: slip.id,
      sport: slipSport,
    });
    setSaving(false);
    if (error) {
      if (error.code === "23505") {
        setSaved(true);
        toast({ title: "Already saved!" });
      } else {
        toast({ title: "Error saving", description: error.message, variant: "destructive" });
      }
    } else {
      setSaved(true);
      toast({
        title: "Saved!",
        description: "View in Saved Slips",
        action: (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate("/saved-slips")}>
            View
          </Button>
        ),
      });
    }
  };

  const handleCopy = () => {
    const text = `${slip.slip_name} (${slip.estimated_odds})\n${slip.legs.map((l) => `• ${l.player_name} ${l.line} ${l.stat_type} ${l.odds || ""}`).join("\n")}`;
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard!" });
  };

  return (
    <Card className={`overflow-hidden transition-all ${getRiskColor(slip.risk_label)}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5 flex-1 min-w-0">
            <h3 className="text-base font-bold leading-tight">{slip.slip_name}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`text-[11px] ${getRiskBadge(slip.risk_label)}`}>
                <RiskIcon className="h-3 w-3 mr-1" />
                {slip.risk_label}
              </Badge>
              {slip.estimated_odds && (
                <span className="text-lg font-mono font-black text-primary">{slip.estimated_odds}</span>
              )}
            </div>
          </div>
          <span className="text-xs text-muted-foreground font-mono mt-1">#{index + 1}</span>
        </div>
        {slip.reasoning && (
          <p className="text-xs text-muted-foreground leading-relaxed">{slip.reasoning}</p>
        )}
      </div>

      {/* Legs */}
      <CardContent className="px-4 pb-4 pt-0 space-y-2">
        {slip.legs.map((leg, i) => {
          const isGameLevel = leg.bet_type === "moneyline" || leg.bet_type === "spread" || leg.bet_type === "total";
          return (
          <div key={i} className={`bg-card/80 border border-border/30 rounded-lg p-3 space-y-1 border-l-2 ${!isGameLevel ? getLegMarketBorderClass(leg.data_context) : ""}`}>
            {/* Game matchup header for game-level legs */}
            {isGameLevel && <GameMatchupHeader leg={leg} />}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {isGameLevel && leg.bet_type === "moneyline" && (
                  <span className="text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded shrink-0">
                    ML
                  </span>
                )}
                {isGameLevel && leg.bet_type === "spread" && (
                  <span className="text-[10px] font-mono font-bold bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded shrink-0">
                    SPR
                  </span>
                )}
                {isGameLevel && leg.bet_type === "total" && (
                  <span className="text-[10px] font-mono font-bold bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded shrink-0">
                    O/U
                  </span>
                )}
                {!isGameLevel && leg.team_abbr && (
                  <span className="text-[10px] font-mono font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">
                    {leg.team_abbr}
                  </span>
                )}
                <span className="text-sm font-semibold truncate">{leg.player_name}</span>
              </div>
              {leg.odds && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs font-mono font-bold text-muted-foreground">{leg.odds}</span>
                  {isGameLevel && leg.data_context?.odds_source && (
                    <span className="text-[8px] font-medium px-1 py-0.5 rounded bg-indigo-500/10 text-indigo-400 uppercase">
                      {leg.data_context.odds_source}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="text-sm text-primary font-semibold">
              {leg.line} {!isGameLevel && leg.stat_type}
            </div>
            {isGameLevel && leg.data_context?.implied_probability != null && (
              <div className="text-[10px] text-muted-foreground">
                Implied: {leg.data_context.implied_probability}%
              </div>
            )}
            {leg.reasoning && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">{leg.reasoning}</p>
            )}

            {/* Market trust badges — player props only */}
            {!isGameLevel && leg.data_context && <LegMarketBadges ctx={leg.data_context} isGameLevel={isGameLevel} />}

            {/* Data context chips */}
            {leg.data_context && <DataContextChips ctx={leg.data_context} />}

            {/* Scoring freshness warning */}
            {!isGameLevel && leg.data_context && <ScoringFreshnessBadge ctx={leg.data_context} />}

            {/* Data context bar — only for player props */}
            {!isGameLevel && leg.data_context && <LegDataBar ctx={leg.data_context} />}
          </div>
          );
        })}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <Button
            size="sm"
            variant={saved ? "default" : "outline"}
            onClick={handleSave}
            disabled={saving || saved}
            className="text-xs"
          >
            {saved ? <BookmarkCheck className="h-3.5 w-3.5 mr-1" /> : <Bookmark className="h-3.5 w-3.5 mr-1" />}
            {saved ? "Saved" : "Save"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleCopy} className="text-xs">
            <Copy className="h-3.5 w-3.5 mr-1" />
            Copy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BuilderLoadingState() {
  return (
    <div className="space-y-4">
      <div className="text-center py-8 space-y-3">
        <div className="relative mx-auto w-16 h-16">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <Brain className="absolute inset-0 m-auto h-6 w-6 text-primary" />
        </div>
        <p className="text-sm font-medium">Scoring candidates & building slips...</p>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Analyzing player game logs & matchup data</p>
          <p className="text-xs text-muted-foreground">Computing hit rates, trends & confidence scores</p>
          <p className="text-xs text-muted-foreground">Assembling data-driven slips with live odds</p>
        </div>
      </div>
      {[1, 2].map((i) => (
        <Card key={i} className="border-border/30 animate-pulse">
          <CardContent className="pt-4 space-y-3">
            <div className="h-5 bg-muted rounded w-2/3" />
            <div className="h-3 bg-muted rounded w-1/3" />
            <div className="space-y-2">
              <div className="h-20 bg-muted/50 rounded-lg" />
              <div className="h-20 bg-muted/50 rounded-lg" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AIBetBuilderPage() {
  const [prompt, setPrompt] = useState("");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [filters, setFilters] = useState<BuilderFilters>({
    ...DEFAULT_BUILDER_FILTERS,
  });
  const { slips, isLoading, error, errorType, buildSlips, marketDepth, isFallback } = useAIBetBuilder();
  const { isPremium } = usePremiumStatus();
  const { user } = useAuth();
  const navigate = useNavigate();
  const activeFilterCount = getActiveBuilderFilterCount(filters);

  const handleSubmit = (overridePrompt?: string) => {
    const p = (overridePrompt ?? prompt).trim();
    if (!p) return;
    setHasInteracted(true);
    const slipCount = isPremium ? filters.slipCount : 1;
    buildSlips(p, slipCount, filters);
  };

  const handleButtonSubmit = () => handleSubmit();

  const isAuthError = errorType === "auth";
  const isLimitError = errorType === "limit";
  const isCreditsError = errorType === "credits";
  const isNoDataError = errorType === "no-data";
  const isNetworkError = errorType === "network";
  const isGenericError = errorType === "generic";

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">
        {/* Hero Headline */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 bg-primary/10 rounded-full px-4 py-1.5">
            <Brain className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-primary">AI Bet Builder</span>
          </div>
          <h1 className="text-2xl font-bold leading-tight">
            Find high-probability NBA betting trends using AI + real data
          </h1>
          <p className="text-sm text-muted-foreground">
            No guessing. Just stats, hit rates, and streaks.
          </p>
        </div>

        {/* How It Works — compact 3-step */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center space-y-1.5 p-3 rounded-lg bg-card border border-border/30">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-xs font-bold text-primary">1</span>
            <p className="text-[11px] text-muted-foreground leading-tight">Enter a prompt or tap a suggestion</p>
          </div>
          <div className="text-center space-y-1.5 p-3 rounded-lg bg-card border border-border/30">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-xs font-bold text-primary">2</span>
            <p className="text-[11px] text-muted-foreground leading-tight">AI analyzes real data, hit rates & matchups</p>
          </div>
          <div className="text-center space-y-1.5 p-3 rounded-lg bg-card border border-border/30">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-xs font-bold text-primary">3</span>
            <p className="text-[11px] text-muted-foreground leading-tight">Get data-driven slips instantly</p>
          </div>
        </div>

        {/* Quick-Start Prompts — auto-run on click */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Quick start</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp.prompt}
                onClick={() => { setPrompt(qp.prompt); handleSubmit(qp.prompt); }}
                disabled={isLoading}
                className="text-xs px-3 py-1.5 rounded-full bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors disabled:opacity-50"
              >
                {qp.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <BuilderFilterPanel filters={filters} onChange={setFilters} isPremium={isPremium} />

        {/* Prompt Input */}
        <div className="space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Build me a +200 NBA parlay for tonight..."
            className="min-h-[80px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <Button onClick={handleButtonSubmit} disabled={isLoading || !prompt.trim()} className="w-full">
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Scoring & building...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Slips
              </>
            )}
          </Button>

          {!isPremium && (
            <p className="text-xs text-center text-muted-foreground">
              Free: 1 AI slip/day •{" "}
              <button onClick={() => navigate("/premium")} className="text-primary underline">
                Upgrade for unlimited
              </button>
            </p>
          )}
        </div>

        {/* Error States */}
        {isAuthError && (
          <Card className="border-border bg-card">
            <CardContent className="pt-5 pb-5 space-y-4 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center">
                <Lock className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-base font-bold text-foreground">Log in to use the AI Builder</p>
              <p className="text-sm text-muted-foreground">Create an account or sign in to generate AI-powered betting slips.</p>
              <Button className="w-full" onClick={() => navigate("/auth")}>
                Log In / Sign Up
              </Button>
            </CardContent>
          </Card>
        )}
        {isLimitError && (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="pt-5 pb-5 space-y-4">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 mx-auto rounded-full bg-primary/20 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <p className="text-base font-bold">You just used your free AI slip.</p>
                <p className="text-sm text-muted-foreground">Unlock unlimited slips and advanced data:</p>
              </div>
              <div className="space-y-1.5 text-sm">
                <p className="flex items-center gap-2"><span className="text-primary">✔</span> More slips per request</p>
                <p className="flex items-center gap-2"><span className="text-primary">✔</span> Advanced hit-rate splits</p>
                <p className="flex items-center gap-2"><span className="text-primary">✔</span> Premium streak alerts</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-primary">$60/year</p>
                <p className="text-[11px] text-muted-foreground">Early access pricing</p>
              </div>
              <Button className="w-full" onClick={() => navigate("/premium")}>
                Upgrade to Premium
              </Button>
            </CardContent>
          </Card>
        )}

        {isCreditsError && (
          <Card className="border-orange-500/30 bg-orange-500/5">
            <CardContent className="pt-4 flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-orange-400 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-orange-400">AI credits exhausted</p>
                <p className="text-xs text-muted-foreground">{error}</p>
                <Button size="sm" variant="outline" onClick={() => navigate("/premium")}>
                  Check Plan
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isNoDataError && (
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardContent className="pt-4 flex items-start gap-3">
              <Database className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-blue-400">Prop data not ready</p>
                <p className="text-xs text-muted-foreground">{error}</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleButtonSubmit}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isNetworkError && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="pt-4 flex items-start gap-3">
              <WifiOff className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">Connection failed</p>
                <p className="text-xs text-muted-foreground">{error}</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleButtonSubmit}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isGenericError && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="pt-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">Something went wrong</p>
                <p className="text-xs text-muted-foreground">{error}</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleButtonSubmit}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {isLoading && <BuilderLoadingState />}

        {/* Results */}
        {!isLoading && slips.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {isFallback ? "Data-Driven Picks" : "Your AI Slips"}
              <Badge variant="secondary" className="text-[10px]">{slips.length}</Badge>
            </h2>
            {/* Fallback banner */}
            {isFallback && (
              <Card className="border-blue-500/30 bg-blue-500/5">
                <CardContent className="pt-3 pb-3 flex items-start gap-2.5">
                  <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    These picks were built from scored data without AI formatting. Try again later for full AI analysis.
                  </p>
                </CardContent>
              </Card>
            )}
            {/* Market depth summary */}
            {marketDepth && <MarketDepthSummary data={marketDepth} slips={slips} />}
            {/* Show active filters above results */}
            {activeFilterCount > 0 && (
              <div className="bg-card/50 border border-border/30 rounded-lg p-3 space-y-1.5">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Applied Filters</span>
                <BuilderActiveFilters
                  filters={filters}
                  onChange={setFilters}
                  onClearAll={() => setFilters({ ...DEFAULT_BUILDER_FILTERS, slipCount: filters.slipCount })}
                />
              </div>
            )}
            {slips.map((slip, i) => (
              <SlipCard key={slip.id} slip={slip} index={i} />
            ))}
          </div>
        )}

        {/* Initial empty state — first visit guidance */}
        {!isLoading && !error && slips.length === 0 && !hasInteracted && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6 pb-5 space-y-3">
              <div className="text-center space-y-2">
                <Sparkles className="h-8 w-8 mx-auto text-primary/60" />
                <h3 className="text-base font-semibold">Start with a quick prompt</h3>
                <p className="text-sm text-muted-foreground">
                  Try one of the suggestions above or type your own request
                </p>
              </div>
              {!user && (
                <Button className="w-full" onClick={() => navigate("/auth")}>
                  Log in to get started
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Post-interaction empty state */}
        {!isLoading && !error && slips.length === 0 && hasInteracted && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Enter a prompt and tap Generate to build slips</p>
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-[10px] text-muted-foreground text-center px-4">
          AI picks are data-driven suggestions based on historical performance trends. Past results do not predict future outcomes. Please gamble responsibly.
        </p>
      </div>
    </div>
  );
}
