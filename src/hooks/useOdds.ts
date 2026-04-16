import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OddsResponse } from "@/types/odds";

interface UseOddsParams {
  sport: string;
  market: string;
  eventId?: string;
  bookmaker?: string;
  ttl?: number;
  enabled?: boolean;
}

export function useOdds({
  sport,
  market,
  eventId,
  bookmaker,
  ttl,
  enabled = true,
}: UseOddsParams) {
  return useQuery({
    queryKey: ["odds", sport, market, eventId, bookmaker],
    queryFn: async (): Promise<OddsResponse> => {
      const body: Record<string, unknown> = { sport, market };
      if (eventId) body.eventId = eventId;
      if (bookmaker) body.bookmaker = bookmaker;
      if (ttl) body.ttl = ttl;

      const { data, error } = await supabase.functions.invoke("get-odds", {
        body,
      });
      if (error) throw error;
      return data as OddsResponse;
    },
    enabled,
    staleTime: (ttl ?? 300) * 1000,
    refetchInterval: (ttl ?? 300) * 1000,
  });
}
