import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, Trash2, Brain, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import type { AISlip, AISlipLeg } from "@/types/aiSlip";

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

    const slipsWithLegs = (slipData || []).map((s: any) => ({
      ...s,
      legs: (legData || []).filter((l: any) => l.slip_id === s.id),
    })) as AISlip[];

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
        <div className="max-w-lg mx-auto px-4 pt-6 text-center space-y-4">
          <Bookmark className="h-12 w-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-bold">Saved Slips</h1>
          <p className="text-sm text-muted-foreground">Log in to save and review your AI slips.</p>
          <Button onClick={() => navigate("/auth")}>Log In</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 bg-primary/10 rounded-full px-4 py-1.5">
            <Bookmark className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-primary">Saved Slips</span>
          </div>
          <h1 className="text-2xl font-bold">Your Saved Slips</h1>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : slips.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <Brain className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">No saved slips yet.</p>
            <Button variant="outline" onClick={() => navigate("/ai-builder")}>
              Build a Slip
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {slips.map((slip) => (
              <Card key={slip.id} className="border-border/50">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{slip.slip_name}</CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className={
                          slip.risk_label === "safe" ? "bg-green-500/20 text-green-400 border-green-500/30" :
                          slip.risk_label === "balanced" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                          "bg-red-500/20 text-red-400 border-red-500/30"
                        }>
                          {slip.risk_label}
                        </Badge>
                        {slip.estimated_odds && (
                          <span className="text-sm font-mono font-bold text-primary">{slip.estimated_odds}</span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => handleRemove(slip.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {slip.legs.map((leg, i) => (
                    <div key={i} className="text-xs bg-secondary/50 rounded px-2 py-1.5 flex justify-between">
                      <span>
                        <span className="font-medium">{leg.player_name}</span> — {leg.line} {leg.stat_type}
                      </span>
                      {leg.odds && <span className="text-muted-foreground font-mono">{leg.odds}</span>}
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground">
                    Created {new Date(slip.created_at).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
