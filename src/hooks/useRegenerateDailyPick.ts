// =============================================================================
// useRegenerateDailyPick — admin-only mutation that calls the
// generate-daily-pick edge function with force=true. Invalidates the
// ["aiDailyPick", sport] query on success.
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSport } from "@/contexts/SportContext";
import { toast } from "sonner";

interface RegenerateResponse {
  ok: boolean;
  created?: boolean;
  forced?: boolean;
  skipped?: boolean;
  reason?: string;
  pick_id?: string;
  previous_pick_id?: string | null;
  sport?: string;
  pick_date?: string;
  leg_count?: number;
  risk_label?: string;
  avg_confidence?: number;
  error?: string;
  message?: string;
}

export function useRegenerateDailyPick() {
  const queryClient = useQueryClient();
  const { sport } = useSport();

  return useMutation({
    mutationFn: async (): Promise<RegenerateResponse> => {
      const { data, error } = await supabase.functions.invoke<RegenerateResponse>(
        "generate-daily-pick",
        { body: { sport, force: true } },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Regenerate failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["aiDailyPick", sport] });
      if (data.created) {
        toast.success(`New ${sport} Daily Pick generated`, {
          description: `${data.leg_count} legs · ${data.risk_label}`,
        });
      } else if (data.skipped) {
        toast.info("No pick generated", {
          description:
            data.reason === "no_candidates"
              ? `No scored props available for ${sport} today.`
              : data.reason === "no_eligible_legs"
              ? "No legs cleared the confidence/value thresholds."
              : data.message ?? data.reason ?? "Skipped.",
        });
      }
    },
    onError: (err: Error) => {
      toast.error("Regenerate failed", { description: err.message });
    },
  });
}
