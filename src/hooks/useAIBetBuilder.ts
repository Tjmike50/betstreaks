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

export type ErrorType = "credits" | "limit" | "no-data" | "network" | "generic";

export function useAIBetBuilder() {
  const [slips, setSlips] = useState<AISlip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<ErrorType | null>(null);
  const [marketDepth, setMarketDepth] = useState<MarketDepthData | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  const buildSlips = async (prompt: string, slipCount = 1, filters?: BuilderFilters) => {
    setIsLoading(true);
    setError(null);
    setErrorType(null);
    setSlips([]);
    setMarketDepth(null);
    setIsFallback(false);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("ai-bet-builder", {
        body: { prompt, slipCount, filters: filters || null },
      });

      if (fnError) {
        const msg = fnError.message || "";
        if (msg.includes("429") || msg.includes("free_limit_reached")) {
          setError("You've used your free AI slip for today. Upgrade to Premium for unlimited.");
          setErrorType("limit");
          toast({ title: "Daily limit reached", description: "Upgrade to Premium for unlimited AI slips.", variant: "destructive" });
          return;
        }
        if (msg.includes("402") || msg.includes("non-2xx")) {
          setError("AI service credits exhausted. Please try again later or check your plan.");
          setErrorType("credits");
          toast({ title: "Credits exhausted", description: "The AI service is temporarily unavailable. Please try again later.", variant: "destructive" });
          return;
        }
        throw fnError;
      }

      if (data?.error) {
        if (data.error === "free_limit_reached") {
          setError(data.message || "Daily limit reached.");
          setErrorType("limit");
          toast({ title: "Daily limit reached", description: data.message, variant: "destructive" });
          return;
        }
        if (data.error === "no_candidates" || data.error?.includes("no candidates")) {
          setError(data.message || "Today's prop data isn't ready yet. Try again after games are loaded.");
          setErrorType("no-data");
          toast({ title: "No data available", description: "Prop data hasn't been loaded yet for today's games.", variant: "destructive" });
          return;
        }
        throw new Error(data.error);
      }

      setSlips(data.slips || []);
      setIsFallback(!!data.fallback);

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
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("network")) {
        setError("Connection failed. Check your internet and try again.");
        setErrorType("network");
        toast({ title: "Network error", description: "Check your internet connection.", variant: "destructive" });
      } else {
        setError(msg);
        setErrorType("generic");
        toast({ title: "Something went wrong", description: msg, variant: "destructive" });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return { slips, isLoading, error, errorType, buildSlips, marketDepth, isFallback };
}
