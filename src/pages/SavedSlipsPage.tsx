import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, Brain, AlertCircle, ArrowUpDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSport } from "@/contexts/SportContext";
import { toast } from "@/hooks/use-toast";
import { SavedSlipCard } from "@/components/saved-slips/SavedSlipCard";
import type { AISlip } from "@/types/aiSlip";

type SortMode = "newest" | "oldest" | "risk";

export default function SavedSlipsPage() {
  const { user } = useAuth();
  const { sport } = useSport();
  const navigate = useNavigate();
  const [slips, setSlips] = useState<AISlip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    loadSavedSlips();
  }, [user, sport]);

  const loadSavedSlips = async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);

    try {
      const { data: savedRows, error: savedErr } = await supabase
        .from("saved_slips")
        .select("slip_id")
        .eq("user_id", user.id)
        .eq("sport", sport)
        .order("created_at", { ascending: false });

      if (savedErr) throw savedErr;

      if (!savedRows?.length) {
        setSlips([]);
        setIsLoading(false);
        return;
      }

      const slipIds = savedRows.map((r) => r.slip_id);

      const [{ data: slipData, error: slipErr }, { data: legData, error: legErr }] = await Promise.all([
        supabase.from("ai_slips").select("*").in("id", slipIds),
        supabase.from("ai_slip_legs").select("*").in("slip_id", slipIds).order("leg_order"),
      ]);

      if (slipErr) throw slipErr;
      if (legErr) throw legErr;

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
    } catch (err: any) {
      console.error("Failed to load saved slips:", err);
      setError("Failed to load your saved slips. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemove = async (slipId: string) => {
    if (!user) return;
    const { error: delErr } = await supabase.from("saved_slips").delete().eq("user_id", user.id).eq("slip_id", slipId);
    if (delErr) {
      toast({ title: "Failed to remove slip", variant: "destructive" });
      return;
    }
    setSlips((prev) => prev.filter((s) => s.id !== slipId));
    toast({ title: "Slip removed" });
  };

  const handleCopyToBuilder = (slip: AISlip) => {
    const prompt = slip.legs.map((l) => `${l.player_name} ${l.pick} ${l.line} ${l.stat_type}`).join(", ");
    navigate(`/ai-builder?prompt=${encodeURIComponent(prompt)}`);
  };

  const sortedSlips = [...slips].sort((a, b) => {
    if (sortMode === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (sortMode === "risk") {
      const order = { safe: 0, balanced: 1, aggressive: 2 };
      return (order[a.risk_label] ?? 1) - (order[b.risk_label] ?? 1);
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const cycleSortMode = () => {
    setSortMode((prev) => {
      if (prev === "newest") return "oldest";
      if (prev === "oldest") return "risk";
      return "newest";
    });
  };

  const sortLabel = sortMode === "newest" ? "Newest" : sortMode === "oldest" ? "Oldest" : "Risk";

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
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 bg-primary/10 rounded-full px-4 py-1.5">
              <Bookmark className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-primary">Saved Slips</span>
            </div>
            <p className="text-xs text-muted-foreground pl-1">
              {slips.length} slip{slips.length !== 1 ? "s" : ""} saved
            </p>
          </div>
          {slips.length > 1 && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={cycleSortMode}>
              <ArrowUpDown className="h-3 w-3" />
              {sortLabel}
            </Button>
          )}
        </div>

        {/* Error state */}
        {error && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="pt-4 pb-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={loadSavedSlips}>
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading state */}
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
        ) : !error && slips.length === 0 ? (
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
            {sortedSlips.map((slip) => (
              <SavedSlipCard
                key={slip.id}
                slip={slip}
                onRemove={handleRemove}
                onCopyToBuilder={handleCopyToBuilder}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
