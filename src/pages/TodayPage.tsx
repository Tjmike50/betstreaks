import { RefreshCw, Calendar } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useGamesToday } from "@/hooks/useGamesToday";
import { GameCard } from "@/components/GameCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EarlyAccessBanner } from "@/components/EarlyAccessBanner";

export default function TodayPage() {
  const { games, isLoading, isFetching, lastUpdated, refetch } = useGamesToday();

  const formattedLastUpdated = lastUpdated
    ? formatDistanceToNow(lastUpdated, { addSuffix: true })
    : null;

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold">Today's Games</h1>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={refetch}
              disabled={isFetching}
              className="h-8 w-8"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {formattedLastUpdated && (
            <p className="text-xs text-muted-foreground mt-1">
              Updated {formattedLastUpdated}
            </p>
          )}
        </div>
      </header>

      {/* Early Access Banner */}
      <EarlyAccessBanner />

      {/* Content */}
      <main className="px-4 py-4">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : games.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              No NBA games found
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              (data updating)
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={refetch}
              className="mt-4"
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg overflow-hidden border border-border">
            {games.map((game) => (
              <GameCard
                key={game.id}
                id={game.id}
                homeTeamAbbr={game.home_team_abbr}
                awayTeamAbbr={game.away_team_abbr}
                homeScore={game.home_score}
                awayScore={game.away_score}
                status={game.status}
                gameTime={game.game_time}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
