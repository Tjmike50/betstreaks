import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AISlip } from "@/types/aiSlip";
import { toast } from "@/hooks/use-toast";

export function useAIBetBuilder() {
  const [slips, setSlips] = useState<AISlip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildSlips = async (prompt: string, slipCount = 1) => {
    setIsLoading(true);
    setError(null);
    setSlips([]);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("ai-bet-builder", {
        body: { prompt, slipCount },
      });

      if (fnError) {
        // Check for free limit
        if (fnError.message?.includes("429") || fnError.message?.includes("free_limit_reached")) {
          setError("You've used your free AI slip for today. Upgrade to Premium for unlimited.");
          toast({ title: "Daily limit reached", description: "Upgrade to Premium for unlimited AI slips.", variant: "destructive" });
          return;
        }
        throw fnError;
      }

      if (data?.error) {
        if (data.error === "free_limit_reached") {
          setError(data.message || "Daily limit reached.");
          toast({ title: "Daily limit reached", description: data.message, variant: "destructive" });
          return;
        }
        throw new Error(data.error);
      }

      setSlips(data.slips || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to generate slips";
      setError(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return { slips, isLoading, error, buildSlips };
}
