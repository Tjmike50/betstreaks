import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, Trash2, Brain, Loader2, Shield, Target, Zap, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import type { AISlip } from "@/types/aiSlip";

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

function SavedSlipCard({ slip, onRemove }: { slip: AISlip; onRemove: (id: string) => void }) {
  const [removing, setRemoving] = useState(false);
  const RiskIcon = getRiskIcon(slip.risk_label);

  const handleRemove = async () => {
    setRemoving(true);
    await onRemove(slip.id);
    setRemoving(false);
  };

  return (
    <Card className="border-border/50 overflow-hidden">
      <CardContent className="pt-4 pb-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5 flex-1 min-w-0">
            <h3 className="text-base font-bold leading-tight">{slip.slip_name}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`text-[11px] ${getRiskBadge(slip.risk_label)}`}>
                <RiskIcon className="h-3 w-3 mr-1" />
                {slip.risk_label}
              </Badge>
              {slip.estimated_odds && (
                <span className="text-sm font-mono font-black text-primary">{slip.estimated_odds}</span>
              )}
            </div>
          </div>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0"
          >
            {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>

        {/* Reasoning */}
        {slip.reasoning && (
          <p className="text-xs text-muted-foreground leading-relaxed">{slip.reasoning}</p>
        )}

        {/* Legs */}
        <div className="space-y-1.5">
          {slip.legs.map((leg, i) => (
            <div key={i} className="bg-secondary/50 border border-border/20 rounded-lg px-3 py-2 space-y-0.5">
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
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">{leg.odds}</span>
                )}
              </div>
              <div className="text-xs text-primary font-medium">
                {leg.line} {leg.stat_type}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>Saved {new Date(slip.created_at).toLocaleDateString()}</span>
          <span>•</span>
          <span>{slip.legs.length} legs</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SavedSlipsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [slips, setSlips] = useState<AISlip[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    loadSavedSlips();
  }, [user]);

  const loadSavedSlips = async () => {
    if (!user) return;
    setIsLoading(true);

    const { data: savedRows, error: savedErr } = await supabase
      .from("saved_slips")
      .select("slip_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (savedErr || !savedRows?.length) {
      setSlips([]);
      setIsLoading(false);
      return;
    }

    const slipIds = savedRows.map((r) => r.slip_id);

    const { data: slipData } = await supabase
      .from("ai_slips")
      .select("*")
      .in("id", slipIds);

    const { data: legData } = await supabase
      .from("ai_slip_legs")
      .select("*")
      .in("slip_id", slipIds)
      .order("leg_order");

    // Maintain saved order
    const slipMap = new Map((slipData || []).map((s: any) => [s.id, s]));
    const slipsWithLegs = slipIds
      .map((id) => {
        const s = slipMap.get(id);
        if (!s) return null;
        return {
          ...s,
          legs: (legData || []).filter((l: any) => l.slip_id === s.id),
        };
      })
      .filter(Boolean) as AISlip[];

    setSlips(slipsWithLegs);
    setIsLoading(false);
  };

  const handleRemove = async (slipId: string) => {
    if (!user) return;
    await supabase.from("saved_slips").delete().eq("user_id", user.id).eq("slip_id", slipId);
    setSlips((prev) => prev.filter((s) => s.id !== slipId));
    toast({ title: "Slip removed" });
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <div className="max-w-lg mx-auto px-4 pt-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Bookmark className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold">Saved Slips</h1>
          <p className="text-sm text-muted-foreground">Log in to save and review your AI-generated slips.</p>
          <Button onClick={() => navigate("/auth")}>Log In</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 bg-primary/10 rounded-full px-4 py-1.5">
            <Bookmark className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-primary">Saved Slips</span>
          </div>
          <h1 className="text-2xl font-bold">Your Saved Slips</h1>
          <p className="text-sm text-muted-foreground">{slips.length} slip{slips.length !== 1 ? "s" : ""} saved</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-border/30 animate-pulse">
                <CardContent className="pt-4 space-y-3">
                  <div className="h-5 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                  <div className="h-12 bg-muted/50 rounded-lg" />
                  <div className="h-12 bg-muted/50 rounded-lg" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : slips.length === 0 ? (
          <div className="text-center py-12 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
              <Brain className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No saved slips yet</p>
              <p className="text-xs text-muted-foreground">Generate slips with the AI Builder and save your favorites</p>
            </div>
            <Button variant="outline" onClick={() => navigate("/ai-builder")}>
              Build a Slip
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {slips.map((slip) => (
              <SavedSlipCard key={slip.id} slip={slip} onRemove={handleRemove} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
