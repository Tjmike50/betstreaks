import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, Sparkles, Loader2, Bookmark, BookmarkCheck, Copy, Shield, Zap, Target, AlertCircle, WifiOff, TrendingUp, BarChart3, Activity, Users, UserMinus, Trophy, ArrowUpDown, Hash } from "lucide-react";
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

const QUICK_PROMPTS = [
  "Build me a +150 parlay",
  "Give me 3 NBA slips around +200",
  "Make me a safer 2-leg parlay",
  "Build a player prop slip for tonight",
  "Build me a combo parlay with ML + player props",
  "5-leg aggressive parlay +500",
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
  if (ctx.odds_source) {
    chips.push({ label: `📖 ${ctx.odds_source}`, color: "bg-indigo-500/10 text-indigo-400" });
  }
  if (ctx.implied_probability != null) {
    chips.push({ label: `Mkt: ${ctx.implied_probability}%`, color: "bg-sky-500/10 text-sky-400" });
  }
  if (ctx.odds_validated === false) {
    chips.push({ label: "⚠ Odds unverified", color: "bg-red-500/10 text-red-400" });
  }
  if (ctx.market_threshold != null) {
    const dir = ctx.market_threshold > 0 ? "O" : "U";
    chips.push({ label: `Market line: ${dir}${Math.abs(ctx.market_threshold)}`, color: "bg-sky-500/10 text-sky-400" });
  }

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

function LegDataBar({ ctx }: { ctx: LegDataContext }) {
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
        <div className="col-span-4 text-center">
          <span className="text-[9px] text-muted-foreground">
            {ctx.sample_size} game sample
          </span>
        </div>
      )}
    </div>
  );
}

function SlipCard({ slip, index }: { slip: AISlip; index: number }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const RiskIcon = getRiskIcon(slip.risk_label);

  const handleSave = async () => {
    if (!user) {
      toast({ title: "Log in to save slips", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("saved_slips").insert({
      user_id: user.id,
      slip_id: slip.id,
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
      toast({ title: "Slip saved!" });
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
          <div key={i} className="bg-card/80 border border-border/30 rounded-lg p-3 space-y-1">
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
                  {leg.data_context?.odds_source && (
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

            {/* Data context chips */}
            {leg.data_context && <DataContextChips ctx={leg.data_context} />}

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
  const [filters, setFilters] = useState<BuilderFilters>({
    ...DEFAULT_BUILDER_FILTERS,
  });
  const { slips, isLoading, error, buildSlips } = useAIBetBuilder();
  const { isPremium } = usePremiumStatus();
  const navigate = useNavigate();
  const activeFilterCount = getActiveBuilderFilterCount(filters);

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    const slipCount = isPremium ? filters.slipCount : 1;
    buildSlips(prompt.trim(), slipCount, filters);
  };

  const isLimitError = error?.includes("free") || error?.includes("limit") || error?.includes("Upgrade");
  const isApiError = error && !isLimitError;

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 bg-primary/10 rounded-full px-4 py-1.5">
            <Brain className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-primary">AI Bet Builder</span>
          </div>
          <h1 className="text-2xl font-bold">Build Your Slip</h1>
          <p className="text-sm text-muted-foreground">
            Data-driven picks powered by historical scoring analysis
          </p>
        </div>

        {/* Data engine badge */}
        <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> Hit Rate Engine</span>
          <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Trend Analysis</span>
          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> Matchup Data</span>
        </div>

        {/* Quick Prompts */}
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((qp) => (
            <button
              key={qp}
              onClick={() => setPrompt(qp)}
              className="text-xs px-3 py-1.5 rounded-full bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors"
            >
              {qp}
            </button>
          ))}
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
          <Button onClick={handleSubmit} disabled={isLoading || !prompt.trim()} className="w-full">
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
        {isLimitError && (
          <Card className="border-yellow-500/30 bg-yellow-500/5">
            <CardContent className="pt-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-yellow-400">Daily limit reached</p>
                <p className="text-xs text-muted-foreground">{error}</p>
                <Button size="sm" variant="outline" onClick={() => navigate("/premium")}>
                  Go Premium
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isApiError && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="pt-4 flex items-start gap-3">
              <WifiOff className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Something went wrong</p>
                <p className="text-xs text-muted-foreground">{error}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={handleSubmit}>
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
              Your AI Slips
              <Badge variant="secondary" className="text-[10px]">{slips.length}</Badge>
            </h2>
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

        {/* Empty state */}
        {!isLoading && !error && slips.length === 0 && prompt && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Enter a prompt and tap Generate to build slips</p>
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-[10px] text-muted-foreground text-center px-4">
          AI picks are data-driven suggestions based on historical scoring analysis, not guarantees. Always gamble responsibly.
        </p>
      </div>
    </div>
  );
}
