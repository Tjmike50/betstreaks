import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AISlip } from "@/types/aiSlip";
import type { BuilderFilters } from "@/types/builderFilters";
import { toast } from "@/hooks/use-toast";
import { useSport } from "@/contexts/SportContext";

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

export interface AIBuildAvailableGame {
  id: string;
  away_team_abbr?: string | null;
  home_team_abbr?: string | null;
  game_time?: string | null;
  status?: string | null;
  canonical_game_key?: string | null;
}

export type ErrorType = "credits" | "limit" | "auth" | "no-data" | "network" | "generic";

function humanizeBuilderNoDataMessage(data: any): string {
  const message = data?.message || "No eligible props found for this slate yet. Try all games or refresh odds.";
  const debug = data?.debug || {};
  const requestedSport = String(debug?.sport || "").toUpperCase();
  const latestAvailableGameDate = debug?.latest_available_game_date || null;
  const quotaExhausted = debug?.quota_exhausted === true;
  const providerUnavailableReason = debug?.provider_unavailable_reason || null;
  const verifiedCandidateCount = Number(debug?.verified_market_candidate_count ?? 0);

  if (requestedSport === "MLB") {
    if (quotaExhausted || providerUnavailableReason === "OUT_OF_USAGE_CREDITS") {
      return latestAvailableGameDate
        ? `Verified MLB live lines are temporarily unavailable because the odds provider quota is exhausted. Latest available scored MLB slate: ${latestAvailableGameDate}. Try again after odds refresh or on the next slate.`
        : "Verified MLB live lines are temporarily unavailable because the odds provider quota is exhausted. Try again after odds refresh or on the next slate.";
    }
    if (verifiedCandidateCount === 0) {
      return latestAvailableGameDate
        ? `No verified MLB live props are available for this slate yet. Latest available scored MLB slate: ${latestAvailableGameDate}. Try again after odds refresh or on the next slate.`
        : "No verified MLB live props are available for this slate yet. Try again after odds refresh or on the next slate.";
    }
  }

  return message;
}

export function useAIBetBuilder() {
  const [slips, setSlips] = useState<AISlip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<ErrorType | null>(null);
  const [marketDepth, setMarketDepth] = useState<MarketDepthData | null>(null);
  const [isFallback, setIsFallback] = useState(false);
  const [availableGames, setAvailableGames] = useState<AIBuildAvailableGame[]>([]);
  const { sport } = useSport();

  const buildSlips = async (prompt: string, slipCount = 1, filters?: BuilderFilters) => {
    setIsLoading(true);
    setError(null);
    setErrorType(null);
    setMarketDepth(null);
    setIsFallback(false);
    setAvailableGames([]);

    // Always send the active sport so the edge function tags rows + filters odds correctly.
    const effectiveSport = filters?.sport ?? sport;

    try {
      const { data, error: fnError } = await supabase.functions.invoke("ai-bet-builder", {
        body: { prompt, slipCount, filters: filters || null, sport: effectiveSport },
      });

      if (fnError) {
        // FunctionsHttpError has a `context` property (the raw Response).
        // Extract status code and response body for proper error classification.
        const context = (fnError as any).context as Response | undefined;
        const status = context?.status;
        let bodyError: string | null = null;
        let bodyErrorCode: string | null = null;
        let bodyMessage: string | null = null;
        let bodyAvailableGames: AIBuildAvailableGame[] = [];
        try {
          if (context) {
            const body = await context.json();
            bodyError = body?.error || null;
            bodyErrorCode = body?.error_code || null;
            bodyMessage = body?.message || null;
            bodyAvailableGames = Array.isArray(body?.available_games) ? body.available_games : [];
          }
        } catch {
          // body already consumed or not JSON
        }

        // 401 — not authenticated
        if (status === 401 || bodyErrorCode === "AUTH_REQUIRED" || bodyError?.includes("Authentication")) {
          setError("Please log in to use the AI Builder.");
          setErrorType("auth");
          toast({ title: "Login required", description: "Sign in to generate AI slips.", variant: "destructive" });
          return;
        }
        // 429 — free limit reached
        if (status === 429 || bodyErrorCode === "FREE_LIMIT_REACHED" || bodyError === "free_limit_reached") {
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
          setAvailableGames(bodyAvailableGames);
          toast({ title: "No data available", description: "Prop data hasn't been loaded yet for today's games.", variant: "destructive" });
          return;
        }
        // Generic fallback
        setAvailableGames(bodyAvailableGames);
        setError(bodyMessage || fnError.message || "Something went wrong. Please try again.");
        setErrorType("generic");
        toast({ title: "Something went wrong", description: bodyMessage || "Please try again later.", variant: "destructive" });
        return;
      }

      if (data && data.ok === false) {
        const errorCode = data.error_code || "GENERIC_ERROR";
        const message = data.message || "Something went wrong. Please try again.";
        const responseAvailableGames = Array.isArray(data.available_games) ? data.available_games : [];
        if (errorCode === "FREE_LIMIT_REACHED") {
          setError(message);
          setErrorType("limit");
          toast({ title: "Daily limit reached", description: message, variant: "destructive" });
          return;
        }
        if (errorCode === "SCHEDULE_EMPTY" || errorCode === "NO_CANDIDATES" || errorCode === "GAME_NOT_FOUND") {
          const humanMessage = humanizeBuilderNoDataMessage(data);
          setError(humanMessage);
          setErrorType("no-data");
          setAvailableGames(responseAvailableGames);
          toast({ title: "No data available", description: humanMessage, variant: "destructive" });
          return;
        }
        if (errorCode === "AI_PROVIDER_FAILED") {
          setError(message);
          setErrorType("generic");
          setAvailableGames(responseAvailableGames);
          toast({ title: "AI temporarily unavailable", description: message, variant: "destructive" });
          return;
        }
        throw new Error(message);
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

      const nextSlips = Array.isArray(data?.slips) ? data.slips : [];
      if (import.meta.env.DEV) {
        console.log("[AI Builder] response", {
          ok: data?.ok,
          slips: nextSlips.length,
          error_code: data?.error_code,
          message: data?.message,
        });
      }

      if (nextSlips.length === 0) {
        const humanMessage = humanizeBuilderNoDataMessage(data);
        setError(humanMessage);
        setErrorType("no-data");
        setAvailableGames(Array.isArray(data?.available_games) ? data.available_games : []);
        toast({
          title: "No slips generated",
          description: humanMessage,
          variant: "destructive",
        });
        return;
      }

      setSlips(nextSlips);
      setIsFallback(!!data.fallback);
      setAvailableGames([]);

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

  return { slips, isLoading, error, errorType, buildSlips, marketDepth, isFallback, availableGames };
}
