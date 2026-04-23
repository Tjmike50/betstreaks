import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LineMovementRow {
  event_id: string;
  market_type: string;
  player_id: string;
  opening_line: number | null;
  current_line: number | null;
  opening_over_odds_american: number | null;
  current_over_odds_american: number | null;
  opening_under_odds_american: number | null;
  current_under_odds_american: number | null;
  move_amount: number | null;
  last_updated: string | null;
}

interface UseLineMovementOptions {
  eventIds: string[];
  enabled?: boolean;
}

export function useLineMovement({ eventIds, enabled = true }: UseLineMovementOptions) {
  return useQuery({
    queryKey: ["line-movement", eventIds],
    queryFn: async (): Promise<LineMovementRow[]> => {
      if (eventIds.length === 0) return [];
      const { data, error } = await supabase
        .from("line_movement_summary" as any)
        .select("*")
        .in("event_id", eventIds);
      if (error) throw error;
      return (data ?? []) as unknown as LineMovementRow[];
    },
    enabled: enabled && eventIds.length > 0,
    staleTime: 90_000,
    refetchInterval: 90_000,
  });
}

/** Build a lookup key for movement rows */
export function movementKey(eventId: string, playerId: string, marketType: string) {
  return `${eventId}|${playerId}|${marketType}`;
}

/** Index movement rows by composite key */
export function indexMovement(rows: LineMovementRow[]): Map<string, LineMovementRow> {
  const map = new Map<string, LineMovementRow>();
  for (const r of rows) {
    map.set(movementKey(r.event_id, r.player_id, r.market_type), r);
  }
  return map;
}
