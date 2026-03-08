import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Trash2, Loader2, ShieldCheck, AlertTriangle, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAIBetAnalyzer } from "@/hooks/useAIBetAnalyzer";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import type { AnalyzerLegInput, BetAnalysis } from "@/types/aiSlip";

const STAT_TYPES = ["Points", "Rebounds", "Assists", "3-Pointers", "Spread", "Total", "Moneyline"];

function getGradeColor(grade: string) {
  switch (grade) {
    case "A": return "bg-green-500/20 text-green-400";
    case "B": return "bg-blue-500/20 text-blue-400";
    case "C": return "bg-yellow-500/20 text-yellow-400";
    case "D": return "bg-orange-500/20 text-orange-400";
    case "F": return "bg-red-500/20 text-red-400";
    default: return "bg-muted text-muted-foreground";
  }
}

function AnalysisResult({ analysis, legs }: { analysis: BetAnalysis; legs: AnalyzerLegInput[] }) {
  return (
    <div className="space-y-4">
      {/* Grade */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className={`text-4xl font-black w-16 h-16 rounded-xl flex items-center justify-center ${getGradeColor(analysis.overall_grade)}`}>
              {analysis.overall_grade}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className={
                  analysis.risk_label === "safe" ? "bg-green-500/20 text-green-400 border-green-500/30" :
                  analysis.risk_label === "balanced" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                  "bg-red-500/20 text-red-400 border-red-500/30"
                }>
                  {analysis.risk_label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{analysis.overall_reasoning}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strongest & Weakest */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-green-500/20">
          <CardContent className="pt-4 space-y-1">
            <div className="flex items-center gap-1.5 text-green-400 text-xs font-semibold">
              <TrendingUp className="h-3.5 w-3.5" />
              Strongest Leg
            </div>
            <p className="text-sm font-medium">
              {legs[analysis.strongest_leg?.leg_index]?.player_name || "—"}
            </p>
            <p className="text-xs text-muted-foreground">{analysis.strongest_leg?.reasoning}</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20">
          <CardContent className="pt-4 space-y-1">
            <div className="flex items-center gap-1.5 text-red-400 text-xs font-semibold">
              <TrendingDown className="h-3.5 w-3.5" />
              Weakest Leg
            </div>
            <p className="text-sm font-medium">
              {legs[analysis.weakest_leg?.leg_index]?.player_name || "—"}
            </p>
            <p className="text-xs text-muted-foreground">{analysis.weakest_leg?.reasoning}</p>
          </CardContent>
        </Card>
      </div>

      {/* Correlation Warnings */}
      {analysis.correlation_warnings && analysis.correlation_warnings.length > 0 && (
        <Card className="border-yellow-500/20 bg-yellow-500/5">
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center gap-1.5 text-yellow-400 text-xs font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              Correlation Warnings
            </div>
            {analysis.correlation_warnings.map((w, i) => (
              <p key={i} className="text-xs text-muted-foreground">• {w}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Rebuilds */}
      {analysis.safer_rebuild && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-400" />
              Safer Rebuild
              <span className="font-mono text-primary">{analysis.safer_rebuild.estimated_odds}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">{analysis.safer_rebuild.reasoning}</p>
            {analysis.safer_rebuild.legs?.map((leg, i) => (
              <div key={i} className="text-xs bg-secondary/50 rounded px-2 py-1.5">
                <span className="font-medium">{leg.player_name}</span> — {leg.line} {leg.stat_type}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {analysis.aggressive_rebuild && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-red-400" />
              Higher Payout Version
              <span className="font-mono text-primary">{analysis.aggressive_rebuild.estimated_odds}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">{analysis.aggressive_rebuild.reasoning}</p>
            {analysis.aggressive_rebuild.legs?.map((leg, i) => (
              <div key={i} className="text-xs bg-secondary/50 rounded px-2 py-1.5">
                <span className="font-medium">{leg.player_name}</span> — {leg.line} {leg.stat_type}
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
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">
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
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Leg {idx + 1}</span>
                  {legs.length > 1 && (
                    <button onClick={() => removeLeg(idx)} className="text-muted-foreground hover:text-destructive transition-colors">
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
                    <SelectTrigger className="text-xs">
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
                    className="text-xs"
                  />
                  <Select value={leg.pick} onValueChange={(v) => updateLeg(idx, "pick", v)}>
                    <SelectTrigger className="text-xs">
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
            Add Leg
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

        {/* Error */}
        {error && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="pt-4">
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {analysis && <AnalysisResult analysis={analysis} legs={legs} />}

        <p className="text-[10px] text-muted-foreground text-center px-4">
          AI analysis is data-driven and not a guarantee. Always gamble responsibly.
        </p>
      </div>
    </div>
  );
}
