import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AISlip } from "@/types/aiSlip";
import type { BuilderFilters } from "@/types/builderFilters";
import { toast } from "@/hooks/use-toast";

export interface MarketDepthData {
  verified_prop_candidates: number;
  verified_candidates_passed_to_llm: number;
  candidates_after_diversity: number;
  unique_players: number;
  legs_validated: number;
  legs_rejected: number;
  final_legs_accepted: number;
  final_legs_rejected_no_match: number;
  games_today: number;
  live_props_found: number;
  game_level_candidates: number;
  mode: string;
  fallback_used: boolean;
  scoring_data_available: number;
  market_quality: {
    before_market_filters: number;
    removed_by_verified_only: number;
    removed_by_main_lines_only: number;
    removed_by_min_books: number;
    removed_by_min_confidence: number;
    removed_by_single_book_exclude: number;
    after_market_filters: number;
    books_count_distribution: Record<string, number>;
    market_confidence_distribution: Record<string, number>;
  } | null;
}

export function useAIBetBuilder() {
  const [slips, setSlips] = useState<AISlip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marketDepth, setMarketDepth] = useState<MarketDepthData | null>(null);

  const buildSlips = async (prompt: string, slipCount = 1, filters?: BuilderFilters) => {
    setIsLoading(true);
    setError(null);
    setSlips([]);
    setMarketDepth(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("ai-bet-builder", {
        body: { prompt, slipCount, filters: filters || null },
      });

      if (fnError) {
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

      // Capture market depth debug data
      if (data?.scoring_metadata || data?.debug) {
        const meta = data.scoring_metadata || {};
        const debug = data.debug || {};
        setMarketDepth({
          ...meta,
          market_quality: debug.market_quality || null,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to generate slips";
      setError(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return { slips, isLoading, error, buildSlips, marketDepth };
}
