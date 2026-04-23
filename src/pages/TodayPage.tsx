import { useState } from "react";
import { RefreshCw, Calendar, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useSearchParams } from "react-router-dom";
import { useGamesToday } from "@/hooks/useGamesToday";
import { useRefreshStatus } from "@/hooks/useRefreshStatus";
import { useSport } from "@/contexts/SportContext";
import { useNbaProps, summarizeByGame } from "@/hooks/useNbaProps";
import { useLineMovement, indexMovement } from "@/hooks/useLineMovement";
import { GameCard } from "@/components/GameCard";
import { GamePropsPanel } from "@/components/GamePropsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EarlyAccessBanner } from "@/components/EarlyAccessBanner";
import { AdminRefreshButton } from "@/components/AdminRefreshButton";
import { DataFreshnessIndicator } from "@/components/DataFreshnessIndicator";

export default function TodayPage() {
  const { games, isLoading, isFetching, error, lastUpdated, refetch, debugInfo } = useGamesToday();
  const { formattedTime: refreshStatusTime, lastRun: refreshLastRun, season } = useRefreshStatus();
  const { config: sportConfig } = useSport();
  const [searchParams] = useSearchParams();
  const isNba = sportConfig.key === "NBA";
  const { data: propRows } = useNbaProps({ enabled: isNba });
  const propsByGame = propRows ? summarizeByGame(propRows) : new Map();

  // Line movement for all today's NBA events
  const eventIds = propRows ? [...new Set(propRows.map((r) => r.event_id))] : [];
  const { data: movementRows } = useLineMovement({ eventIds, enabled: isNba && eventIds.length > 0 });
  const movementIndex = movementRows ? indexMovement(movementRows) : new Map();

  const [expandedGame, setExpandedGame] = useState<string | null>(null);

  const isDebug = searchParams.get("debug") === "1";
  const todayFormatted = format(new Date(), "EEEE, MMM d");

  const formattedLastUpdated = lastUpdated
    ? formatDistanceToNow(lastUpdated, { addSuffix: true })
    : null;

  const toggleExpand = (gameId: string) => {
    setExpandedGame((prev) => (prev === gameId ? null : gameId));
  };

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
            <p className="text-sm text-muted-foreground text-center py-2">
              Loading today's games...
            </p>
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <p className="text-lg font-medium text-destructive">Failed to load games</p>
            <p className="text-sm text-muted-foreground mt-1">Please try again later</p>
            <Button variant="outline" size="sm" onClick={refetch} disabled={isFetching} className="mt-4">
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Retry
            </Button>
          </div>
        ) : games.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No {sportConfig.shortName} games scheduled</p>
            <p className="text-sm text-muted-foreground mt-1">for {todayFormatted}</p>
            <p className="text-xs text-muted-foreground mt-3">
              {refreshLastRun ? `Last updated: ${refreshStatusTime}` : "Waiting for data refresh"} •{" "}
              {season} Season
            </p>
            <div className="flex items-center gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={refetch} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <AdminRefreshButton />
            </div>
            {isDebug && (
              <div className="mt-4 p-3 bg-muted/50 rounded-lg text-xs font-mono text-left w-full max-w-sm">
                <p className="font-semibold mb-1">Debug Info</p>
                <p>Records: {games.length} (raw: {debugInfo.rawCount})</p>
                <p>Date: {debugInfo.date}</p>
                <p>Last updated: {lastUpdated?.toISOString() || "N/A"}</p>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="divide-y divide-border rounded-lg overflow-hidden border border-border">
              {games.map((game) => {
                const summary = propsByGame.get(game.id);
                const isExpanded = expandedGame === game.id;
                const gameProps = isNba && propRows
                  ? propRows.filter((r) => r.event_id === game.id)
                  : [];
                const hasProps = gameProps.length > 0;

                return (
                  <div key={game.id}>
                    <div
                      className={hasProps ? "cursor-pointer" : ""}
                      onClick={() => hasProps && toggleExpand(game.id)}
                    >
                      <GameCard
                        id={game.id}
                        homeTeamAbbr={game.home_team_abbr}
                        awayTeamAbbr={game.away_team_abbr}
                        homeScore={game.home_score}
                        awayScore={game.away_score}
                        status={game.status}
                        gameTime={game.game_time}
                      />
                    </div>
                    {summary && summary.propCount > 0 && (
                      <div
                        className={`px-4 pb-2 -mt-1 flex items-center gap-2 ${hasProps ? "cursor-pointer" : ""}`}
                        onClick={() => hasProps && toggleExpand(game.id)}
                      >
                        <Badge variant="secondary" className="text-xs">
                          {summary.propCount} props
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {summary.playerCount} players
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {summary.marketTypes.length} markets
                        </Badge>
                        <span className="ml-auto text-muted-foreground">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </span>
                      </div>
                    )}
                    {isExpanded && hasProps && (
                      <GamePropsPanel props={gameProps} movementIndex={movementIndex} />
                    )}
                  </div>
                );
              })}
            </div>
            {isDebug && (
              <div className="mt-4 p-3 bg-muted/50 rounded-lg text-xs font-mono">
                <p className="font-semibold mb-1">Debug Info</p>
                <p>Records: {games.length} (raw: {debugInfo.rawCount})</p>
                <p>Date: {debugInfo.date}</p>
                <p>Last updated: {lastUpdated?.toISOString() || "N/A"}</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
