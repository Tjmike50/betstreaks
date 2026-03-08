import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { BetAnalysis, AnalyzerLegInput } from "@/types/aiSlip";
import { toast } from "@/hooks/use-toast";

export function useAIBetAnalyzer() {
  const [analysis, setAnalysis] = useState<BetAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeSlip = async (legs: AnalyzerLegInput[]) => {
    setIsLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("ai-bet-analyzer", {
        body: { legs },
      });

      if (fnError) {
        if (fnError.message?.includes("429") || fnError.message?.includes("free_limit_reached")) {
          setError("Daily limit reached. Upgrade to Premium for unlimited.");
          toast({ title: "Daily limit reached", description: "Upgrade to Premium for unlimited analysis.", variant: "destructive" });
          return;
        }
        throw fnError;
      }

      if (data?.error) {
        if (data.error === "free_limit_reached") {
          setError(data.message);
          toast({ title: "Daily limit reached", description: data.message, variant: "destructive" });
          return;
        }
        throw new Error(data.error);
      }

      setAnalysis(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to analyze slip";
      setError(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return { analysis, isLoading, error, analyzeSlip };
}
