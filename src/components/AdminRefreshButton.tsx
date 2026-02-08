import { useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/hooks/useAdmin";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface RefreshResult {
  ok: boolean;
  ran_at?: string;
  results?: {
    games?: { ok: boolean; counts?: { games: number }; error?: string };
    players?: { ok: boolean; counts?: Record<string, number>; error?: string };
  };
  duration_ms?: number;
  error?: string;
}

export function AdminRefreshButton() {
  const { isAdmin, isLoading: adminLoading } = useAdmin();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Don't render anything if not admin or still loading
  if (adminLoading || !isAdmin) {
    return null;
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        toast({
          variant: "destructive",
          title: "Authentication required",
          description: "Please log in to trigger a refresh.",
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke<RefreshResult>(
        "admin-trigger-refresh",
        {
          body: { games: true, players: true },
        }
      );

      if (error) {
        throw error;
      }

      if (data?.ok) {
        toast({
          title: "Refresh triggered successfully",
          description: `Completed in ${data.duration_ms}ms`,
        });

        // Invalidate relevant queries to refresh UI
        queryClient.invalidateQueries({ queryKey: ["refresh-status"] });
        queryClient.invalidateQueries({ queryKey: ["games-today"] });
        queryClient.invalidateQueries({ queryKey: ["streaks"] });
        queryClient.invalidateQueries({ queryKey: ["streak-events"] });
        queryClient.invalidateQueries({ queryKey: ["watchlist-optimized"] });
      } else {
        throw new Error(data?.error || "Refresh failed");
      }
    } catch (error) {
      console.error("Admin refresh error:", error);
      toast({
        variant: "destructive",
        title: "Refresh failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRefresh}
      disabled={isRefreshing}
      className="gap-2 border-accent text-accent-foreground hover:bg-accent"
    >
      <ShieldCheck className="h-4 w-4" />
      {isRefreshing ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" />
          Refreshing...
        </>
      ) : (
        "Admin Refresh"
      )}
    </Button>
  );
}
