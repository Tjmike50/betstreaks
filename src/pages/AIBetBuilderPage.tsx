import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, Sparkles, Loader2, Bookmark, BookmarkCheck, Copy, Shield, Zap, Target, AlertCircle, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAIBetBuilder } from "@/hooks/useAIBetBuilder";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { useAuth } from "@/contexts/AuthContext";
import type { AISlip } from "@/types/aiSlip";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const QUICK_PROMPTS = [
  "Build me a +150 parlay",
  "Give me 3 NBA slips around +200",
  "Make me a safer 2-leg parlay",
  "Build a player prop slip for tonight",
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
      {/* Header bar */}
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
        {slip.legs.map((leg, i) => (
          <div key={i} className="bg-card/80 border border-border/30 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {leg.team_abbr && (
                  <span className="text-[10px] font-mono font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">
                    {leg.team_abbr}
                  </span>
                )}
                <span className="text-sm font-semibold truncate">{leg.player_name}</span>
              </div>
              {leg.odds && (
                <span className="text-xs font-mono font-bold text-muted-foreground shrink-0">{leg.odds}</span>
              )}
            </div>
            <div className="text-sm text-primary font-semibold">
              {leg.line} {leg.stat_type}
            </div>
            {leg.reasoning && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">{leg.reasoning}</p>
            )}
          </div>
        ))}

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
        <p className="text-sm font-medium">Building your slips...</p>
        <p className="text-xs text-muted-foreground">Analyzing live odds & player data</p>
      </div>
      {/* Skeleton cards */}
      {[1, 2].map((i) => (
        <Card key={i} className="border-border/30 animate-pulse">
          <CardContent className="pt-4 space-y-3">
            <div className="h-5 bg-muted rounded w-2/3" />
            <div className="h-3 bg-muted rounded w-1/3" />
            <div className="space-y-2">
              <div className="h-16 bg-muted/50 rounded-lg" />
              <div className="h-16 bg-muted/50 rounded-lg" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AIBetBuilderPage() {
  const [prompt, setPrompt] = useState("");
  const { slips, isLoading, error, buildSlips } = useAIBetBuilder();
  const { isPremium } = usePremiumStatus();
  const navigate = useNavigate();

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    const slipCount = isPremium ? 3 : 1;
    buildSlips(prompt.trim(), slipCount);
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
            Tell us what you want and AI builds it using live odds
          </p>
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
                Building slips...
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
            {slips.map((slip, i) => (
              <SlipCard key={slip.id} slip={slip} index={i} />
            ))}
          </div>
        )}

        {/* Empty state after generation with no results */}
        {!isLoading && !error && slips.length === 0 && prompt && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Enter a prompt and tap Generate to build slips</p>
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-[10px] text-muted-foreground text-center px-4">
          AI-generated picks are data-driven suggestions, not guarantees. Always gamble responsibly.
        </p>
      </div>
    </div>
  );
}
