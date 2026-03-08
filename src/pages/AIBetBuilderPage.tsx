import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, Sparkles, Send, Loader2, Shield, Zap, Target, Bookmark, Copy, RefreshCw, ArrowUp, ArrowDown, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    case "safe": return "bg-green-500/20 text-green-400 border-green-500/30";
    case "balanced": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "aggressive": return "bg-red-500/20 text-red-400 border-red-500/30";
    default: return "bg-muted text-muted-foreground";
  }
}

function getRiskIcon(risk: string) {
  switch (risk) {
    case "safe": return Shield;
    case "balanced": return Target;
    case "aggressive": return Zap;
    default: return Target;
  }
}

function SlipCard({ slip }: { slip: AISlip }) {
  const { user } = useAuth();
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
        toast({ title: "Already saved!" });
      } else {
        toast({ title: "Error saving", description: error.message, variant: "destructive" });
      }
    } else {
      toast({ title: "Slip saved!" });
    }
  };

  const handleCopy = () => {
    const text = `${slip.slip_name} (${slip.estimated_odds})\n${slip.legs.map((l) => `• ${l.player_name} ${l.line} ${l.stat_type}`).join("\n")}`;
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard!" });
  };

  return (
    <Card className="border-border/50 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold">{slip.slip_name}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={getRiskColor(slip.risk_label)}>
                <RiskIcon className="h-3 w-3 mr-1" />
                {slip.risk_label}
              </Badge>
              {slip.estimated_odds && (
                <span className="text-sm font-mono font-bold text-primary">{slip.estimated_odds}</span>
              )}
            </div>
          </div>
        </div>
        {slip.reasoning && (
          <p className="text-xs text-muted-foreground mt-2">{slip.reasoning}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {slip.legs.map((leg, i) => (
          <div key={i} className="bg-secondary/50 rounded-lg p-3 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {leg.team_abbr && (
                  <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{leg.team_abbr}</span>
                )}
                <span className="text-sm font-medium">{leg.player_name}</span>
              </div>
              {leg.odds && <span className="text-xs font-mono text-muted-foreground">{leg.odds}</span>}
            </div>
            <div className="text-sm text-primary font-medium">
              {leg.line} {leg.stat_type}
            </div>
            {leg.reasoning && (
              <p className="text-xs text-muted-foreground">{leg.reasoning}</p>
            )}
          </div>
        ))}

        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={handleSave} disabled={saving}>
            <Bookmark className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={handleCopy}>
            <Copy className="h-3.5 w-3.5 mr-1" />
            Copy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AIBetBuilderPage() {
  const [prompt, setPrompt] = useState("");
  const { slips, isLoading, error, buildSlips } = useAIBetBuilder();
  const { isPremium } = usePremiumStatus();
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    const slipCount = isPremium ? 3 : 1;
    buildSlips(prompt.trim(), slipCount);
  };

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
          <Button
            onClick={handleSubmit}
            disabled={isLoading || !prompt.trim()}
            className="w-full"
          >
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

        {/* Error */}
        {error && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="pt-4">
              <p className="text-sm text-destructive">{error}</p>
              {error.includes("Upgrade") && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate("/premium")}>
                  Go Premium
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {slips.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Your AI Slips
            </h2>
            {slips.map((slip) => (
              <SlipCard key={slip.id} slip={slip} />
            ))}
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
