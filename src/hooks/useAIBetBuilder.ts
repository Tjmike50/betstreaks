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
  scoring_source: "today" | "auto-triggered" | "yesterday" | "none";
  enrichment_coverage?: {
    full: number;
    partial: number;
    none: number;
    miss_reasons: Record<string, number>;
    alias_hits?: number;
    alias_rescued_players?: string[];
  };
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
        // FunctionsHttpError has a `context` property (the raw Response).
        // Extract status code and response body for proper error classification.
        const context = (fnError as any).context as Response | undefined;
        const status = context?.status;
        let bodyError: string | null = null;
        let bodyMessage: string | null = null;
        try {
          if (context) {
            const body = await context.json();
            bodyError = body?.error || null;
            bodyMessage = body?.message || null;
          }
        } catch {
          // body already consumed or not JSON
        }

        // 401 — not authenticated
        if (status === 401 || bodyError?.includes("Authentication")) {
          setError("Please log in to use the AI Builder.");
          setErrorType("limit");
          toast({ title: "Login required", description: "Sign in to generate AI slips.", variant: "destructive" });
          return;
        }
        // 429 — free limit reached
        if (status === 429 || bodyError === "free_limit_reached") {
          setError(bodyMessage || "You've used your free AI slip for today. Upgrade to Premium for unlimited.");
          setErrorType("limit");
          toast({ title: "Daily limit reached", description: bodyMessage || "Upgrade to Premium for unlimited AI slips.", variant: "destructive" });
          return;
        }
        // 402 — credits exhausted
        if (status === 402) {
          setError("AI service credits exhausted. Please try again later or check your plan.");
          setErrorType("credits");
          toast({ title: "Credits exhausted", description: "The AI service is temporarily unavailable. Please try again later.", variant: "destructive" });
          return;
        }
        // No candidates
        if (bodyError === "no_candidates" || bodyError?.includes?.("no candidates")) {
          setError(bodyMessage || "Today's prop data isn't ready yet. Try again after games are loaded.");
          setErrorType("no-data");
          toast({ title: "No data available", description: "Prop data hasn't been loaded yet for today's games.", variant: "destructive" });
          return;
        }
        // Generic fallback
        setError(bodyMessage || fnError.message || "Something went wrong. Please try again.");
        setErrorType("generic");
        toast({ title: "Something went wrong", description: bodyMessage || "Please try again later.", variant: "destructive" });
        return;
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
          enrichment_coverage: meta.enrichment_coverage || null,
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
