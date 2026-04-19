// =============================================================================
// useAIDailyPick — fetches the latest ai_daily_picks row for the active sport,
// plus its legs. Sport-aware: NBA vs WNBA picks are isolated.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSport } from "@/contexts/SportContext";

export interface AIDailyPickLeg {
  id: string;
  leg_order: number;
  player_name: string;
  team_abbr: string | null;
  stat_type: string;
  pick: string;
  line: string;
  odds: string | null;
  reasoning: string | null;
}

export interface AIDailyPick {
  id: string;
  pick_date: string;
  slip_name: string;
  risk_label: string;
  estimated_odds: string | null;
  reasoning: string | null;
  created_at: string;
  legs: AIDailyPickLeg[];
}

export function useAIDailyPick() {
  return useQuery({
    queryKey: ["aiDailyPick"],
    queryFn: async (): Promise<AIDailyPick | null> => {
      const { data: pick, error } = await supabase
        .from("ai_daily_picks")
        .select("*")
        .order("pick_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!pick) return null;

      const { data: legs, error: legsError } = await supabase
        .from("ai_daily_pick_legs")
        .select("*")
        .eq("daily_pick_id", pick.id)
        .order("leg_order", { ascending: true });

      if (legsError) throw legsError;

      return {
        ...pick,
        legs: (legs ?? []) as AIDailyPickLeg[],
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
