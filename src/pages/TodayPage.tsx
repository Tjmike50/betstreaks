import { RefreshCw, Calendar, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useGamesToday } from "@/hooks/useGamesToday";
import { useRefreshStatus } from "@/hooks/useRefreshStatus";
import { GameCard } from "@/components/GameCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EarlyAccessBanner } from "@/components/EarlyAccessBanner";
import { AdminRefreshButton } from "@/components/AdminRefreshButton";
import { DataFreshnessIndicator } from "@/components/DataFreshnessIndicator";

export default function TodayPage() {
  const { games, isLoading, isFetching, error, lastUpdated, refetch } = useGamesToday();
  const { formattedTime: refreshStatusTime, lastRun: refreshLastRun, season } = useRefreshStatus();

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
          <div className="mt-2">
            <DataFreshnessIndicator showSeason={true} />
          </div>
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
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <p className="text-lg font-medium text-destructive">
              Failed to load games
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Please try again later
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={refetch}
              disabled={isFetching}
              className="mt-4"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Retry
            </Button>
          </div>
        ) : games.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              No games scheduled
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {refreshLastRun 
                ? `Last refresh: ${refreshStatusTime}`
                : "Waiting for data refresh"
              }
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {season} Season
            </p>
            <div className="flex items-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={refetch}
                disabled={isFetching}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <AdminRefreshButton />
            </div>
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
