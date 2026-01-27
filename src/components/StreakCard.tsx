import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame, TrendingUp, Calendar, Star } from "lucide-react";
import type { Streak } from "@/types/streak";

interface StreakCardProps {
  streak: Streak;
}

export function StreakCard({ streak }: StreakCardProps) {
  const navigate = useNavigate();
  const isTeam = streak.entity_type === "team";

  const handleClick = () => {
    navigate(`/player/${streak.player_id}`);
  };

  const formatDate = (dateStr: string) => {
    return dateStr;
  };

  // Get display name: for teams, prefer team_abbr
  const displayName = isTeam
    ? streak.team_abbr || streak.player_name
    : streak.player_name;

  // Check if qualifies as "Best Bet"
  const isBestBet = streak.season_win_pct >= 55 && streak.streak_len >= 3;

  // Get bet label: special formatting for teams
  const getBetLabel = () => {
    if (isTeam) {
      if (streak.stat === "ML") {
        return "ML Wins";
      }
      if (streak.stat === "PTS") {
        return `Team PTS ≥ ${streak.threshold}`;
      }
      if (streak.stat === "PTS_U") {
        return `Team PTS ≤ ${streak.threshold}`;
      }
    }
    return `${streak.stat} ≥ ${streak.threshold}`;
  };

  return (
    <Card
      onClick={handleClick}
      className="bg-card border-border hover:border-primary/50 transition-all duration-200 cursor-pointer active:scale-[0.98]"
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: Name + Team Badge (only for players) + Best Bet Badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-bold text-foreground truncate">
            {displayName}
          </h3>
          {!isTeam && streak.team_abbr && (
            <Badge
              variant="secondary"
              className="bg-secondary text-secondary-foreground shrink-0 text-xs"
            >
              {streak.team_abbr}
            </Badge>
          )}
          {isBestBet && (
            <Badge className="bg-streak-gold text-background shrink-0 text-xs gap-1">
              <Star className="h-3 w-3 fill-current" />
              Best Bet
            </Badge>
          )}
        </div>

        {/* Bet Label */}
        <div className="inline-flex items-center gap-2 bg-primary/15 text-primary px-3 py-1.5 rounded-lg">
          <span className="font-semibold">{getBetLabel()}</span>
        </div>

        {/* Stats Grid */}
        <div className="space-y-2 text-sm">
          {/* Active Streak */}
          <div className="flex items-center gap-2 text-streak-green">
            <Flame className="h-4 w-4" />
            <span className="font-medium">
              Active streak: {streak.streak_len} games
            </span>
          </div>

          {/* Season Hit Rate */}
          <div className="flex items-center gap-2 text-streak-blue">
            <TrendingUp className="h-4 w-4" />
            <span>
              Season: {Math.round(streak.season_win_pct)}%{" "}
              <span className="text-muted-foreground">
                ({streak.season_wins}/{streak.season_games})
              </span>
            </span>
          </div>

          {/* Last 10 Hit Rate */}
          {streak.last10_games > 0 && (
            <div className="flex items-center gap-2 text-streak-blue">
              <TrendingUp className="h-4 w-4" />
              <span>
                L10: {streak.last10_hit_pct != null ? Math.round(streak.last10_hit_pct) : Math.round((streak.last10_hits / streak.last10_games) * 100)}%{" "}
                <span className="text-muted-foreground">
                  ({streak.last10_hits}/{streak.last10_games})
                </span>
              </span>
            </div>
          )}

          {/* Last 5 Hit Rate */}
          {streak.last5_games > 0 && (
            <div className="flex items-center gap-2 text-streak-blue">
              <TrendingUp className="h-4 w-4" />
              <span>
                L5: {streak.last5_hit_pct != null ? Math.round(streak.last5_hit_pct) : Math.round((streak.last5_hits / streak.last5_games) * 100)}%{" "}
                <span className="text-muted-foreground">
                  ({streak.last5_hits}/{streak.last5_games})
                </span>
              </span>
            </div>
          )}

          {/* Last Game */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>Last game: {formatDate(streak.last_game)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
