import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Flame, TrendingUp, Calendar, Clock, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useWatchlist } from "@/hooks/useWatchlist";
import type { Streak } from "@/types/streak";

const StreakDetailPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
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

  // Fetch refresh_status for last_updated
  const { data: refreshStatus } = useQuery({
    queryKey: ["refresh-status", sport],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refresh_status")
        .select("*")
        .eq("sport", sport)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const isTeam = entityType === "team";

  // Build title
  const getTitle = () => {
    if (!streak) return "Loading...";
    const name = isTeam ? streak.team_abbr || streak.player_name : streak.player_name;
    const operator = stat === "PTS_U" ? "≤" : "≥";
    return `${name} — ${stat} ${operator} ${threshold}`;
  };

  // Build bet label
  const getBetLabel = () => {
    if (!streak) return "";
    if (isTeam) {
      if (stat === "ML") return "ML Wins";
      if (stat === "PTS") return `Team PTS ≥ ${threshold}`;
      if (stat === "PTS_U") return `Team PTS ≤ ${threshold}`;
    }
    return `${stat} ≥ ${threshold}`;
  };

  // Star button handling
  const starred = streak ? isStarred(streak) : false;
  const handleToggleStar = () => {
    if (streak) {
      toggleWatchlist(streak);
    }
  };

  // Format date helper
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Format timestamp helper
  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return "—";
    return new Date(timestamp).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  // Calculate hit rates
  const getL10Pct = () => {
    if (!streak) return null;
    if (streak.last10_hit_pct != null) return Math.round(streak.last10_hit_pct);
    if (streak.last10_games > 0) return Math.round((streak.last10_hits / streak.last10_games) * 100);
    return null;
  };

  const getL5Pct = () => {
    if (!streak) return null;
    if (streak.last5_hit_pct != null) return Math.round(streak.last5_hit_pct);
    if (streak.last5_games > 0) return Math.round((streak.last5_hits / streak.last5_games) * 100);
    return null;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20">
      {/* Header */}
      <header className="px-4 py-4 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="mb-3 -ml-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        {streakLoading ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-bold text-foreground">{getTitle()}</h1>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={handleToggleStar}
              aria-label={starred ? "Remove from watchlist" : "Add to watchlist"}
            >
              <Star
                className={`h-6 w-6 transition-colors ${
                  starred
                    ? "fill-streak-gold text-streak-gold"
                    : "text-muted-foreground hover:text-streak-gold"
                }`}
              />
            </Button>
          </div>
        )}
      </header>

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
            {/* Big Streak Badge */}
            <Card className="bg-card border-border">
              <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                <div className="inline-flex items-center gap-2 bg-primary/15 text-primary px-4 py-2 rounded-lg">
                  <span className="font-semibold text-lg">{getBetLabel()}</span>
                </div>
                <div className="flex items-center gap-3 text-streak-green">
                  <Flame className="h-8 w-8" />
                  <span className="text-3xl font-bold">
                    {streak.streak_len} Game Streak
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Hit Rates Card */}
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Hit Rates
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-streak-blue">
                      {Math.round(streak.season_win_pct)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Season ({streak.season_wins}/{streak.season_games})
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-streak-blue">
                      {getL10Pct() ?? "—"}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      L10 ({streak.last10_hits}/{streak.last10_games})
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-streak-blue">
                      {getL5Pct() ?? "—"}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      L5 ({streak.last5_hits}/{streak.last5_games})
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Dates Card */}
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Dates
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Streak Start</span>
                    <span className="font-medium text-foreground">{formatDate(streak.streak_start)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Game</span>
                    <span className="font-medium text-foreground">{formatDate(streak.last_game)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Last Updated
                    </span>
                    <span className="font-medium text-foreground">
                      {formatTimestamp(refreshStatus?.last_run ?? null)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Results Placeholder */}
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  Recent Results (Last 10 Games)
                </h3>
                <div className="py-6 text-center">
                  <Badge variant="secondary" className="bg-secondary text-secondary-foreground">
                    Game log view coming next
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default StreakDetailPage;
