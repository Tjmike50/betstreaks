import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Trash2, Loader2, ShieldCheck, AlertTriangle, TrendingUp, TrendingDown, Brain, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAIBetAnalyzer } from "@/hooks/useAIBetAnalyzer";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import type { AnalyzerLegInput, BetAnalysis } from "@/types/aiSlip";

const STAT_TYPES = ["Points", "Rebounds", "Assists", "3-Pointers", "Spread", "Total", "Moneyline"];

function getGradeStyle(grade: string) {
  switch (grade) {
    case "A": return { bg: "bg-green-500/20 border-green-500/40", text: "text-green-400" };
    case "B": return { bg: "bg-blue-500/20 border-blue-500/40", text: "text-blue-400" };
    case "C": return { bg: "bg-yellow-500/20 border-yellow-500/40", text: "text-yellow-400" };
    case "D": return { bg: "bg-orange-500/20 border-orange-500/40", text: "text-orange-400" };
    case "F": return { bg: "bg-red-500/20 border-red-500/40", text: "text-red-400" };
    default: return { bg: "bg-muted", text: "text-muted-foreground" };
  }
}

function AnalyzerLoadingState() {
  return (
    <div className="space-y-4">
      <div className="text-center py-8 space-y-3">
        <div className="relative mx-auto w-16 h-16">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <BarChart3 className="absolute inset-0 m-auto h-6 w-6 text-primary" />
        </div>
        <p className="text-sm font-medium">Analyzing your slip...</p>
        <p className="text-xs text-muted-foreground">Grading legs, checking correlations</p>
      </div>
      <div className="space-y-3 animate-pulse">
        <div className="h-24 bg-muted/50 rounded-lg" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-20 bg-muted/50 rounded-lg" />
          <div className="h-20 bg-muted/50 rounded-lg" />
        </div>
        <div className="h-32 bg-muted/50 rounded-lg" />
      </div>
    </div>
  );
}

function AnalysisResult({ analysis, legs }: { analysis: BetAnalysis; legs: AnalyzerLegInput[] }) {
  const gradeStyle = getGradeStyle(analysis.overall_grade);

  return (
    <div className="space-y-3">
      {/* Grade Card */}
      <Card className={`border ${gradeStyle.bg}`}>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className={`text-4xl font-black w-16 h-16 rounded-xl flex items-center justify-center border ${gradeStyle.bg} ${gradeStyle.text}`}>
              {analysis.overall_grade}
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={
                  analysis.risk_label === "safe" ? "bg-green-500/20 text-green-400 border-green-500/30" :
                  analysis.risk_label === "balanced" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                  "bg-red-500/20 text-red-400 border-red-500/30"
                }>
                  {analysis.risk_label}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">{legs.length} legs</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{analysis.overall_reasoning}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strongest & Weakest */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-green-500/20">
          <CardContent className="pt-3 pb-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-green-400 text-[11px] font-bold uppercase tracking-wide">
              <TrendingUp className="h-3.5 w-3.5" />
              Strongest
            </div>
            <p className="text-sm font-semibold leading-tight">
              {legs[analysis.strongest_leg?.leg_index]?.player_name || "—"}
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{analysis.strongest_leg?.reasoning}</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20">
          <CardContent className="pt-3 pb-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-red-400 text-[11px] font-bold uppercase tracking-wide">
              <TrendingDown className="h-3.5 w-3.5" />
              Weakest
            </div>
            <p className="text-sm font-semibold leading-tight">
              {legs[analysis.weakest_leg?.leg_index]?.player_name || "—"}
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{analysis.weakest_leg?.reasoning}</p>
          </CardContent>
        </Card>
      </div>

      {/* Correlation Warnings */}
      {analysis.correlation_warnings && analysis.correlation_warnings.length > 0 && (
        <Card className="border-yellow-500/20 bg-yellow-500/5">
          <CardContent className="pt-3 pb-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-yellow-400 text-[11px] font-bold uppercase tracking-wide">
              <AlertTriangle className="h-3.5 w-3.5" />
              Correlation Warnings
            </div>
            {analysis.correlation_warnings.map((w, i) => (
              <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">• {w}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Rebuilds */}
      {analysis.safer_rebuild && (
        <Card className="border-green-500/20">
          <CardHeader className="pb-1.5 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-400" />
              <span>Safer Rebuild</span>
              <span className="font-mono text-primary text-xs">{analysis.safer_rebuild.estimated_odds}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            <p className="text-[11px] text-muted-foreground">{analysis.safer_rebuild.reasoning}</p>
            {analysis.safer_rebuild.legs?.map((leg, i) => (
              <div key={i} className="text-xs bg-secondary/50 rounded-lg px-3 py-2 flex items-center justify-between">
                <span><span className="font-semibold">{leg.player_name}</span> — {leg.line} {leg.stat_type}</span>
                {leg.odds && <span className="font-mono text-muted-foreground text-[10px]">{leg.odds}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {analysis.aggressive_rebuild && (
        <Card className="border-red-500/20">
          <CardHeader className="pb-1.5 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-red-400" />
              <span>Higher Payout Version</span>
              <span className="font-mono text-primary text-xs">{analysis.aggressive_rebuild.estimated_odds}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            <p className="text-[11px] text-muted-foreground">{analysis.aggressive_rebuild.reasoning}</p>
            {analysis.aggressive_rebuild.legs?.map((leg, i) => (
              <div key={i} className="text-xs bg-secondary/50 rounded-lg px-3 py-2 flex items-center justify-between">
                <span><span className="font-semibold">{leg.player_name}</span> — {leg.line} {leg.stat_type}</span>
                {leg.odds && <span className="font-mono text-muted-foreground text-[10px]">{leg.odds}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function BetAnalyzerPage() {
  const navigate = useNavigate();
  const { isPremium } = usePremiumStatus();
  const { analysis, isLoading, error, analyzeSlip } = useAIBetAnalyzer();
  const [legs, setLegs] = useState<AnalyzerLegInput[]>([
    { player_name: "", stat_type: "Points", line: "", pick: "Over" },
  ]);

  const addLeg = () => {
    if (legs.length >= 10) return;
    setLegs([...legs, { player_name: "", stat_type: "Points", line: "", pick: "Over" }]);
  };

  const removeLeg = (idx: number) => {
    if (legs.length <= 1) return;
    setLegs(legs.filter((_, i) => i !== idx));
  };

  const updateLeg = (idx: number, field: keyof AnalyzerLegInput, value: string) => {
    setLegs(legs.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const handleAnalyze = () => {
    const valid = legs.filter((l) => l.player_name.trim() && l.line.trim());
    if (valid.length === 0) return;
    analyzeSlip(valid);
  };

  const isValid = legs.some((l) => l.player_name.trim() && l.line.trim());

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 bg-primary/10 rounded-full px-4 py-1.5">
            <Search className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-primary">Bet Analyzer</span>
          </div>
          <h1 className="text-2xl font-bold">Grade Your Slip</h1>
          <p className="text-sm text-muted-foreground">
            Enter your bet legs and get an AI-powered analysis
          </p>
        </div>

        {/* Leg Inputs */}
        <div className="space-y-3">
          {legs.map((leg, idx) => (
            <Card key={idx} className="border-border/50">
              <CardContent className="pt-3 pb-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Leg {idx + 1}</span>
                  {legs.length > 1 && (
                    <button onClick={() => removeLeg(idx)} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Input
                  placeholder="Player name (e.g., LeBron James)"
                  value={leg.player_name}
                  onChange={(e) => updateLeg(idx, "player_name", e.target.value)}
                />
                <div className="grid grid-cols-3 gap-2">
                  <Select value={leg.stat_type} onValueChange={(v) => updateLeg(idx, "stat_type", v)}>
                    <SelectTrigger className="text-xs h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAT_TYPES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Line (24.5)"
                    value={leg.line}
                    onChange={(e) => updateLeg(idx, "line", e.target.value)}
                    className="text-xs h-9"
                  />
                  <Select value={leg.pick} onValueChange={(v) => updateLeg(idx, "pick", v)}>
                    <SelectTrigger className="text-xs h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Over">Over</SelectItem>
                      <SelectItem value="Under">Under</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))}

          <Button variant="outline" size="sm" onClick={addLeg} disabled={legs.length >= 10} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Leg {legs.length < 10 && <span className="text-muted-foreground ml-1">({legs.length}/10)</span>}
          </Button>
        </div>

        {/* Analyze Button */}
        <Button onClick={handleAnalyze} disabled={isLoading || !isValid} className="w-full">
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Search className="h-4 w-4 mr-2" />
              Analyze Slip
            </>
          )}
        </Button>

        {!isPremium && (
          <p className="text-xs text-center text-muted-foreground">
            Free: 1 analysis/day •{" "}
            <button onClick={() => navigate("/premium")} className="text-primary underline">
              Upgrade for unlimited
            </button>
          </p>
        )}

        {/* Loading State */}
        {isLoading && <AnalyzerLoadingState />}

        {/* Error */}
        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="pt-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">{error}</p>
                {error.includes("limit") && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate("/premium")}>
                    Go Premium
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {!isLoading && analysis && <AnalysisResult analysis={analysis} legs={legs} />}

        <p className="text-[10px] text-muted-foreground text-center px-4">
          AI analysis is based on historical data and statistical trends. Past performance does not predict future results. Please gamble responsibly.
        </p>
      </div>
    </div>
  );
}
