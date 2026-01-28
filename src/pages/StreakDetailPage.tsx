import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useWatchlist } from "@/hooks/useWatchlist";
import { StreakDetailHeader } from "@/components/StreakDetailHeader";
import { StreakStats } from "@/components/StreakStats";
import { RecentGamesList } from "@/components/RecentGamesList";
import type { Streak } from "@/types/streak";

const StreakDetailPage = () => {
  const [searchParams] = useSearchParams();
  const { isStarred, toggleWatchlist } = useWatchlist();

  // Parse query params
  const sport = searchParams.get("sport") || "NBA";
  const entityType = searchParams.get("entity_type") || "player";
  const playerId = searchParams.get("player_id");
  const teamAbbr = searchParams.get("team_abbr");
  const stat = searchParams.get("stat") || "";
  const threshold = parseInt(searchParams.get("threshold") || "0", 10);

  // Fetch the matching streak
  const { data: streak, isLoading: streakLoading } = useQuery({
    queryKey: ["streak-detail", sport, entityType, playerId, teamAbbr, stat, threshold],
    queryFn: async () => {
      let query = supabase
        .from("streaks")
        .select("*")
        .eq("sport", sport)
        .eq("entity_type", entityType)
        .eq("stat", stat)
        .eq("threshold", threshold);

      if (entityType === "player" && playerId) {
        query = query.eq("player_id", parseInt(playerId, 10));
      } else if (entityType === "team" && teamAbbr) {
        query = query.eq("team_abbr", teamAbbr);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as Streak | null;
    },
  });

  // Fetch refresh_status for last_updated (id = 1)
  const { data: refreshStatus } = useQuery({
    queryKey: ["refresh-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refresh_status")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Fetch recent games based on entity type
  const { data: recentGames, isLoading: gamesLoading } = useQuery({
    queryKey: ["recent-games", entityType, playerId, teamAbbr],
    queryFn: async () => {
      if (entityType === "player" && playerId) {
        const { data, error } = await supabase
          .from("player_recent_games")
          .select("*")
          .eq("player_id", parseInt(playerId, 10))
          .order("game_date", { ascending: false })
          .limit(10);
        
        if (error) throw error;
        return data || [];
      } else if (entityType === "team" && playerId) {
        // For teams, team_id is stored in player_id param
        const { data, error } = await supabase
          .from("team_recent_games")
          .select("*")
          .eq("team_id", parseInt(playerId, 10))
          .order("game_date", { ascending: false })
          .limit(10);
        
        if (error) throw error;
        return data || [];
      }
      return [];
    },
    enabled: !!(playerId || teamAbbr),
  });

  // Star button handling
  const starred = streak ? isStarred(streak) : false;
  const handleToggleStar = () => {
    if (streak) {
      toggleWatchlist(streak);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20">
      {/* Header */}
      <StreakDetailHeader
        streak={streak ?? null}
        isLoading={streakLoading}
        isStarred={starred}
        onToggleStar={handleToggleStar}
      />

      {/* Content */}
      <main className="flex-1 px-4 py-4 space-y-4">
        {streakLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : !streak ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Streak not found or no longer active</p>
          </div>
        ) : (
          <>
            <StreakStats
              streak={streak}
              lastUpdated={refreshStatus?.last_run ?? null}
            />
            
            <RecentGamesList
              games={recentGames || []}
              stat={stat}
              threshold={threshold}
              isLoading={gamesLoading}
            />
          </>
        )}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default StreakDetailPage;
