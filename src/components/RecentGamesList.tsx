import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import { calculateComboValue, isComboStat } from "@/lib/comboStats";

interface PlayerGame {
  game_date: string;
  matchup: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3m: number | null;
  blk: number | null;
  stl: number | null;
}

interface TeamGame {
  game_date: string;
  matchup: string | null;
  pts: number | null;
}

interface RecentGamesListProps {
  games: (PlayerGame | TeamGame)[];
  stat: string;
  threshold: number;
  isLoading: boolean;
}

// Determine if a game is a hit based on stat and threshold
function isHit(game: PlayerGame | TeamGame, stat: string, threshold: number): boolean {
  if (stat === "PTS_U") {
    return (game.pts ?? 0) <= threshold;
  }
  
  // Handle combo stats (PA, PR, RA, PRA)
  if (isComboStat(stat)) {
    const comboValue = calculateComboValue(stat, game as PlayerGame);
    return (comboValue ?? 0) >= threshold;
  }
  
  switch (stat) {
    case "PTS":
      return (game.pts ?? 0) >= threshold;
    case "REB":
      return ((game as PlayerGame).reb ?? 0) >= threshold;
    case "AST":
      return ((game as PlayerGame).ast ?? 0) >= threshold;
    case "3PM":
      return ((game as PlayerGame).fg3m ?? 0) >= threshold;
    case "BLK":
      return ((game as PlayerGame).blk ?? 0) >= threshold;
    case "STL":
      return ((game as PlayerGame).stl ?? 0) >= threshold;
    case "ML":
      // For ML (moneyline), we'd need win/loss info - not stat based
      return true;
    default:
      return (game.pts ?? 0) >= threshold;
  }
}

// Get the relevant stat value to display
function getStatValue(game: PlayerGame | TeamGame, stat: string): number {
  // Handle combo stats (PA, PR, RA, PRA)
  if (isComboStat(stat)) {
    return calculateComboValue(stat, game as PlayerGame) ?? 0;
  }
  
  switch (stat) {
    case "PTS":
    case "PTS_U":
      return game.pts ?? 0;
    case "REB":
      return (game as PlayerGame).reb ?? 0;
    case "AST":
      return (game as PlayerGame).ast ?? 0;
    case "3PM":
      return (game as PlayerGame).fg3m ?? 0;
    case "BLK":
      return (game as PlayerGame).blk ?? 0;
    case "STL":
      return (game as PlayerGame).stl ?? 0;
    default:
      return game.pts ?? 0;
  }
}

// Format date as "Jan 15"
function formatGameDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function RecentGamesList({ games, stat, threshold, isLoading }: RecentGamesListProps) {
  const { isPremium } = usePremiumStatus();
  const [showPremiumModal, setShowPremiumModal] = useState(false);

  // Free users see 5 games, Premium users see 10
  const maxGames = isPremium ? 10 : 5;
  const visibleGames = games.slice(0, maxGames);
  const hasLockedGames = !isPremium && games.length > 5;

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Recent Games (Last {maxGames})
          </h3>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!games || games.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Recent Games (Last {maxGames})
          </h3>
          <div className="py-6 text-center">
            <p className="text-muted-foreground text-sm">
              Recent game breakdown coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Recent Games (Last {isPremium ? 10 : 5})
          </h3>
          <div className="space-y-2">
            {visibleGames.map((game, index) => {
              const hit = isHit(game, stat, threshold);
              const statValue = getStatValue(game, stat);
              
              return (
                <div
                  key={`${game.game_date}-${index}`}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {formatGameDate(game.game_date)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {game.matchup || "—"}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-foreground min-w-[2rem] text-right">
                      {statValue}
                    </span>
                    <Badge
                      className={`min-w-[3.5rem] justify-center ${
                        hit
                          ? "bg-streak-green/20 text-streak-green border-streak-green/30"
                          : "bg-destructive/20 text-destructive border-destructive/30"
                      }`}
                      variant="outline"
                    >
                      {hit ? "Hit" : "Miss"}
                    </Badge>
                  </div>
                </div>
              );
            })}

            {/* Locked games placeholder for non-premium users */}
            {hasLockedGames && (
              <button
                onClick={() => setShowPremiumModal(true)}
                className="flex items-center justify-center gap-2 py-3 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors w-full text-muted-foreground"
              >
                <Lock className="h-4 w-4" />
                <span className="text-sm">+{games.length - 5} more games (Premium)</span>
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <PremiumLockModal open={showPremiumModal} onOpenChange={setShowPremiumModal} />
    </>
  );
}
