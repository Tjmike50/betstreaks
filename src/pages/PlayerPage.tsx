import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Flame, TrendingUp, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Footer } from "@/components/Footer";
import { usePlayerStreaks } from "@/hooks/useStreaks";

const PlayerPage = () => {
  const { playerId } = useParams<{ playerId: string }>();
  const navigate = useNavigate();
  const { data: streaks, isLoading, error } = usePlayerStreaks(
    playerId ? parseInt(playerId, 10) : 0
  );

  const playerName = streaks?.[0]?.player_name ?? "Player";
  const teamAbbr = streaks?.[0]?.team_abbr;

  return (
    <div className="min-h-screen bg-background flex flex-col">
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

        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{playerName}</h1>
          {teamAbbr && (
            <Badge variant="secondary" className="bg-secondary text-secondary-foreground">
              {teamAbbr}
            </Badge>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-4">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          🔥 Active Streaks
        </h2>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg bg-card" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive">Failed to load player streaks</p>
          </div>
        ) : streaks && streaks.length > 0 ? (
          <div className="space-y-3">
            {streaks.map((streak) => (
              <Card key={streak.id} className="bg-card border-border">
                <CardContent className="p-4 space-y-3">
                  {/* Bet Label */}
                  <div className="inline-flex items-center gap-2 bg-primary/15 text-primary px-3 py-1.5 rounded-lg">
                    <span className="font-semibold">
                      {streak.stat} ≥ {streak.threshold}
                    </span>
                  </div>

                  {/* Stats */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-streak-green">
                      <Flame className="h-4 w-4" />
                      <span className="font-medium">
                        Active streak: {streak.streak_len} games
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-streak-blue">
                      <TrendingUp className="h-4 w-4" />
                      <span>
                        Season hit rate: {Math.round(streak.season_win_pct)}%{" "}
                        <span className="text-muted-foreground">
                          ({streak.season_wins}/{streak.season_games})
                        </span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span>Last game: {streak.last_game}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No active streaks for this player</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default PlayerPage;
